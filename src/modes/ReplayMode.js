/**
 * ReplayMode - Return recorded responses without forwarding to backend
 *
 * Purpose:
 * - Match incoming requests against recorded requests
 * - Return recorded responses for matches
 * - Support dimension-based matching (version, language, platform, environment)
 * - Enable offline testing and development
 *
 * Flow:
 * 1. Execute request interceptors
 * 2. Search for matching request in database
 * 3. If match found: return recorded response
 * 4. If no match: return 404 or fallback behavior
 *
 * Features:
 * - Configurable fallback behavior (error, passthrough, template)
 * - Match scoring and best-match selection
 * - Support for custom responses
 * - Template-based responses for common status codes
 *
 * Usage:
 * const mode = new ReplayMode({ interceptorChain, repositories, matchingEngine });
 * const response = await mode.handleRequest(requestContext);
 */

const ModeHandler = require("./ModeHandler");
const logger = require("../utils/logger");
const trafficLogger = require("../utils/traffic_logger");
const sessionManager = require("../utils/session_manager");

class ReplayMode extends ModeHandler {
  constructor(dependencies) {
    super(dependencies);
    this.apiRequestRepo = dependencies.repositories.apiRequestRepo;
    this.apiResponseRepo = dependencies.repositories.apiResponseRepo;
    this.templateRepo = dependencies.repositories.templateRepo;
    this.matchingEngine = dependencies.matchingEngine;

    // Fallback behavior: 'error', 'passthrough', 'template'
    this.fallbackBehavior = dependencies.config?.fallbackBehavior || "error";
  }

  /**
   * Normalize query parameters by flattening array values to single values
   * This handles the case where URL has duplicate parameters like ?foo=1&foo=2
   * Express parses this as {foo: ["1", "2"]}, but database stores as {foo: "1"}
   *
   * @private
   * @param {Object} queryParams - Query parameters object (may contain arrays)
   * @returns {Object} Object containing normalized query parameters and a flag indicating if normalization occurred
   */
  _normalizeQueryParams(queryParams) {
    if (!queryParams || typeof queryParams !== "object") {
      return { normalizedQuery: queryParams, normalized: false };
    }

    const normalizedQuery = {};
    let normalized = false;
    for (const [key, value] of Object.entries(queryParams)) {
      // If value is an array, take the first element
      if (Array.isArray(value)) {
        normalizedQuery[key] = value.length > 0 ? value[0] : "";
        normalized = true;
      } else {
        normalizedQuery[key] = value;
      }
    }
    return { normalizedQuery, normalized };
  }

