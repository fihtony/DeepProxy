/**
 * RecordingMode - Forward requests and record request/response pairs
 *
 * Purpose:
 * - Proxy requests to backend
 * - Record all request/response pairs to database
 * - Support replay mode by building historical data
 * - Track request dimensions for matching
 *
 * Flow:
 * 1. Execute request interceptors
 * 2. Forward request to backend
 * 3. Save request to database (api_requests)
 * 4. Execute response interceptors
 * 5. Save response to database (api_responses)
 * 6. Return response
 *
 * Usage:
 * const mode = new RecordingMode({ forwarder, interceptorChain, repositories });
 * const response = await mode.handleRequest(requestContext);
 */

const ModeHandler = require("./ModeHandler");
const logger = require("../utils/logger");
const trafficLogger = require("../utils/traffic_logger");
const { isPublicEndpoint, isSecureEndpoint, getEndpointName, isTransmitEndpoint } = require("../utils/endpoint_utils");
const secureRequestRepository = require("../database/repositories/secure_request_repository");
const publicRequestRepository = require("../database/repositories/public_request_repository");
const { extractMobileHeaders } = require("../utils/header_extractor");
const sessionManager = require("../utils/session_manager");

class RecordingMode extends ModeHandler {
  constructor(dependencies) {
    super(dependencies);
    this.apiRequestRepo = dependencies.repositories.apiRequestRepo;
    this.apiResponseRepo = dependencies.repositories.apiResponseRepo;
  }

