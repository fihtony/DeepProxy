/**
 * Statistics Recording Interceptor
 *
 * Records API performance statistics for monitored requests to the stats table.
 * Only records requests that match configured monitoring criteria (header/query pattern and domain).
 *
 * Records per: HTTP method, endpoint path (no query params), app_platform, app_version, app_environment
 */

const ResponseInterceptor = require("./ResponseInterceptor");
const logger = require("../../utils/logger");
const { getLocalISOString } = require("../../utils/datetimeUtils");

class StatsRecordingInterceptor extends ResponseInterceptor {
  constructor(options = {}) {
    super({ name: "StatsRecording", priority: 1, ...options });
    this.logger = options.logger || logger;
  }

  /**
   * Main interception logic
   * Only records stats for:
   * - Monitored requests (matching configured monitor criteria and domain)
   * - Passthrough mode or Recording mode (NOT Replay mode)
   * @param {ResponseContext} context - Response context
   * @param {RequestContext} requestContext - Request context
   * @returns {Promise<ResponseContext>} Modified context
   */
  async intercept(context, requestContext) {
    if (!requestContext) {
      this.logger.warn("[StatsRecording] ⚠️ No requestContext, skipping");
      return context;
    }

    try {
      const request = requestContext.getCurrent();
      if (!request) {
        this.logger.warn("[StatsRecording] ⚠️ No request in context, skipping");
        return context;
      }

      const status = context.getStatus();
      const headers = request.headers || {};
      const responseMetadata = context.getAllMetadata();
      const requestMetadata = requestContext.metadata || {};

      // Only record monitored requests (checked by RequestTypeDetector earlier in the pipeline)
      // The request has already been verified to match monitor criteria and domain
      // If we reach here, it's a monitored request; non-monitored requests bypass response interceptors
      const userAgent = headers["user-agent"] || headers["User-Agent"] || headers["USER-AGENT"] || "";
      const isMonitored = true; // All requests reaching this interceptor are monitored
      // Check current mode - skip Replay mode
      const mode = requestMetadata.mode || "unknown";
      const isReplayMode = mode === "replay";

      this.logger.info("[StatsRecording] Incoming Request", {
        request: `${request.method} ${request.path}`,
        userAgent: userAgent.substring(0, 80),
        isMonitored,
        mode,
        isReplayMode,
        allHeaderKeys: Object.keys(headers).slice(0, 20), // First 20 headers for debugging
        mobilePlatform: headers["mobile-platform"],
        mobileVersion: headers["mobile-version"],
        mobileEnvironment: headers["mobile-environment"],
        acceptLanguage: headers["accept-language"],
      });

      if (!isMonitored) {
        return context;
      }

      // Skip if in Replay mode (only record for Passthrough and Recording modes)
      if (isReplayMode) {
        return context;
      }

      // Extract relevant information; prefer request metadata (set by RequestInterceptor from config type=mapping), then headers; use "" to avoid null in DB
      const method = request.method || "GET";
      const appPlatform = requestMetadata.appPlatform ?? headers["mobile-platform"] ?? "";
      const appVersion = requestMetadata.appVersion ?? headers["mobile-version"] ?? "";
      const appEnvironment = requestMetadata.appEnvironment ?? headers["mobile-environment"] ?? "";
      const appLanguage = requestMetadata.appLanguage ?? headers["accept-language"] ?? "";
      const duration = responseMetadata.latency || 0;

      // Extract original request URL
      const originalRequest = requestContext.getOriginal();
      const originalRequestUrl = originalRequest?.originalUrl || originalRequest?.url || "";
      const originalProtocol = originalRequest?.protocol || "http";

      const currentRequestUrl = request.originalUrl || request.url || "";
      const targetUrl = responseMetadata?.targetUrl;

      // Determine URL to use for host extraction
      let urlForHost = targetUrl;

      if (!urlForHost || (!urlForHost.startsWith("http://") && !urlForHost.startsWith("https://"))) {
        if (originalRequestUrl && (originalRequestUrl.startsWith("http://") || originalRequestUrl.startsWith("https://"))) {
          urlForHost = originalRequestUrl;
        } else if (originalRequestUrl) {
          const hostname = originalRequest?.hostname || request.headers?.host || "unknown";
          const cleanHostname = hostname.replace(":443", "").replace(":80", "");
          const protocol = targetUrl ? (targetUrl.startsWith("https://") ? "https" : "http") : originalProtocol;
          urlForHost = `${protocol}://${cleanHostname}${originalRequestUrl}`;
        } else {
          urlForHost = currentRequestUrl;
        }
      }

      // Extract host and endpoint_path from the full URL
      const { host, endpointPath } = this.extractHostAndPath(urlForHost, requestContext, {
        originalRequestUrl,
        targetUrl,
        currentRequestUrl,
      });

      // Extract response length from response body or headers
      const responseHeaders = context.getHeaders() || {};
      const responseBody = context.getBody();
      const responseLength = this.calculateResponseLength(responseBody, responseHeaders);

      // Record statistics asynchronously (don't block response)
      setImmediate(() => {
        this.recordStat({
          host,
          endpointPath,
          method,
          appPlatform,
          appVersion,
          appEnvironment,
          appLanguage,
          responseStatus: status,
          responseLength,
          latencyMs: duration,
        }).catch((error) => {
          this.logger.error("[StatsRecording] Error recording statistic", {
            error: error.message,
            stack: error.stack,
            endpoint: endpointPath,
            host,
            method,
          });
        });
      });

      return context;
    } catch (error) {
      this.logger.error("[StatsRecording] ❌ CRITICAL ERROR in intercept()", {
        error: error.message,
        stack: error.stack,
        timestamp: getLocalISOString(),
      });
      // Don't throw - return context to not break the request flow
      return context;
    }
  }