  /**
   * Handle request in replay mode
   * @param {RequestContext} requestContext - Request context
   * @returns {Promise<ResponseContext>} Response context
   */
  async handleRequest(requestContext) {
    const startTime = Date.now();
    const current = requestContext.getCurrent();
    const original = requestContext.getOriginal();
    const clientIP = original.ip || "UNKNOWN";
    const mode = "replay";

    try {
      let userId = requestContext.getMetadata("userId");

      // Get actual path (handles proxy mode where current.path is "/")
      const actualPath = requestContext.getActualPath();

      // Check if endpoint is secure
      const { isSecureEndpoint } = require("../utils/endpoint_utils");
      const isSecure = isSecureEndpoint(actualPath);

      logger.debug("[REPLAY_MODE] Request path analysis", {
        currentPath: current.path,
        actualPath,
        isSecure,
      });

      // Check if this request should trigger session creation (configurable or legacy)
      const shouldCreate = sessionManager.shouldCreateSession(requestContext, "[REPLAY_MODE]");
      if (shouldCreate) {
        // Use configurable extraction (falls back to legacy if no config)
        const extractedUserId = sessionManager.extractUserIdFromRequest(requestContext, "[REPLAY_MODE]");
        if (extractedUserId) {
          // Convert user_id (string identifier) to database primary key (integer)
          const userRepository = require("../database/repositories/user_repository");
          const user = userRepository.getUserByIdentifier(extractedUserId);
          if (user) {
            userId = user.id; // This is the primary key integer
            requestContext.setMetadata("userId", userId);
            // Mark that we need to create session in response
            requestContext.setMetadata("createSession", true);
            logger.info("[REPLAY_MODE] User ID extracted from session trigger - will create session", {
              userIdentifier: extractedUserId,
              userId: userId,
            });
          } else {
            logger.warn("[REPLAY_MODE] User not found in database", {
              userIdentifier: extractedUserId,
            });
          }
        } else {
          logger.warn("[REPLAY_MODE] Failed to extract user ID from session trigger request");
        }
      }

      // For secure endpoints (not session creation triggers), extract userId using enhanced lookup
      // Order: DPSESSION -> configured cookie sessions -> Bearer token
      if (isSecure && !shouldCreate) {
        logger.info("[REPLAY_MODE] Secure endpoint detected, extracting userId", {
          path: actualPath,
          isSecure,
        });

        // Use config-aware lookup
        const extractedUserId = sessionManager.getUserIdFromRequestWithConfig(current.headers, "[REPLAY_MODE]");
        if (extractedUserId) {
          userId = extractedUserId;
          requestContext.setMetadata("userId", userId);
          logger.info("[REPLAY_MODE] User ID extracted for secure endpoint", {
            path: actualPath,
            userId: userId,
          });
        } else {
          // Secure endpoint without userId is an error
          logger.error("[REPLAY_MODE] Secure endpoint without valid authentication", {
            path: actualPath,
          });

          const ContextFactory = require("../core/context/ContextFactory");
          const errorResponse = ContextFactory.createErrorResponse(401, "Authentication required", {
            error: "No valid DPSESSION, User Session, or Bearer token found for secure endpoint",
            path: actualPath,
          });
          errorResponse.setLatency(Date.now() - startTime);
          return errorResponse;
        }
      }

      logger.debug("Replay mode: Processing request", {
        method: current.method,
        path: actualPath,
        userId,
      });

      // Set mode in request context metadata for downstream processing
      requestContext.setMetadata("mode", mode);

      // Initialize request logging (generates request ID and logs incoming request)
      // Note: Replay mode does NOT forward to backend, so no "FORWARDED REQUEST TO BACKEND" log
      const requestId = this.initializeRequestLogging(requestContext, clientIP, mode);

      // Execute request interceptors
      const processedRequest = await this.interceptorChain.executeRequest(requestContext);

      // Normalize query parameters to handle duplicate parameters
      // Express parses ?foo=1&foo=2 as {foo: ["1", "2"]}, but database stores {foo: "1"}
      const { normalizedQuery, normalized } = this._normalizeQueryParams(processedRequest.getCurrent().query);
      if (Object.keys(normalizedQuery).length > 0) {
        if (normalized) {
          logger.info("[REPLAY_MODE] Query params normalized for matching", {
            method: current.method,
            path: actualPath,
            original: processedRequest.getCurrent().query,
            normalized: normalizedQuery,
          });
        }
        // Update the query params in the request context
        processedRequest.current.query = normalizedQuery;
      }

      // Find matching response for REPLAY mode
      // Pass mode='replay' to only match configurations defined for REPLAY mode
      const match = await this.matchingEngine.findMatch(processedRequest, "replay");

      let responseContext;

      if (match) {
        // Match found - return recorded response
        logger.info("Replay mode: Match found", {
          requestId: match.request.id,
          responseId: match.response.id,
          score: match.score,
        });

        responseContext = await this._createResponseFromMatch(match, processedRequest);
      } else {
        // No match - apply fallback behavior
        logger.warn("Replay mode: No match found", {
          method: current.method,
          path: actualPath,
          fallback: this.fallbackBehavior,
        });

        responseContext = await this._handleNoMatch(processedRequest);
      }

      // For config-matching endpoints, create session and add DPSESSION cookie
      if (requestContext.getMetadata("createSession") && userId) {
        const sessionResult = sessionManager.createSessionAndCookie(userId, current.headers, "[REPLAY_MODE]");
        if (sessionResult) {
          // Add all DPSESSION cookies to response (for multiple domains)
          const existingSetCookie = responseContext.getHeader("set-cookie");
          const cookies = Array.isArray(existingSetCookie) ? existingSetCookie : existingSetCookie ? [existingSetCookie] : [];

          // Add all cookie headers for different domains
          if (sessionResult.cookieHeaders && Array.isArray(sessionResult.cookieHeaders)) {
            cookies.push(...sessionResult.cookieHeaders);
          } else if (sessionResult.cookieHeader) {
            // Backward compatibility: if only single cookie header exists
            cookies.push(sessionResult.cookieHeader);
          }

          responseContext.setHeader("set-cookie", cookies);
          logger.info("[REPLAY_MODE] DPSESSION cookies added to response", {
            cookieCount: sessionResult.cookieHeaders?.length || 1,
            totalCookies: cookies.length,
          });
        }
      }

      // Set latency
      const duration = Date.now() - startTime;
      responseContext.setLatency(duration);

      // Store request ID in response metadata for client response logging
      // Note: Replay mode does NOT forward to backend, so we skip "FORWARDED REQUEST TO BACKEND"
      // and "RESPONSE FROM BACKEND" logs. Only "INCOMING CLIENT REQUEST" and "RESPONSE TO CLIENT" are logged.
      this.storeRequestIdInResponse(responseContext, requestId);
      logger.info("Replay mode: Request completed", {
        duration,
        status: responseContext.getStatus(),
        source: responseContext.getSource(),
      });

      // Return response context - interceptors will be executed by the main proxy handler
      return responseContext;
    } catch (error) {
      logger.error("Replay mode: Request failed", {
        error: error.message,
        duration: Date.now() - startTime,
      });

      // Create error response
      const ContextFactory = require("../core/context/ContextFactory");
      return ContextFactory.createErrorResponse(500, "Replay error", { error: error.message });
    }
  }