  /**
   * Handle request in recording mode
   * @param {RequestContext} requestContext - Request context
   * @returns {Promise<ResponseContext>} Response context
   */
  async handleRequest(requestContext) {
    const startTime = Date.now();
    const current = requestContext.getCurrent();
    const original = requestContext.getOriginal();
    const clientIP = original.ip || "UNKNOWN";
    const mode = "recording";

    try {
      const userId = requestContext.getMetadata("userId");

      logger.debug("Recording mode: Processing request", {
        method: current.method,
        path: current.path,
        originalUrl: current.originalUrl,
        url: current.url,
        userId,
      });

      // Set mode in request context metadata for downstream processing
      requestContext.setMetadata("mode", mode);

      // Initialize request logging (generates request ID and logs incoming request)
      const requestId = this.initializeRequestLogging(requestContext, clientIP, mode);

      // Execute request interceptors
      const processedRequest = await this.interceptorChain.executeRequest(requestContext);

      // Get target URL - HttpForwarder will use the original URL if it starts with http/https
      // Otherwise, it will combine with baseUrl
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
      const forwardedHeaders = { ...current.headers };

      // CRITICAL: For transmit endpoints, DO NOT modify headers
      // Transmit endpoints use content-signature based on exact headers + body
      // Any modification will invalidate the signature
      if (!isTransmitEndpoint(current.path)) {
        forwardedHeaders.host = urlObj.host; // Set correct backend host
      }
      // For transmit endpoints, axios will automatically set the host header from the URL
      // and we've already preserved content-signature in HttpForwarder._prepareHeaders()

      // Log forwarded request with complete target URL
      this.logForwardedRequest(requestContext, targetUrl, mode, forwardedHeaders, requestId);

      // Forward to backend first
      let responseContext;
      try {
        responseContext = await this.forwarder.forward(processedRequest);
        responseContext.setLatency(Date.now() - startTime);
        // Store target URL in response metadata for schema detection (HTTP vs HTTPS)
        responseContext.setMetadata("targetUrl", targetUrl);
        // Store request ID in response metadata (will also be set by logBackendResponse)
        this.storeRequestIdInResponse(responseContext, requestId);
      } catch (error) {
        // If forwarder throws an error with responseContext attached, use it
        const duration = Date.now() - startTime;
        if (error.responseContext) {
          responseContext = error.responseContext;
          responseContext.setMetadata("targetUrl", targetUrl);
          this.storeRequestIdInResponse(responseContext, requestId);
        } else {
          // Otherwise create error response
          const ContextFactory = require("../core/context/ContextFactory");
          responseContext = ContextFactory.createErrorResponse(502, "Backend server error", { error: error.message });
          responseContext.setLatency(duration);
          responseContext.setMetadata("targetUrl", targetUrl);
          this.storeRequestIdInResponse(responseContext, requestId);
        }
      }
      const duration = Date.now() - startTime;

      // Log backend response
      this.logBackendResponse(requestContext, responseContext, targetUrl, mode, duration, requestId);

      // Check if this request should trigger session creation (configurable or legacy)
      // Must extract userId BEFORE saving to database so secure endpoints are recorded with userId
      const shouldCreate = sessionManager.shouldCreateSession(requestContext, "[RECORDING_MODE]");

      logger.info("[RECORDING_MODE] Checking for session creation trigger", {
        originalUrl: current.originalUrl,
        url: current.url,
        path: current.path,
        shouldCreate,
      });

      if (shouldCreate) {
        logger.info("[RECORDING_MODE] Processing session creation trigger", {
          originalUrl: current.originalUrl,
          path: current.path,
        });

        // Use configurable extraction (falls back to legacy if no config)
        const extractedUserId = sessionManager.extractUserIdFromRequest(requestContext, "[RECORDING_MODE]");
        if (extractedUserId) {
          const user = sessionManager.getOrCreateUser(extractedUserId, "[RECORDING_MODE]");
          if (user) {
            // Attach user ID to requestContext metadata BEFORE saving so it's recorded in database
            requestContext.setMetadata("userId", user.id);

            logger.info("[RECORDING_MODE] User ID attached to context for database saving", {
              extractedUserId,
              userId: user.id,
            });
          } else {
            logger.warn("[RECORDING_MODE] Failed to get or create user from authentication request", {
              extractedUserId,
              note: "Ensure session config has matching session create rule",
            });
          }
        } else {
          logger.warn("[RECORDING_MODE] No user ID extracted from authentication request", {
            originalUrl: current.originalUrl,
            path: current.path,
            note: "Request does not match any session create rule",
          });
        }
      }

      // CRITICAL: Save the original backend response to database BEFORE any DProxy modifications
      // This ensures the saved response matches what was received from the backend
      // By this point, userId has been extracted and attached to requestContext (if applicable)
      // Session cookies, token tracking, and other DProxy modifications will be applied
      // to the response returned to the client, but NOT saved to the database
      await this._saveRequestAndResponse(processedRequest, responseContext, duration);

      // Now create session and add cookies if needed (after database save)
      if (shouldCreate) {
        const extractedUserId = sessionManager.extractUserIdFromRequest(requestContext, "[RECORDING_MODE]");
        if (extractedUserId) {
          const user = sessionManager.getOrCreateUser(extractedUserId, "[RECORDING_MODE]");
          if (user) {
            // Create DPSESSION cookie
            const headers = current.headers || {};
            const sessionResult = sessionManager.createSessionAndCookie(user.id, headers, "[RECORDING_MODE]");
            if (sessionResult) {
              // Add all DPSESSION cookies to response (for multiple domains)
              const existingCookies = responseContext.getHeader("set-cookie") || [];
              const cookieArray = Array.isArray(existingCookies) ? [...existingCookies] : existingCookies ? [existingCookies] : [];

              // Add all cookie headers for different domains
              if (sessionResult.cookieHeaders && Array.isArray(sessionResult.cookieHeaders)) {
                cookieArray.push(...sessionResult.cookieHeaders);
              } else if (sessionResult.cookieHeader) {
                // Backward compatibility: if only single cookie header exists
                cookieArray.push(sessionResult.cookieHeader);
              }

              responseContext.setHeader("Set-Cookie", cookieArray);

              logger.info("[RECORDING_MODE] DPSESSION cookies added to response", {
                userId: user.id,
                sessionId: sessionResult.session.id,
                cookieCount: sessionResult.cookieHeaders?.length || 1,
                totalCookies: cookieArray.length,
              });
            }
          }
        }
      }

      // Process User Session and JWT token for cross-domain tracking
      // These modifications apply to the response returned to client but not to saved database record
      await this._processTokenTracking(requestContext, responseContext);

      logger.info("Recording mode: Request completed", {
        duration,
        status: responseContext.getStatus(),
      });

      // Return response context - interceptors will be executed by the main proxy handler
      return responseContext;
    } catch (error) {
      logger.error("Recording mode: Request failed", {
        error: error.message,
        duration: Date.now() - startTime,
      });

      // Create error response
      const ContextFactory = require("../core/context/ContextFactory");
      const errorResponse = ContextFactory.createErrorResponse(502, "Backend server error", { error: error.message });

      // Try to save error response if this was a monitored request
      try {
        const headers = current.headers || {};
        const userAgent = headers["user-agent"] || "";
        const isMonitored = true; // All requests reaching here are monitored (checked by RequestTypeDetector)

        if (isMonitored) {
          // Create a mock response context for error
          const errorResponseContext = ContextFactory.createResponseContext();
          errorResponseContext.setStatus(502);
          errorResponseContext.setBody({ error: error.message });
          errorResponseContext.setLatency(Date.now() - startTime);

          await this._saveRequestAndResponse(requestContext, errorResponseContext, Date.now() - startTime);
        }
      } catch (saveError) {
        logger.error("Recording mode: Failed to save error response", {
          error: saveError.message,
        });
      }

      return errorResponse;
    }
  }