  /**
   * Extract endpoint path without query parameters
   * @param {string} fullPath - Full path with query params
   * @returns {string} Path without query params
   */
  extractEndpointPath(fullPath) {
    if (!fullPath) return "";

    // Remove query string (everything after ?)
    const pathOnly = fullPath.split("?")[0];

    // Remove fragment (everything after #)
    return pathOnly.split("#")[0];
  }

  /**
   * Extract both host and endpoint path from a full URL
   * @param {string} urlString - Full URL (e.g., https://example.com/posts/1?id=1)
   * @param {RequestContext} requestContext - Request context for fallback
   * @param {Object} options - Additional options with URL sources
   * @returns {Object} Object with host and endpointPath
   */
  extractHostAndPath(urlString, requestContext, options = {}) {
    const { originalRequestUrl, targetUrl } = options;

    try {
      // PRIORITY 1: If urlString is a full URL (starts with http:// or https://)
      if (urlString && (urlString.startsWith("http://") || urlString.startsWith("https://"))) {
        const url = new URL(urlString);
        return {
          host: url.hostname,
          endpointPath: this.extractEndpointPath(url.pathname),
        };
      }

      // PRIORITY 2: Try original request URL
      if (originalRequestUrl && (originalRequestUrl.startsWith("http://") || originalRequestUrl.startsWith("https://"))) {
        const url = new URL(originalRequestUrl);
        return {
          host: url.hostname,
          endpointPath: this.extractEndpointPath(url.pathname),
        };
      }

      // PRIORITY 3: Try target URL
      if (targetUrl && (targetUrl.startsWith("http://") || targetUrl.startsWith("https://"))) {
        const url = new URL(targetUrl);
        return {
          host: url.hostname,
          endpointPath: this.extractEndpointPath(url.pathname),
        };
      }

      // PRIORITY 4: Try to extract from request context
      const originalRequest = requestContext?.getOriginal();
      const originalUrl = originalRequest?.originalUrl || originalRequest?.url;

      if (originalUrl && (originalUrl.startsWith("http://") || originalUrl.startsWith("https://"))) {
        const url = new URL(originalUrl);
        return {
          host: url.hostname,
          endpointPath: this.extractEndpointPath(url.pathname),
        };
      }

      // PRIORITY 5: Fallback: try to get host from headers and use urlString as path
      const headers = requestContext?.getCurrent()?.headers || {};
      const hostHeader = headers.host || headers.Host;

      if (hostHeader) {
        const cleanHostname = hostHeader.split(":")[0];
        return {
          host: cleanHostname,
          endpointPath: this.extractEndpointPath(urlString || "/"),
        };
      }

      // Last resort: return defaults
      const request = requestContext?.getCurrent();
      const path = request?.path || "/";
      const hostname = request?.headers?.host || request?.headers?.Host || originalRequest?.hostname || "unknown";
      const cleanHostname = hostname.split(":")[0]; // Remove port if present

      return {
        host: cleanHostname,
        endpointPath: this.extractEndpointPath(urlString || path),
      };
    } catch (error) {
      this.logger.error("[StatsRecording] Error extracting host and path", {
        error: error.message,
        urlString: urlString?.substring(0, 100),
      });

      // Fallback to extracting from request path
      const request = requestContext?.getCurrent();
      const path = request?.path || "/";
      const hostname = request?.headers?.host || request?.headers?.Host || requestContext?.getOriginal()?.hostname || "unknown";
      const cleanHostname = hostname.split(":")[0]; // Remove port if present

      return {
        host: cleanHostname,
        endpointPath: this.extractEndpointPath(path),
      };
    }
  }