  /**
   * Create response from matched request/response
   * For secure endpoints, applies special processing:
   * 1. Replace DPSESSION in Set-Cookie with current request's DPSESSION
   * 2. Replace user session cookie in Set-Cookie with current request's DPSESSION (and update Sessions table)
   * 3. For config-matching auth endpoints, replace auth token with stored value (and update Sessions table)
   * @private
   */
  async _createResponseFromMatch(match, requestContext) {
    const { request, response } = match;

    const ContextFactory = require("../core/context/ContextFactory");
    const responseContext = ContextFactory.createResponseContextFromDatabase(response);

    // Set additional metadata
    responseContext.setMetadata("matchScore", match.score);
    responseContext.setMetadata("matchDetails", match.matchDetails);
    responseContext.setMetadata("originalRequestId", request.id);

    // Check if this is a secure endpoint (endpoint_type = 'secure')
    const isSecure = request.endpoint_type === "secure";

    if (isSecure && requestContext) {
      await this._processSecureEndpointResponse(responseContext, requestContext, request);
    }

    return responseContext;
  }

  /**
   * Process secure endpoint response with special handling
   * Handles:
   * 1. DPSESSION replacement in Set-Cookie headers
   * 2. User session cookie replacement in Set-Cookie headers
   * 3. Auth token generation for config-matching auth update rules
   * 4. Cross-domain DPSESSION cookie addition (for requests without DPSESSION but with configured session/Bearer)
   * @private
   */
  async _processSecureEndpointResponse(responseContext, requestContext, matchedRequest) {
    const current = requestContext.getCurrent();
    const original = requestContext.getOriginal();
    const actualPath = requestContext.getActualPath();

    // Get host from URL origin (like RECORDING mode does) to include protocol
    let host = null;
    const targetUrl = responseContext.getMetadata("targetUrl");
    const originalRequestUrl = original.originalUrl || original.url || "";
    const currentRequestUrl = current.url || current.originalUrl || "";

    try {
      if (targetUrl && (targetUrl.startsWith("http://") || targetUrl.startsWith("https://"))) {
        const url = new URL(targetUrl);
        host = url.origin;
      } else if (originalRequestUrl && (originalRequestUrl.startsWith("http://") || originalRequestUrl.startsWith("https://"))) {
        const url = new URL(originalRequestUrl);
        host = url.origin;
      } else if (currentRequestUrl && (currentRequestUrl.startsWith("http://") || currentRequestUrl.startsWith("https://"))) {
        const url = new URL(currentRequestUrl);
        host = url.origin;
      }
    } catch (e) {
      // URL parsing failed, try to build from headers
      const originalHeaders = original?.headers;
      const headerHost = current.headers?.host || current.headers?.Host || originalHeaders?.host || originalHeaders?.Host || "";
      if (headerHost) {
        host = original?.secure || current.headers?.["x-forwarded-proto"] === "https" ? `https://${headerHost}` : `http://${headerHost}`;
      }
    }

    // Get session info from request using multiple auth methods (DPSESSION, User Session, Bearer token)
    const sessionInfo = sessionManager.getSessionInfoFromRequest(current.headers, "[REPLAY_MODE]");

    // Check if this is a cross-domain request (no DPSESSION but found via User Session or Bearer)
    const isCrossDomainRequest = sessionInfo.authMethod && sessionInfo.authMethod !== "DPSESSION";
    const currentDPSession = sessionInfo.sessionToken;
    const sessionId = sessionInfo.sessionId;
    const userId = sessionInfo.userId;

    if (!sessionInfo.userId) {
      logger.debug("[REPLAY_MODE] No session info found, skipping secure response processing", {
        path: actualPath,
      });
      return;
    }

    logger.debug("[REPLAY_MODE] Processing secure endpoint response", {
      path: actualPath,
      authMethod: sessionInfo.authMethod,
      isCrossDomainRequest,
      hasDPSession: !!currentDPSession,
      sessionId,
      userId,
    });

    // Get current Set-Cookie headers
    let setCookieHeaders = responseContext.getHeader("set-cookie");

    // 1. Replace DPSESSION in Set-Cookie headers (if present in response)
    if (sessionManager.hasDPSessionInSetCookie(setCookieHeaders)) {
      setCookieHeaders = sessionManager.replaceDPSessionInSetCookie(setCookieHeaders, currentDPSession);
      responseContext.setHeader("set-cookie", setCookieHeaders);
      logger.info("[REPLAY_MODE] DPSESSION replaced in Set-Cookie headers", {
        path: actualPath,
      });
    }

    // 2. Replace user session cookie in Set-Cookie headers (and update Sessions table)
    if (sessionManager.hasUserSessionInSetCookie(setCookieHeaders)) {
      setCookieHeaders = sessionManager.replaceUserSessionInSetCookie(
        setCookieHeaders,
        currentDPSession, // Use DPSESSION as the new user session value
        sessionId,
        "[REPLAY_MODE]"
      );
      responseContext.setHeader("set-cookie", setCookieHeaders);
      logger.info("[REPLAY_MODE] User session cookie replaced in Set-Cookie headers", {
        path: actualPath,
        sessionId,
      });
    }

    // 3. For cross-domain requests: add DPSESSION cookie to response
    // This enables future requests to the same domain to include DPSESSION
    if (isCrossDomainRequest && host) {
      logger.debug("[REPLAY_MODE] Adding DPSESSION cookie for cross-domain request", {
        path: actualPath,
        authMethod: sessionInfo.authMethod,
        host,
        userId,
      });
      const result = sessionManager.addCrossDomainDPSessionCookie(responseContext, current.headers, host, userId, "[REPLAY_MODE]");
      if (result.success) {
        logger.info("[REPLAY_MODE] Cross-domain DPSESSION cookie added", {
          path: actualPath,
          authMethod: sessionInfo.authMethod,
          host,
          sessionToken: result.sessionToken?.substring(0, 8) + "...",
        });
      }
    }

    // 4. Handle auth token generation and replacement based on configured update rules
    const { getInstance: getSessionConfigManager } = require("../config/SessionConfigManager");
    const sessionConfigManager = getSessionConfigManager();
    const authUpdateRules = sessionConfigManager.getUpdateRulesByType("auth");

    if (authUpdateRules.length > 0) {
      const current = requestContext.getCurrent();
      const method = current.method || "GET";
      const endpoint = current.originalUrl || current.url || current.path || "";

      // Find matching auth update rule(s)
      const matchingAuthRules = authUpdateRules.filter((rule) => {
        // Check method (null means match any method)
        if (rule.method !== null && rule.method !== undefined) {
          if (rule.method.toUpperCase() !== method.toUpperCase()) return false;
        }
        // Check endpoint (null means match any endpoint)
        if (rule.endpoint !== null && rule.endpoint !== undefined) {
          try {
            const regex = new RegExp(rule.endpoint);
            if (!regex.test(endpoint)) return false;
          } catch (e) {
            return false;
          }
        }
        return true;
      });

      // Process each matching auth rule
      for (const authRule of matchingAuthRules) {
        const currentBody = responseContext.getBody();

        // Generate a new fake auth token (config-based)
        const newAuthToken = sessionManager.generateFakeAuthToken(sessionId, userId, "[REPLAY_MODE]");

        // Replace auth token in response using configured path
        const modifiedBody = sessionManager.replaceAuthTokenInResponse(currentBody, newAuthToken, authRule, sessionId, "[REPLAY_MODE]");

        if (modifiedBody !== currentBody) {
          responseContext.setBody(modifiedBody);
          logger.info("[REPLAY_MODE] Auth token replaced in response based on configured rule", {
            path: actualPath,
            sessionId,
            userId,
            rulePath: authRule.key,
            authTokenPrefix: newAuthToken.substring(0, 30) + "...",
          });
        }
      }
    }
  }