  /**
   * Save request and response to database (for monitored traffic)
   * Uses secureRequestRepository or publicRequestRepository based on endpoint type
   * @private
   */
  async _saveRequestAndResponse(requestContext, responseContext, duration) {
    const current = requestContext.getCurrent();
    const original = requestContext.getOriginal();
    const userId = requestContext.getMetadata("userId");
    const headers = current.headers || {};

    // All requests reaching here are monitored (verified by RequestTypeDetector)
    const userAgent = headers["user-agent"] || "";
    const isMonitored = true;

    // Extract correlation_id and traceability_id from headers (case-insensitive)
    // These headers are sent by monitored app for request tracking
    const correlationId = requestContext.getHeader("x-correlation-id") || null;
    const traceabilityId = requestContext.getHeader("x-traceability-id") || null;

    // Only record monitored traffic
    if (!isMonitored) {
      logger.debug("Skipping recording for non-monitored request", {
        path: current.path,
        originalUrl: original.originalUrl || original.url,
      });
      return null;
    }

    // Extract mobile headers - must pass url/originalUrl for query parameter extraction
    const mobileHeaders = extractMobileHeaders({
      headers,
      url: original.url,
      originalUrl: original.originalUrl,
    });

    // Prepare response object
    const responseObj = {
      status: responseContext.getStatus(),
      headers: responseContext.getHeaders(),
      body: responseContext.getBody(),
    };

    // Extract endpoint path from full URL (like StatsRecordingInterceptor does)
    // Priority: targetUrl from response metadata > originalUrl > current.url > current.path
    const targetUrl = responseContext.getMetadata("targetUrl");
    const originalRequestUrl = original.originalUrl || original.url || "";
    const currentRequestUrl = current.url || current.originalUrl || "";

    let endpointPath = current.path || "/";
    let host = null;

    // Try to extract path and host from full URL
    try {
      if (targetUrl && (targetUrl.startsWith("http://") || targetUrl.startsWith("https://"))) {
        const url = new URL(targetUrl);
        endpointPath = url.pathname || "/";
        host = url.origin;
      } else if (originalRequestUrl && (originalRequestUrl.startsWith("http://") || originalRequestUrl.startsWith("https://"))) {
        const url = new URL(originalRequestUrl);
        endpointPath = url.pathname || "/";
        host = url.origin;
      } else if (currentRequestUrl && (currentRequestUrl.startsWith("http://") || currentRequestUrl.startsWith("https://"))) {
        const url = new URL(currentRequestUrl);
        endpointPath = url.pathname || "/";
        host = url.origin;
      }
    } catch (e) {
      // URL parsing failed, use current.path as fallback
      logger.error("Failed to parse URL for endpoint path extraction", {
        targetUrl,
        originalRequestUrl,
        currentRequestUrl,
        error: e.message,
      });
    }

    // Remove query parameters from endpoint path
    if (endpointPath.includes("?")) {
      endpointPath = endpointPath.split("?")[0];
    }

    const endpointName = getEndpointName(endpointPath);
    const isSecure = isSecureEndpoint(endpointPath);

    logger.info("[RECORDING_MODE] Endpoint classification", {
      endpointPath,
      endpointName,
      isSecure,
    });

    // Extract query params from URL if present
    let queryParams = null;
    try {
      // Use the same URL source as endpointPath extraction
      const urlForQuery = targetUrl || originalRequestUrl || currentRequestUrl || `http://example.com${endpointPath}`;
      const urlObj = new URL(urlForQuery);
      if (urlObj.search) {
        queryParams = {};
        urlObj.searchParams.forEach((value, key) => {
          queryParams[key] = value;
        });
      }
    } catch (e) {
      // URL parsing failed, use empty query params
      queryParams = null;
    }

    try {
      if (isSecure) {
        // For secure endpoints, try to extract userId using enhanced lookup
        // Order: DPSESSION -> Configured session cookies -> Bearer token
        let finalUserId = userId;
        if (!finalUserId) {
          finalUserId = sessionManager.getUserIdFromRequest(headers, "[RECORDING_MODE]");
          if (finalUserId) {
            logger.info("[RECORDING_MODE] User ID extracted for secure endpoint", {
              endpointPath,
              userId: finalUserId,
            });
          }
        }

        if (!finalUserId) {
          // Save the response even without userId, log a warning message
          logger.warn("Secure endpoint without userId from any auth method", { endpointPath });
        } else {
          // If user_id found and this is a cross-domain request (no DPSESSION in request),
          // add DPSESSION cookie for this domain so future requests will include it
          sessionManager.addCrossDomainDPSessionCookie(responseContext, headers, host, finalUserId, "[RECORDING_MODE]");
        }

        await secureRequestRepository.saveSecureRequest(
          finalUserId,
          endpointPath,
          current.method,
          queryParams,
          headers,
          current.body || null,
          responseObj,
          mobileHeaders,
          duration,
          correlationId,
          traceabilityId,
          "secure",
          host
        );
      } else {
        // For public endpoints, userId can be null
        await publicRequestRepository.savePublicRequest(
          userId || null,
          endpointPath,
          current.method,
          queryParams,
          headers,
          current.body || null,
          responseObj,
          mobileHeaders,
          duration,
          correlationId,
          traceabilityId,
          "public",
          host
        );
      }

      logger.debug("Recording mode: Request and response saved", {
        endpointPath,
        isSecure,
        userId,
        status: responseObj.status,
      });
    } catch (error) {
      logger.error("Recording mode: Failed to save request/response", {
        error: error.message,
        endpointPath,
      });
      // Don't throw - recording failure shouldn't break the request
    }
  }

