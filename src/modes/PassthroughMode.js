/**
 * PassthroughMode - Forward all requests to backend without recording
 *
 * Purpose:
 * - Simple proxy behavior
 * - No database operations
 * - Minimal overhead
 * - Used when recording/replay not needed
 *
 * Flow:
 * 1. Execute request interceptors
 * 2. Forward request to backend
 * 3. Execute response interceptors
 * 4. Return response
 *
 * Usage:
 * const mode = new PassthroughMode({ forwarder, interceptorChain });
 * const response = await mode.handleRequest(requestContext);
 */

const ModeHandler = require("./ModeHandler");
const logger = require("../utils/logger");
const trafficLogger = require("../utils/traffic_logger");

class PassthroughMode extends ModeHandler {
  /**
   * Handle request in passthrough mode
   * @param {RequestContext} requestContext - Request context
   * @returns {Promise<ResponseContext>} Response context
   */
  async handleRequest(requestContext) {
    const startTime = Date.now();
    const current = requestContext.getCurrent();
    const original = requestContext.getOriginal();
    const clientIP = original.ip || "UNKNOWN";
    const mode = "passthrough";

    try {
      logger.debug("Passthrough mode: Processing request", {
        method: current.method,
        path: current.path,
        userId: requestContext.getMetadata("userId"),
      });

      // Initialize request logging (generates request ID and logs incoming request)
      const requestId = this.initializeRequestLogging(requestContext, clientIP, mode);
      // Set mode in request context metadata for downstream processing (e.g., stats recording)
      requestContext.setMetadata("mode", mode);

      // Execute request interceptors
      const processedRequest = await this.interceptorChain.executeRequest(requestContext);

      // Get target URL
      const processedOriginal = processedRequest.getOriginal();
      const originalRequestUrl = processedOriginal.originalUrl || processedOriginal.url;

      // Determine target URL:
      // If the original request already has a full URL (starts with http/https), use it
      // Otherwise, combine with baseUrl
      let targetUrl = originalRequestUrl;
      if (!originalRequestUrl.startsWith("http://") && !originalRequestUrl.startsWith("https://")) {
        const baseUrl = this.forwarder.config?.getTargetBaseUrl() || "";
        if (baseUrl) {
          const url = new URL(originalRequestUrl, baseUrl);
          targetUrl = url.toString();
        }
      }

      // Prepare forwarded headers with correct backend host
      const urlObj = new URL(targetUrl);
      const forwardedHeaders = { ...processedRequest.getCurrent().headers };
      forwardedHeaders.host = urlObj.host; // Set correct backend host

      // IMPORTANT: Apply forwarded headers to the request before forwarding
      // This ensures the backend receives the correct host header
      Object.entries(forwardedHeaders).forEach(([key, value]) => {
        processedRequest.setHeader(key, value);
      });

      // Log forwarded request with complete target URL
      this.logForwardedRequest(processedRequest, targetUrl, mode, forwardedHeaders, requestId);

      // Forward to backend with correct headers
      let responseContext;
      try {
        logger.debug("[PassthroughMode] Forwarding request to backend", {
          targetUrl,
          method: processedRequest.getCurrent().method,
        });
        responseContext = await this.forwarder.forward(processedRequest);
        // Store target URL in response metadata for schema detection (HTTP vs HTTPS)
        responseContext.setMetadata("targetUrl", targetUrl);
        // Store request ID in response metadata (will also be set by logBackendResponse)
        this.storeRequestIdInResponse(responseContext, requestId);
      } catch (error) {
        logger.error("[PassthroughMode] Forward failed", {
          error: error.message,
          code: error.code,
          targetUrl,
        });
        // If forwarder throws an error with responseContext attached, use it
        if (error.responseContext) {
          responseContext = error.responseContext;
          responseContext.setMetadata("targetUrl", targetUrl);
          this.storeRequestIdInResponse(responseContext, requestId);
        } else {
          // Otherwise create error response
          const duration = Date.now() - startTime;
          const ContextFactory = require("../core/context/ContextFactory");
          responseContext = ContextFactory.createErrorResponse(502, "Backend server error", { error: error.message });
          responseContext.setLatency(duration);
          responseContext.setMetadata("targetUrl", targetUrl);
          this.storeRequestIdInResponse(responseContext, requestId);
        }
      }

      // Log backend response
      const duration = Date.now() - startTime;
      this.logBackendResponse(requestContext, responseContext, targetUrl, mode, duration, requestId);

      logger.debug("Passthrough mode: Request completed", {
        duration: Date.now() - startTime,
        status: responseContext.getStatus(),
      });

      // Return response context - interceptors will be executed by the main proxy handler
      return responseContext;
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error("Passthrough mode: Request failed", {
        error: error.message,
        duration,
      });

      // Create error response with latency for stats recording
      const ContextFactory = require("../core/context/ContextFactory");
      const errorContext = ContextFactory.createErrorResponse(502, "Backend server error", { error: error.message });
      errorContext.setLatency(duration);
      return errorContext;
    }
  }

  /**
   * Get mode name
   * @returns {string} Mode name
   */
  getModeName() {
    return "passthrough";
  }
}

module.exports = PassthroughMode;