  /**
   * Handle no match scenario based on fallback behavior
   * @private
   */
  async _handleNoMatch(requestContext) {
    const ContextFactory = require("../core/context/ContextFactory");

    switch (this.fallbackBehavior) {
      case "passthrough":
        // Forward to backend (fallback to passthrough mode)
        logger.debug("Replay mode: Falling back to passthrough");
        return await this.forwarder.forward(requestContext);

      case "template":
        // Return template-based response
        logger.debug("Replay mode: Using template response");
        return await this._createTemplateResponse(404);

      case "error":
      default:
        // Return error response
        logger.debug("Replay mode: Returning error response");
        return ContextFactory.createErrorResponse(404, "No matching response found", {
          message: "No recorded response matches this request",
          suggestion: "Try recording mode first to capture responses",
        });
    }
  }

  /**
   * Create response from template
   * @private
   */
  async _createTemplateResponse(status) {
    const template = await this.templateRepo.getTemplateForStatus(status);

    if (!template) {
      const ContextFactory = require("../core/context/ContextFactory");
      return ContextFactory.createErrorResponse(status, "No template found");
    }

    const ContextFactory = require("../core/context/ContextFactory");
    return ContextFactory.createResponseContextFromTemplate(template);
  }

  /**
   * Get replay statistics
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Replay statistics
   */
  async getStats(userId) {
    const stats = await this.matchingEngine.getMatchStats(userId);

    return {
      ...stats,
      fallbackBehavior: this.fallbackBehavior,
    };
  }