  /**
   * Process session token tracking using configurable rules
   *
   * This method uses session configuration to:
   * 1. Find matching update rules for the current request/response
   * 2. Extract tokens from response based on configured sources (cookie, body, header)
   * 3. Update session with extracted tokens (u_session/us_hash or oauth_token/oauth_hash)
   *
   * Falls back to legacy behavior if no session config exists.
   *
   * Session lookup order:
   * - First try DPSESSION cookie (primary domain)
   * - Then try configured cookie session names
   * - Then try Bearer token
   *
   * @private
   */
  async _processTokenTracking(requestContext, responseContext) {
    const current = requestContext.getCurrent();
    const headers = current.headers || {};
    const cookieHeader = headers.cookie || "";
    const originalUrl = current.originalUrl || current.url || "";

    // Extract endpoint path from originalUrl
    let endpointPath = "/";
    try {
      if (originalUrl.includes("://")) {
        const urlObj = new URL(originalUrl);
        endpointPath = urlObj.pathname;
      } else {
        endpointPath = originalUrl.split("?")[0];
      }
    } catch (e) {
      endpointPath = originalUrl.split("?")[0];
    }

    logger.info("[RECORDING_MODE] _processTokenTracking called", {
      originalUrl,
      hasCookie: !!cookieHeader,
      cookieLength: cookieHeader.length,
    });

    try {
      let session = null;

      // 1. Try to find session by DPSESSION cookie
      const dpSessionMatch = cookieHeader.match(/DPSESSION=([^;]+)/);
      if (dpSessionMatch && dpSessionMatch[1]) {
        const dpSession = dpSessionMatch[1];
        session = sessionManager.getSessionByDPSession(dpSession);
        if (session) {
          logger.info("[RECORDING_MODE] Session found via DPSESSION", {
            sessionId: session.id,
          });
        }
      }

      // 2. If no session from DPSESSION, try configured cookie sessions or legacy lookup
      if (!session) {
        const { getInstance: getSessionConfigManager } = require("../config/SessionConfigManager");
        const sessionConfigManager = getSessionConfigManager();

        if (sessionConfigManager.hasConfig()) {
          // Use configured cookie names for lookup
          const cookieRules = sessionConfigManager.getUpdateRulesByType("cookie");
          for (const rule of cookieRules) {
            const regex = new RegExp(`${rule.key}=([^;]+)`, "i");
            const match = cookieHeader.match(regex);
            if (match && match[1]) {
              const tokenHash = sessionManager.hashToken(match[1]);
              const sessionRepository = require("../database/repositories/session_repository");
              session = sessionRepository.getSessionBySessionHash(tokenHash);
              if (session) {
                logger.info("[RECORDING_MODE] Session found via configured cookie", {
                  sessionId: session.id,
                  cookieName: rule.key,
                });
                break;
              }
            }
          }
        }

        // Fall back to legacy configured user session lookup
        if (!session) {
          const sessionConfigManager2 = sessionConfigManager;
          if (sessionConfigManager2.hasConfig()) {
            const cookieRules = sessionConfigManager2.getUpdateRulesByType("cookie");
            for (const rule of cookieRules) {
              const regex = new RegExp(`${rule.key}=([^;]+)`, "i");
              const match = cookieHeader.match(regex);
              if (match && match[1]) {
                const tokenValue = match[1];
                const tokenHash = sessionManager.hashToken(tokenValue);
                const sessionRepository = require("../database/repositories/session_repository");
                session = sessionRepository.getSessionBySessionHash(tokenHash);
                if (session) {
                  logger.info("[RECORDING_MODE] Session found via legacy user session lookup", {
                    sessionId: session.id,
                    cookieName: rule.key,
                  });
                  break;
                }
              }
            }
          }
        }
      }

      if (!session) {
        // Only log WARN if this is NOT a public endpoint
        if (!isPublicEndpoint(endpointPath)) {
          logger.warn("[RECORDING_MODE] No session found for token tracking, skipping", {
            hasDPSESSION: !!dpSessionMatch,
          });
        }
        return;
      }

      // 3. Process session updates using configurable rules
      const updateResult = sessionManager.processSessionUpdates(session, responseContext, requestContext, "[RECORDING_MODE]");

      logger.info("[RECORDING_MODE] Session update processing complete", {
        sessionId: session.id,
        cookieUpdates: updateResult.cookieUpdates,
        authUpdates: updateResult.authUpdates,
      });
    } catch (error) {
      logger.error("[RECORDING_MODE] Failed to process token tracking", {
        error: error.message,
        stack: error.stack,
      });
      // Don't throw - token tracking failure shouldn't break the request
    }
  }

  /**
   * Get recording statistics
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Recording statistics
   */
  async getStats(userId) {
    const requestCount = await this.apiRequestRepo.count({ user_id: userId });
    const responseCount = await this.apiResponseRepo.countBySource();
    const endpoints = await this.apiRequestRepo.getUniqueEndpoints(userId);

    return {
      totalRequests: requestCount,
      totalResponses: responseCount.backend + responseCount.dproxy + responseCount.custom,
      uniqueEndpoints: endpoints.length,
      bySource: responseCount,
    };
  }
  /**
   * Get mode name
   * @returns {string} Mode name
   */
  getModeName() {
    return "recording";
  }
}

module.exports = RecordingMode;