  /**
   * Calculate response length from body or headers
   * @param {*} responseBody - Response body
   * @param {Object} responseHeaders - Response headers
   * @returns {number} Response length in bytes
   */
  calculateResponseLength(responseBody, responseHeaders) {
    try {
      // Try to get from Content-Length header first
      const contentLength = responseHeaders["content-length"] || responseHeaders["Content-Length"];
      if (contentLength) {
        return parseInt(contentLength, 10) || 0;
      }

      // Calculate from body if available
      if (responseBody !== null && responseBody !== undefined) {
        if (typeof responseBody === "string") {
          return Buffer.byteLength(responseBody, "utf8");
        } else if (Buffer.isBuffer(responseBody)) {
          return responseBody.length;
        } else if (typeof responseBody === "object") {
          // JSON object
          return Buffer.byteLength(JSON.stringify(responseBody), "utf8");
        }
      }

      return 0;
    } catch (error) {
      this.logger.debug("[StatsRecording] Error calculating response length", { error: error.message });
      return 0;
    }
  }

  /**
   * Record statistics to database
   * @param {Object} statData - Statistics data
   */
  async recordStat(statData) {
    try {
      const {
        host,
        endpointPath,
        method,
        appPlatform,
        appVersion,
        appEnvironment,
        appLanguage,
        responseStatus,
        responseLength,
        latencyMs,
      } = statData;

      // Use empty string instead of null to avoid database search issues when not configured
      const normalizedPlatform = appPlatform === "" || appPlatform == null ? "" : appPlatform;
      const normalizedVersion = appVersion === "" || appVersion == null ? "" : appVersion;
      const normalizedEnvironment = appEnvironment === "" || appEnvironment == null ? "" : appEnvironment;
      const normalizedLanguage = appLanguage === "" || appLanguage == null ? "" : appLanguage;

      const dbConnection = require("../../database/connection");
      const db = dbConnection.getDatabase();

      const createdAt = getLocalISOString();

      db.prepare(
        `INSERT INTO stats (
          host,
          endpoint_path,
          method,
          app_platform,
          app_version,
          app_environment,
          app_language,
          response_status,
          response_length,
          latency_ms,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        host,
        endpointPath,
        method,
        normalizedPlatform,
        normalizedVersion,
        normalizedEnvironment,
        normalizedLanguage,
        responseStatus,
        responseLength,
        latencyMs || null,
        createdAt
      );

      this.logger.info("[StatsRecording] ✅ SUCCESS: Statistic recorded to database", {
        host,
        endpoint: endpointPath,
        method,
        platform: normalizedPlatform,
        version: normalizedVersion,
        environment: normalizedEnvironment,
        language: normalizedLanguage,
        status: responseStatus,
        responseLength,
        latency: latencyMs,
        timestamp: getLocalISOString(),
      });
    } catch (error) {
      this.logger.error("[StatsRecording] ❌ ERROR: Failed to record statistic", {
        error: error.message,
        stack: error.stack,
        endpoint: statData.endpointPath,
        host: statData.host,
        method: statData.method,
        timestamp: getLocalISOString(),
      });
      // Re-throw to ensure error is visible
      throw error;
    }
  }
}

module.exports = StatsRecordingInterceptor;