  /**
   * Set fallback behavior
   * @param {string} behavior - 'error', 'passthrough', or 'template'
   */
  setFallbackBehavior(behavior) {
    const validBehaviors = ["error", "passthrough", "template"];

    if (!validBehaviors.includes(behavior)) {
      throw new Error(`Invalid fallback behavior: ${behavior}`);
    }

    this.fallbackBehavior = behavior;
    logger.info("Replay mode: Fallback behavior updated", { behavior });
  }

  /**
   * Get fallback behavior
   * @returns {string} Current fallback behavior
   */
  getFallbackBehavior() {
    return this.fallbackBehavior;
  }

  /**
   * Test match for request (without executing)
   * @param {RequestContext} requestContext - Request context
   * @returns {Promise<Object|null>} Match result or null
   */
  async testMatch(requestContext) {
    return await this.matchingEngine.findMatch(requestContext, "replay");
  }

  /**
   * Get all possible matches for request
   * @param {RequestContext} requestContext - Request context
   * @returns {Promise<Array>} Array of matches with scores
   */
  async getAllMatches(requestContext) {
    return await this.matchingEngine.findAllMatches(requestContext);
  }

  /**
   * Get mode name
   * @returns {string} Mode name
   */
  getModeName() {
    return "replay";
  }
}

module.exports = ReplayMode;
