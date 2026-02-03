/**
 * Session Manager - Common DPSESSION management utilities
 *
 * Purpose:
 * - Provide shared session management functions for Recording and Replay modes
 * - Handle DPSESSION cookie creation and parsing
 * - Extract user ID from DPSESSION cookie
 * - Extract user ID from configurable request sources (body, header, query)
 * - Track user ID via configurable session tokens (cookie, auth)
 * - Support configurable session creation and update rules
 *
 * Usage:
 * const sessionManager = require('../utils/session_manager');
 * const result = sessionManager.createSessionAndCookie(userId, headers);
 * const userId = sessionManager.getUserIdFromDPSession(headers);
 * const userId = sessionManager.getUserIdFromRequest(headers); // Enhanced lookup with config
 */

const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const logger = require("./logger");
const config = require("../config");
const sessionRepository = require("../database/repositories/session_repository");
const userRepository = require("../database/repositories/user_repository");
const { getLocalISOString } = require("./datetimeUtils");
const { getMonitoredDomains, createMonitoredDomainCookies } = require("./cookieDomainHelper");
const { getInstance: getSessionConfigManager } = require("../config/SessionConfigManager");

// JWT configuration for fake token generation in REPLAY mode
const JWT_SECRET = "dproxy-fake-jwt-secret-key-for-replay-mode";
const JWT_EXPIRY_HOURS = 1;

/**
 * Create session and DPSESSION cookie
 * @param {number} userId - User ID (database primary key)
 * @param {Object} headers - Request headers
 * @param {string} logPrefix - Log prefix for tracking (e.g., "[RECORDING_MODE]" or "[REPLAY_MODE]")
 * @returns {Object|null} { session, cookieHeader } or null
 */
function createSessionAndCookie(userId, headers, logPrefix = "[SESSION_MANAGER]") {
  try {
    // Generate session token
    const sessionToken = crypto.randomUUID();

    // Extract request headers
    const requestHeaders = {
      platform: headers["mobile-platform"] || null,
      version: headers["mobile-version"] || null,
      environment: headers["mobile-environment"] || null,
      language: headers["accept-language"] || null,
    };

    // Calculate expiry time using session config if available
    const sessionConfigManager = getSessionConfigManager();
    const sessionSettings = sessionConfigManager.getSessionSettings();
    const expirySeconds = sessionSettings.expiry || 86400; // Default 24 hours

    const expiresAt = new Date();
    expiresAt.setSeconds(expiresAt.getSeconds() + expirySeconds);

    // Create session in database
    const session = sessionRepository.createSession(
      userId,
      sessionToken,
      null, // deviceId
      requestHeaders,
      getLocalISOString(expiresAt)
    );

    // Create cookie headers for all monitored domains
    const cookieHeaders = createMonitoredDomainCookies(sessionToken);
    const domains = getMonitoredDomains();

    logger.info(`${logPrefix} DPSESSION cookies created for multiple domains`, {
      userId,
      sessionId: session.id,
      sessionToken: sessionToken.substring(0, 12) + "...",
      tokenLength: sessionToken.length,
      tokenStored: session.p_session ? session.p_session.substring(0, 12) + "..." : "NOT SET",
      tokenMatch: sessionToken === session.p_session,
      domains,
      cookieCount: cookieHeaders.length,
      expirySeconds,
      cookie: cookieHeaders[0] ? cookieHeaders[0].substring(0, 80) + "..." : "NO COOKIES",
    });

    return {
      session,
      cookieHeaders, // Array of cookie strings
      cookieHeader: cookieHeaders[0], // For backward compatibility
    };
  } catch (error) {
    logger.error(`${logPrefix} Failed to create session and cookie`, {
      userId,
      error: error.message,
    });
    return null;
  }
}

/**
 * Extract DPSESSION cookie and get user_id from sessions table
 * @param {Object} headers - Request headers
 * @param {string} logPrefix - Log prefix for tracking (e.g., "[RECORDING_MODE]" or "[REPLAY_MODE]")
 * @returns {number|null} User ID from sessions table or null
 */
function getUserIdFromDPSession(headers, logPrefix = "[SESSION_MANAGER]") {
  try {
    const cookieHeader = headers.cookie || "";
    const sessionTokenMatch = cookieHeader.match(/DPSESSION=([^;]+)/);

    if (!sessionTokenMatch || !sessionTokenMatch[1]) {
      logger.debug(`${logPrefix} DPSESSION cookie not found in request`);
      return null;
    }

    const sessionToken = sessionTokenMatch[1];
    const tokenPrefix = sessionToken.substring(0, 12) + "...";
    logger.info(`${logPrefix} DPSESSION cookie found in request`, {
      sessionToken: tokenPrefix,
      fullTokenLength: sessionToken.length,
    });

    // Lookup session in database
    const session = sessionRepository.getSessionByToken(sessionToken);

    if (!session) {
      logger.error(
        `${logPrefix} Session not found for DPSESSION token - possible causes: token mismatch, session expired, or cookie not properly stored`,
        {
          sessionToken: tokenPrefix,
          tokenLength: sessionToken.length,
          cookieHeaderLength: cookieHeader.length,
          firstFewCookies: cookieHeader.substring(0, 100),
        }
      );
      return null;
    }

    logger.info(`${logPrefix} User ID retrieved from DPSESSION`, {
      sessionToken: tokenPrefix,
      userId: session.user_id,
      expiresAt: session.expires_at,
    });

    return session.user_id;
  } catch (error) {
    logger.error(`${logPrefix} Failed to extract user ID from DPSESSION`, {
      error: error.message,
      stack: error.stack,
    });
    return null;
  }
}

/**
 * Check if request matches a session creation trigger from config
 * @param {RequestContext} requestContext - Request context
 * @param {string} logPrefix - Log prefix for tracking
 * @returns {Object|null} { rule, userIdentifier } or null if no match
 */
function checkSessionCreationTrigger(requestContext, logPrefix = "[SESSION_MANAGER]") {
  try {
    const sessionConfigManager = getSessionConfigManager();

    // If no session config, return null (will fall back to legacy behavior)
    if (!sessionConfigManager.hasConfig()) {
      logger.debug(`${logPrefix} No session config found, skipping configurable trigger check`);
      return null;
    }

    const current = requestContext.getCurrent();
    const method = current.method || "GET";
    const endpoint = current.originalUrl || current.url || current.path || "";

    // Find matching create rule
    const rule = sessionConfigManager.findMatchingCreateRule(method, endpoint);

    if (!rule) {
      logger.debug(`${logPrefix} No matching create rule found`, { method, endpoint });
      return null;
    }

    logger.info(`${logPrefix} Matched session create rule`, {
      method,
      endpoint,
      ruleEndpoint: rule.endpoint,
      ruleSource: rule.source,
      ruleKey: rule.key,
    });

    // Extract user identifier using config
    const userIdentifier = sessionConfigManager.extractValueFromRequest(requestContext, rule.source, rule.key, rule.pattern);

    if (!userIdentifier) {
      logger.warn(`${logPrefix} Failed to extract user identifier from request`, {
        source: rule.source,
        key: rule.key,
        pattern: rule.pattern,
      });
      return null;
    }

    logger.info(`${logPrefix} User identifier extracted via config`, {
      userIdentifier,
      source: rule.source,
      key: rule.key,
    });

    return { rule, userIdentifier };
  } catch (error) {
    logger.error(`${logPrefix} Failed to check session creation trigger`, {
      error: error.message,
    });
    return null;
  }
}

/**
 * Extract user ID from request using configurable rules from session config
 * @param {RequestContext} requestContext - Request context
 * @param {string} logPrefix - Log prefix for tracking (e.g., "[RECORDING_MODE]" or "[REPLAY_MODE]")
 * @returns {string|null} User ID (string identifier) or null
 */
function extractUserIdFromRequest(requestContext, logPrefix = "[SESSION_MANAGER]") {
  try {
    // Use configurable extraction based on session config create rules
    const triggerResult = checkSessionCreationTrigger(requestContext, logPrefix);
    if (triggerResult) {
      return triggerResult.userIdentifier;
    }

    // No matching create rule found
    logger.debug(`${logPrefix} No matching create rule to extract user ID from request`);
    return null;
  } catch (error) {
    logger.error(`${logPrefix} Failed to extract user ID from request`, {
      error: error.message,
    });
    return null;
  }
}

/**
 * Check if request should trigger session creation (based on config or legacy pattern)
 * @param {RequestContext} requestContext - Request context
 * @param {string} logPrefix - Log prefix
 * @returns {boolean} True if should create session
 */
function shouldCreateSession(requestContext, logPrefix = "[SESSION_MANAGER]") {
  const sessionConfigManager = getSessionConfigManager();
  const current = requestContext.getCurrent();
  const method = current.method || "GET";
  const endpoint = current.originalUrl || current.url || current.path || "";

  // If config exists, check against create rules
  if (sessionConfigManager.hasConfig()) {
    const rule = sessionConfigManager.findMatchingCreateRule(method, endpoint);
    return rule !== null;
  }

  // Legacy fallback removed - config-based rules are now required
  return false;
}

/**
 * Get or create user from database
 * @param {string} userIdentifier - User identifier (string)
 * @param {string} logPrefix - Log prefix for tracking (e.g., "[RECORDING_MODE]" or "[REPLAY_MODE]")
 * @returns {Object|null} User object { id, user_id } or null
 */
function getOrCreateUser(userIdentifier, logPrefix = "[SESSION_MANAGER]") {
  try {
    let user = userRepository.getUserByIdentifier(userIdentifier);

    if (user) {
      logger.debug(`${logPrefix} User found in database`, {
        userIdentifier,
        userId: user.id,
      });
      return user;
    }

    user = userRepository.createUser(userIdentifier);
    logger.debug(`${logPrefix} New user created`, {
      userIdentifier,
      userId: user.id,
    });
    return user;
  } catch (error) {
    logger.error(`${logPrefix} Failed to get or create user`, {
      userIdentifier,
      error: error.message,
    });
    return null;
  }
}

/**
 * Calculate SHA256 hash of a token
 * @param {string} token - Token to hash
 * @returns {string} SHA256 hash
 */
function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Extract user session cookie value from Set-Cookie headers using configurable rules
 * @param {Array|string} setCookieHeaders - Set-Cookie header(s)
 * @param {string} cookieName - Cookie name to extract (from config, defaults to checking config)
 * @returns {string|null} Cookie value or null
 */
function extractUserSessionFromSetCookie(setCookieHeaders, cookieName = null) {
  try {
    const cookies = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];

    // Get cookie name from config if not provided
    let targetCookieName = cookieName;
    if (!targetCookieName) {
      const sessionConfigManager = getSessionConfigManager();
      if (sessionConfigManager.hasConfig()) {
        const cookieRules = sessionConfigManager.getUpdateRulesByType("cookie");
        if (cookieRules.length > 0) {
          targetCookieName = cookieRules[0].key;
        }
      }
    }

    if (!targetCookieName) {
      logger.debug("extractUserSessionFromSetCookie: no cookie name configured");
      return null;
    }

    logger.debug("extractUserSessionFromSetCookie: processing headers", {
      headerCount: cookies.length,
      cookieName: targetCookieName,
      headers: cookies.slice(0, 3).map((c) => (c ? c.substring(0, 100) : null)),
    });

    const regex = new RegExp(`${targetCookieName}=([^;]+)`, "i");
    for (const cookie of cookies) {
      if (!cookie) continue;
      const match = cookie.match(regex);
      if (match && match[1]) {
        logger.debug("extractUserSessionFromSetCookie: cookie found", {
          cookieName: targetCookieName,
          value: match[1].substring(0, 20) + "...",
        });
        return match[1];
      }
    }
    logger.debug("extractUserSessionFromSetCookie: no matching cookie found in any header", {
      cookieName: targetCookieName,
    });
    return null;
  } catch (error) {
    logger.error("Failed to extract user session from Set-Cookie", {
      error: error.message,
    });
    return null;
  }
}

/**
 * Extract user session cookie value from request Cookie header using configurable rules
 * @param {string} cookieHeader - Cookie header value
 * @param {string} cookieName - Cookie name to extract (from config, defaults to checking config)
 * @returns {string|null} Cookie value or null
 */
function extractUserSessionFromCookie(cookieHeader, cookieName = null) {
  try {
    if (!cookieHeader) return null;

    // Get cookie name from config if not provided
    let targetCookieName = cookieName;
    if (!targetCookieName) {
      const sessionConfigManager = getSessionConfigManager();
      if (sessionConfigManager.hasConfig()) {
        const cookieRules = sessionConfigManager.getUpdateRulesByType("cookie");
        if (cookieRules.length > 0) {
          targetCookieName = cookieRules[0].key;
        }
      }
    }

    if (!targetCookieName) {
      return null;
    }

    const regex = new RegExp(`${targetCookieName}=([^;]+)`, "i");
    const match = cookieHeader.match(regex);
    return match ? match[1] : null;
  } catch (error) {
    logger.error("Failed to extract user session from Cookie", {
      error: error.message,
    });
    return null;
  }
}

/**
 * Extract Bearer token from Authorization header
 * @param {Object} headers - Request headers
 * @returns {string|null} Bearer token or null
 */
function extractBearerToken(headers) {
  try {
    const authHeader = headers["authorization"] || headers["Authorization"];
    if (!authHeader) return null;

    const bearerMatch = authHeader.match(/Bearer\s+(.+)/i);
    return bearerMatch ? bearerMatch[1] : null;
  } catch (error) {
    logger.error("Failed to extract Bearer token", {
      error: error.message,
    });
    return null;
  }
}

/**
 * Process session updates based on configurable rules
 * Extracts tokens from response and updates session accordingly
 * @param {Object} session - Session object (must have id property)
 * @param {Object} responseContext - Response context
 * @param {Object} requestContext - Request context
 * @param {string} logPrefix - Log prefix
 * @returns {Object} { cookieUpdates: number, authUpdates: number }
 */
function processSessionUpdates(session, responseContext, requestContext, logPrefix = "[SESSION_MANAGER]") {
  const result = { cookieUpdates: 0, authUpdates: 0 };

  try {
    const sessionConfigManager = getSessionConfigManager();

    // Session config is now required - no fallback to legacy behavior
    if (!sessionConfigManager.hasConfig()) {
      logger.warn(`${logPrefix} No session config found - session updates cannot be processed`, {
        sessionId: session.id,
      });
      return result;
    }

    const current = requestContext.getCurrent();
    const method = current.method || "GET";
    const endpoint = current.originalUrl || current.url || current.path || "";

    // Find matching update rules
    const matchingRules = sessionConfigManager.findMatchingUpdateRules(method, endpoint);

    if (matchingRules.length === 0) {
      logger.debug(`${logPrefix} No matching update rules for endpoint`, { method, endpoint });
      return result;
    }

    logger.info(`${logPrefix} Processing ${matchingRules.length} update rules`, {
      method,
      endpoint,
      sessionId: session.id,
    });

    for (const rule of matchingRules) {
      const extractedValue = sessionConfigManager.extractValueFromResponse(
        responseContext,
        current.headers,
        rule.source,
        rule.key,
        rule.pattern
      );

      if (!extractedValue) {
        logger.debug(`${logPrefix} No value extracted for update rule`, {
          source: rule.source,
          key: rule.key,
          type: rule.type,
        });
        continue;
      }

      logger.info(`${logPrefix} Extracted value for session update`, {
        type: rule.type,
        source: rule.source,
        key: rule.key,
        valuePrefix: extractedValue.substring(0, 20) + "...",
      });

      // Update session based on rule type
      if (rule.type === "cookie") {
        // Update u_session and us_hash
        const success = updateSessionUserSession(session.id, extractedValue, logPrefix);
        if (success) {
          result.cookieUpdates++;
        }
      } else if (rule.type === "auth") {
        // Update oauth_token and oauth_hash
        const success = updateSessionOAuthHash(session.id, extractedValue, logPrefix);
        if (success) {
          result.authUpdates++;
        }
      }
    }

    return result;
  } catch (error) {
    logger.error(`${logPrefix} Failed to process session updates`, {
      error: error.message,
      sessionId: session?.id,
    });
    return result;
  }
}

/**
 * Get user ID from session using configurable lookup methods
 * Uses session config to determine which cookies/tokens to look for
 * @param {Object} headers - Request headers
 * @param {string} logPrefix - Log prefix
 * @returns {number|null} User ID or null
 */
function getUserIdFromRequestWithConfig(headers, logPrefix = "[SESSION_MANAGER]") {
  // 1. Always try DPSESSION first (highest priority)
  let userId = getUserIdFromDPSession(headers, logPrefix);
  if (userId) {
    logger.debug(`${logPrefix} User ID found via DPSESSION`);
    return userId;
  }

  const sessionConfigManager = getSessionConfigManager();

  // 2. If session config exists, use configured cookie session names
  if (sessionConfigManager.hasConfig()) {
    const cookieRules = sessionConfigManager.getUpdateRulesByType("cookie");
    const cookieHeader = headers.cookie || headers.Cookie || "";

    for (const rule of cookieRules) {
      const cookieName = rule.key;
      // Extract cookie value using regex
      const regex = new RegExp(`${cookieName}=([^;]+)`, "i");
      const match = cookieHeader.match(regex);

      if (match && match[1]) {
        const tokenValue = match[1];
        const tokenHash = hashToken(tokenValue);
        const session = sessionRepository.getSessionBySessionHash(tokenHash);

        if (session) {
          logger.info(`${logPrefix} User ID found via cookie session (${cookieName})`, {
            userId: session.user_id,
            hashPrefix: tokenHash.substring(0, 12) + "...",
          });
          return session.user_id;
        }
      }
    }

    // 3. Try auth token lookup
    const bearerToken = extractBearerToken(headers);
    if (bearerToken) {
      const oauthHash = hashToken(bearerToken);
      const session = sessionRepository.getSessionByOAuthHash(oauthHash);

      if (session) {
        logger.info(`${logPrefix} User ID found via Bearer token (config-based)`, {
          userId: session.user_id,
        });
        return session.user_id;
      } else {
        logger.debug(`${logPrefix} Bearer token found but not matched in session repository`, {
          tokenPrefix: bearerToken.substring(0, 20) + "...",
          hashPrefix: oauthHash.substring(0, 12) + "...",
        });
      }
    } else {
      logger.debug(`${logPrefix} No Bearer token found in authorization header`);
    }
  } else {
    logger.debug(`${logPrefix} Session config not available, skipping config-based lookups`);
  }

  // 4. Fall back to legacy lookup (User Session, Bearer token)
  userId = getUserIdFromUserSession(headers, logPrefix);
  if (userId) {
    logger.debug(`${logPrefix} User ID found via User Session (legacy)`);
    return userId;
  }

  userId = getUserIdFromBearerToken(headers, logPrefix);
  if (userId) {
    logger.debug(`${logPrefix} User ID found via Bearer token (legacy)`);
    return userId;
  }

  logger.debug(`${logPrefix} No user ID found from any authentication method`, {
    hasCookie: !!headers.cookie,
    hasAuthorization: !!headers.authorization,
    cookieLength: headers.cookie ? headers.cookie.length : 0,
  });
  return null;
}

/**
 * Update session with user SESSION and hash
 * The hash is appended to the us_hash array (historical tracking)
 * The u_session field stores only the latest User SESSION value
 *
 * @param {number} sessionId - Session ID
 * @param {string} userSession - User SESSION value
 * @param {string} logPrefix - Log prefix
 * @returns {boolean} True if updated
 */
function updateSessionUserSession(sessionId, userSession, logPrefix = "[SESSION_MANAGER]") {
  try {
    const sessionHash = hashToken(userSession);
    const result = sessionRepository.updateUserSession(sessionId, userSession, sessionHash);
    if (result) {
      logger.info(`${logPrefix} User SESSION saved to session (hash appended to array)`, {
        sessionId,
        sessionHashPrefix: sessionHash.substring(0, 12) + "...",
      });
    }
    return result;
  } catch (error) {
    logger.error(`${logPrefix} Failed to update User SESSION`, {
      sessionId,
      error: error.message,
    });
    return false;
  }
}

/**
 * Update session with OAuth token and hash (from JWT token)
 * The hash is appended to the oauth_hash array (historical tracking)
 * The oauth_token field stores only the latest JWT token value
 *
 * @param {number} sessionId - Session ID
 * @param {string} jwtToken - JWT token
 * @param {string} logPrefix - Log prefix
 * @returns {boolean} True if updated
 */
function updateSessionOAuthHash(sessionId, jwtToken, logPrefix = "[SESSION_MANAGER]") {
  try {
    const oauthHash = hashToken(jwtToken);
    const result = sessionRepository.updateOAuthHash(sessionId, jwtToken, oauthHash);
    if (result) {
      logger.info(`${logPrefix} OAuth token and hash saved to session (hash appended to array)`, {
        sessionId,
        oauthHashPrefix: oauthHash.substring(0, 12) + "...",
        tokenPrefix: jwtToken.substring(0, 30) + "...",
      });
    }
    return result;
  } catch (error) {
    logger.error(`${logPrefix} Failed to update OAuth`, {
      sessionId,
      error: error.message,
    });
    return false;
  }
}

/**
 * Get user ID from User SESSION cookie in request
 * @param {Object} headers - Request headers
 * @param {string} logPrefix - Log prefix
 * @returns {number|null} User ID or null
 */
function getUserIdFromUserSession(headers, logPrefix = "[SESSION_MANAGER]") {
  try {
    const cookieHeader = headers.cookie || headers.Cookie || "";
    const userSession = extractUserSessionFromCookie(cookieHeader);

    if (!userSession) {
      logger.debug(`${logPrefix} User SESSION cookie not found in request`);
      return null;
    }

    const sessionHash = hashToken(userSession);
    const session = sessionRepository.getSessionBySessionHash(sessionHash);

    if (!session) {
      logger.debug(`${logPrefix} Session not found for User SESSION hash`);
      return null;
    }

    logger.info(`${logPrefix} User ID retrieved from User SESSION`, {
      userId: session.user_id,
      sessionHashPrefix: sessionHash.substring(0, 12) + "...",
    });

    return session.user_id;
  } catch (error) {
    logger.error(`${logPrefix} Failed to get user ID from User SESSION`, {
      error: error.message,
    });
    return null;
  }
}

/**
 * Get user ID from Bearer token in Authorization header
 * @param {Object} headers - Request headers
 * @param {string} logPrefix - Log prefix
 * @returns {number|null} User ID or null
 */
function getUserIdFromBearerToken(headers, logPrefix = "[SESSION_MANAGER]") {
  try {
    const bearerToken = extractBearerToken(headers);

    if (!bearerToken) {
      logger.debug(`${logPrefix} Bearer token not found in request`);
      return null;
    }

    logger.info(`${logPrefix} Attempting Bearer token lookup`, {
      tokenPrefix: bearerToken.substring(0, 30) + "...",
    });

    const oauthHash = hashToken(bearerToken);
    logger.info(`${logPrefix} Bearer token hash computed`, {
      hashPrefix: oauthHash.substring(0, 16) + "...",
    });

    const session = sessionRepository.getSessionByOAuthHash(oauthHash);

    if (!session) {
      logger.warn(`${logPrefix} Session not found for Bearer token hash`, {
        hashPrefix: oauthHash.substring(0, 16) + "...",
      });
      return null;
    }

    logger.info(`${logPrefix} User ID retrieved from Bearer token`, {
      userId: session.user_id,
      sessionId: session.id,
      oauthHashPrefix: oauthHash.substring(0, 12) + "...",
    });

    return session.user_id;
  } catch (error) {
    logger.error(`${logPrefix} Failed to get user ID from Bearer token`, {
      error: error.message,
    });
    return null;
  }
}

/**
 * Enhanced user ID lookup from request
 * Tries multiple methods in order:
 * 1. DPSESSION cookie (primary)
 * 2. User SESSION cookie (cross-domain tracking)
 * 3. Bearer token (Authorization header)
 *
 * @param {Object} headers - Request headers
 * @param {string} logPrefix - Log prefix
 * @returns {number|null} User ID or null
 */
function getUserIdFromRequest(headers, logPrefix = "[SESSION_MANAGER]") {
  // 1. Try DPSESSION cookie first
  let userId = getUserIdFromDPSession(headers, logPrefix);
  if (userId) {
    logger.debug(`${logPrefix} User ID found via DPSESSION`);
    return userId;
  }

  // 2. Try User SESSION cookie
  userId = getUserIdFromUserSession(headers, logPrefix);
  if (userId) {
    logger.debug(`${logPrefix} User ID found via User SESSION`);
    return userId;
  }

  // 3. Try Bearer token
  userId = getUserIdFromBearerToken(headers, logPrefix);
  if (userId) {
    logger.debug(`${logPrefix} User ID found via Bearer token`);
    return userId;
  }

  logger.debug(`${logPrefix} No user ID found from any authentication method`);
  return null;
}

/**
 * Get session from DPSESSION token
 * @param {string} sessionToken - DPSESSION value
 * @returns {Object|null} Session object or null
 */
function getSessionByDPSession(sessionToken) {
  try {
    return sessionRepository.getSessionByToken(sessionToken);
  } catch (error) {
    logger.error("Failed to get session by DPSESSION", {
      error: error.message,
    });
    return null;
  }
}

/**
 * Extract DPSESSION cookie value from request headers
 * @param {Object} headers - Request headers
 * @returns {string|null} DPSESSION value or null
 */
function extractDPSessionFromRequest(headers) {
  try {
    const cookieHeader = headers.cookie || headers.Cookie || "";
    const sessionTokenMatch = cookieHeader.match(/DPSESSION=([^;]+)/);
    return sessionTokenMatch ? sessionTokenMatch[1] : null;
  } catch (error) {
    logger.error("Failed to extract DPSESSION from request", {
      error: error.message,
    });
    return null;
  }
}

/**
 * Replace DPSESSION value in Set-Cookie headers with current request's DPSESSION
 * @param {Array|string} setCookieHeaders - Set-Cookie header(s)
 * @param {string} newDPSession - New DPSESSION value to use
 * @returns {Array|string} Modified Set-Cookie headers
 */
function replaceDPSessionInSetCookie(setCookieHeaders, newDPSession) {
  try {
    if (!setCookieHeaders || !newDPSession) return setCookieHeaders;

    const cookies = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
    const modified = cookies.map((cookie) => {
      if (!cookie) return cookie;
      // Replace DPSESSION value while keeping other cookie attributes
      return cookie.replace(/DPSESSION=[^;]+/, `DPSESSION=${newDPSession}`);
    });

    return Array.isArray(setCookieHeaders) ? modified : modified[0];
  } catch (error) {
    logger.error("Failed to replace DPSESSION in Set-Cookie", {
      error: error.message,
    });
    return setCookieHeaders;
  }
}

/**
 * Replace user session cookie value in Set-Cookie headers using configurable rules
 * Also updates the Sessions table with the new session mapping
 * @param {Array|string} setCookieHeaders - Set-Cookie header(s)
 * @param {string} newUserSession - New session value (will use DPSESSION value)
 * @param {number} sessionId - Session ID to update in database
 * @param {string} logPrefix - Log prefix
 * @returns {Array|string} Modified Set-Cookie headers
 */
function replaceUserSessionInSetCookie(setCookieHeaders, newUserSession, sessionId, logPrefix = "[SESSION_MANAGER]") {
  try {
    if (!setCookieHeaders || !newUserSession) return setCookieHeaders;

    // Get cookie names from config
    const sessionConfigManager = getSessionConfigManager();
    let cookieNames = [];

    if (sessionConfigManager.hasConfig()) {
      const cookieRules = sessionConfigManager.getUpdateRulesByType("cookie");
      cookieNames = cookieRules.map((rule) => rule.key);
    }

    if (cookieNames.length === 0) {
      logger.debug(`${logPrefix} No cookie session names configured, skipping replacement`);
      return setCookieHeaders;
    }

    const cookies = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
    let sessionReplaced = false;

    const modified = cookies.map((cookie) => {
      if (!cookie) return cookie;

      for (const cookieName of cookieNames) {
        const regex = new RegExp(`${cookieName}=`, "i");
        if (regex.test(cookie)) {
          sessionReplaced = true;
          // Replace cookie value while keeping other cookie attributes
          const replaceRegex = new RegExp(`${cookieName}=[^;]+`, "i");
          return cookie.replace(replaceRegex, `${cookieName}=${newUserSession}`);
        }
      }
      return cookie;
    });

    // Update Sessions table if session cookie was replaced
    if (sessionReplaced && sessionId) {
      updateSessionUserSession(sessionId, newUserSession, logPrefix);
      logger.info(`${logPrefix} User session cookie replaced and session updated`, {
        sessionId,
        newUserSessionPrefix: newUserSession.substring(0, 12) + "...",
      });
    }

    return Array.isArray(setCookieHeaders) ? modified : modified[0];
  } catch (error) {
    logger.error("Failed to replace user session in Set-Cookie", {
      error: error.message,
    });
    return setCookieHeaders;
  }
}

/**
 * Replace auth token value in response body based on update rule configuration
 * Extracts from response, optionally updates in place, and updates Sessions table
 * @param {Object} responseBody - Response body object
 * @param {string} newTokenValue - New token value to store
 * @param {Object} updateRule - Update rule with key and pattern (from session config)
 * @param {number} sessionId - Session ID to update in database
 * @param {string} logPrefix - Log prefix
 * @returns {Object} Modified response body
 */
function replaceAuthTokenInResponse(responseBody, newTokenValue, updateRule, sessionId, logPrefix = "[SESSION_MANAGER]") {
  try {
    if (!responseBody || typeof responseBody !== "object" || !newTokenValue || !updateRule) {
      return responseBody;
    }

    // Only process "auth" type rules
    if (updateRule.type !== "auth") {
      logger.debug(`${logPrefix} Rule type is not 'auth', skipping token replacement`, {
        ruleType: updateRule.type,
      });
      return responseBody;
    }

    // Only process body source
    if (updateRule.source !== "body") {
      logger.debug(`${logPrefix} Rule source is not 'body', skipping token replacement`, {
        ruleSource: updateRule.source,
      });
      return responseBody;
    }

    const sessionConfigManager = getSessionConfigManager();

    // Check if the token path exists
    const currentValue = sessionConfigManager._getNestedValue(responseBody, updateRule.key);
    if (!currentValue) {
      logger.debug(`${logPrefix} No token found at configured path`, {
        path: updateRule.key,
      });
      return responseBody;
    }

    // Deep clone and modify
    const modified = JSON.parse(JSON.stringify(responseBody));
    sessionConfigManager._setNestedValue(modified, updateRule.key, newTokenValue);

    // Update Sessions table with the new OAuth token
    if (sessionId) {
      updateSessionOAuthHash(sessionId, newTokenValue, logPrefix);
      logger.info(`${logPrefix} Auth token replaced and session updated`, {
        sessionId,
        rulePath: updateRule.key,
        newTokenPrefix: newTokenValue.substring(0, 12) + "...",
      });
    }

    return modified;
  } catch (error) {
    logger.error(`${logPrefix} Failed to replace auth token in response`, {
      error: error.message,
    });
    return responseBody;
  }
}

/**
 * Check if Set-Cookie headers contain DPSESSION
 * @param {Array|string} setCookieHeaders - Set-Cookie header(s)
 * @returns {boolean} True if DPSESSION exists
 */
function hasDPSessionInSetCookie(setCookieHeaders) {
  if (!setCookieHeaders) return false;
  const cookies = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
  return cookies.some((cookie) => cookie && cookie.includes("DPSESSION="));
}

/**
 * Check if Set-Cookie headers contain user session cookie using configurable rules
 * @param {Array|string} setCookieHeaders - Set-Cookie header(s)
 * @returns {boolean} True if configured user session cookie exists
 */
function hasUserSessionInSetCookie(setCookieHeaders) {
  if (!setCookieHeaders) return false;

  // Get cookie names from config
  const sessionConfigManager = getSessionConfigManager();
  let cookieNames = [];

  if (sessionConfigManager.hasConfig()) {
    const cookieRules = sessionConfigManager.getUpdateRulesByType("cookie");
    cookieNames = cookieRules.map((rule) => rule.key);
  }

  if (cookieNames.length === 0) {
    return false;
  }

  const cookies = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];

  return cookies.some((cookie) => {
    if (!cookie) return false;
    return cookieNames.some((name) => {
      const regex = new RegExp(`${name}=`, "i");
      return regex.test(cookie);
    });
  });
}

/**
 * Generate a new auth token with fake claims for REPLAY mode
 * Used to replace the auth token in config-matching auth update rule responses
 * @param {number} sessionId - Session ID for reference
 * @param {number} userId - User ID
 * @param {string} logPrefix - Log prefix
 * @returns {string} Generated auth token
 */
function generateFakeAuthToken(sessionId, userId, logPrefix = "[SESSION_MANAGER]") {
  try {
    // Get session expiry from config if available
    const sessionConfigManager = getSessionConfigManager();
    const sessionSettings = sessionConfigManager.getSessionSettings();
    const expirySeconds = sessionSettings.expiry || 3600; // Default 1 hour

    const now = Math.floor(Date.now() / 1000);
    const expiryTime = now + expirySeconds;

    const payload = {
      sub: `user-${userId}`,
      sessionId: sessionId,
      iat: now,
      exp: expiryTime,
      iss: "dproxy-replay-mode",
      aud: "dproxy",
      // Fake claims that mimic real JWT structure
      provider_type: "replay",
      env: "dproxy",
    };

    const token = jwt.sign(payload, JWT_SECRET, { algorithm: "HS256" });

    logger.info(`${logPrefix} Generated fake JWT token`, {
      sessionId,
      userId,
      expirySeconds,
      expiryTime: new Date(expiryTime * 1000).toISOString(),
      tokenPrefix: token.substring(0, 30) + "...",
    });

    return token;
  } catch (error) {
    logger.error(`${logPrefix} Failed to generate fake auth token`, {
      error: error.message,
      sessionId,
      userId,
    });
    // Return a fallback token if generation fails
    return `dproxy-fake-auth-${Date.now()}`;
  }
}

/**
 * Add DPSESSION cookie for cross-domain request response
 * For requests that don't have DPSESSION cookie but have User Session or Bearer token,
 * this function adds DPSESSION cookie to the response so future requests will include it.
 *
 * @param {Object} responseContext - Response context object with getHeader/setHeader methods
 * @param {Object} headers - Request headers
 * @param {string} host - Request host URL with protocol (e.g., "https://api.example.com")
 * @param {number} userId - User ID from session lookup
 * @param {string} logPrefix - Log prefix for tracking
 * @returns {Object} { success: boolean, sessionToken: string|null, sessionId: number|null }
 */
function addCrossDomainDPSessionCookie(responseContext, headers, host, userId, logPrefix = "[SESSION_MANAGER]") {
  try {
    // Check if request already has DPSESSION cookie
    const cookieHeader = headers.cookie || headers.Cookie || "";
    const hasDPSession = cookieHeader.includes("DPSESSION=");
    if (hasDPSession) {
      logger.debug(`${logPrefix} Request already has DPSESSION, skipping cross-domain cookie addition`);
      return { success: false, sessionToken: null, sessionId: null };
    }

    // Check if response already has DPSESSION cookie to avoid duplicates
    const existingCookies = responseContext.getHeader("set-cookie") || [];
    const cookieArray = Array.isArray(existingCookies) ? existingCookies : existingCookies ? [existingCookies] : [];
    const hasResponseDPSession = cookieArray.some((cookie) => cookie && cookie.includes("DPSESSION="));

    if (hasResponseDPSession) {
      logger.debug(`${logPrefix} Response already has DPSESSION, skipping cross-domain cookie addition`);
      return { success: false, sessionToken: null, sessionId: null };
    }

    if (!host || !userId) {
      logger.debug(`${logPrefix} Missing host or userId for cross-domain cookie addition`, { host, userId });
      return { success: false, sessionToken: null, sessionId: null };
    }

    // Extract domain from host
    let domain;
    try {
      const hostUrl = new URL(host);
      domain = hostUrl.hostname;
    } catch (urlError) {
      // If host is already just a hostname
      domain = host
        .replace(/^https?:\/\//, "")
        .split("/")[0]
        .split(":")[0];
    }

    // Get session by user_id to retrieve DPSESSION token
    const userSessions = sessionRepository.getSessionsByUserId(userId);

    if (!userSessions || userSessions.length === 0) {
      logger.warn(`${logPrefix} No sessions found for user`, { userId });
      return { success: false, sessionToken: null, sessionId: null };
    }

    // Use the most recent active session
    const activeSession = userSessions.find((s) => new Date(s.expires_at) > new Date()) || userSessions[0];
    const dpSessionToken = activeSession.p_session;
    const sessionId = activeSession.id;

    // Determine if HTTPS from the host URL
    const isHttps = host.startsWith("https://") || host.startsWith("https:");
    const dpCookieValue = `DPSESSION=${dpSessionToken}; Domain=${domain}; Path=/; ${isHttps ? "Secure; " : ""}HttpOnly; SameSite=None`;

    cookieArray.push(dpCookieValue);
    responseContext.setHeader("Set-Cookie", cookieArray);

    logger.info(`${logPrefix} Added DPSESSION cookie for cross-domain request`, {
      domain,
      userId,
      sessionId,
      sessionToken: dpSessionToken.substring(0, 8) + "...",
    });

    return { success: true, sessionToken: dpSessionToken, sessionId };
  } catch (error) {
    logger.error(`${logPrefix} Failed to add cross-domain DPSESSION cookie`, {
      error: error.message,
      host,
      userId,
    });
    return { success: false, sessionToken: null, sessionId: null };
  }
}

/**
 * Get session info from request using multiple auth methods
 * Returns both userId and sessionId/sessionToken for cross-domain handling
 *
 * @param {Object} headers - Request headers
 * @param {string} logPrefix - Log prefix
 * @returns {Object} { userId: number|null, sessionId: number|null, sessionToken: string|null, authMethod: string|null }
 */
function getSessionInfoFromRequest(headers, logPrefix = "[SESSION_MANAGER]") {
  // 1. Try DPSESSION cookie first
  const dpSession = extractDPSessionFromRequest(headers);
  if (dpSession) {
    const session = getSessionByDPSession(dpSession);
    if (session) {
      logger.debug(`${logPrefix} Session info found via DPSESSION`);
      return {
        userId: session.user_id,
        sessionId: session.id,
        sessionToken: dpSession,
        authMethod: "DPSESSION",
      };
    }
  }

  // 2. Try configured user session cookies
  const cookieHeader = headers.cookie || headers.Cookie || "";
  const sessionConfigManager = getSessionConfigManager();

  if (sessionConfigManager.hasConfig()) {
    const cookieRules = sessionConfigManager.getUpdateRulesByType("cookie");

    for (const rule of cookieRules) {
      const regex = new RegExp(`${rule.key}=([^;]+)`, "i");
      const match = cookieHeader.match(regex);

      if (match && match[1]) {
        const sessionValue = match[1];
        const sessionHash = hashToken(sessionValue);
        const session = sessionRepository.getSessionBySessionHash(sessionHash);

        if (session) {
          logger.debug(`${logPrefix} Session info found via configured cookie (${rule.key})`);
          return {
            userId: session.user_id,
            sessionId: session.id,
            sessionToken: session.p_session,
            authMethod: rule.key,
          };
        }
      }
    }
  }

  // 3. Try Bearer token
  const bearerToken = extractBearerToken(headers);
  if (bearerToken) {
    // Get session details from Bearer token lookup using hash
    const oauthHash = hashToken(bearerToken);
    const session = sessionRepository.getSessionByOAuthHash(oauthHash);
    if (session) {
      logger.debug(`${logPrefix} Session info found via Bearer token`);
      return {
        userId: session.user_id,
        sessionId: session.id,
        sessionToken: session.p_session,
        authMethod: "Bearer",
      };
    }
  }

  logger.debug(`${logPrefix} No session info found from any authentication method`);
  return { userId: null, sessionId: null, sessionToken: null, authMethod: null };
}

module.exports = {
  createSessionAndCookie,
  getUserIdFromDPSession,
  getOrCreateUser,
  hashToken,
  extractUserSessionFromSetCookie,
  extractUserSessionFromCookie,
  extractBearerToken,
  updateSessionUserSession,
  updateSessionOAuthHash,
  getUserIdFromUserSession,
  getUserIdFromBearerToken,
  getUserIdFromRequest,
  getSessionByDPSession,
  extractDPSessionFromRequest,
  replaceDPSessionInSetCookie,
  replaceUserSessionInSetCookie,
  replaceAuthTokenInResponse,
  hasDPSessionInSetCookie,
  hasUserSessionInSetCookie,
  generateFakeAuthToken,
  addCrossDomainDPSessionCookie,
  getSessionInfoFromRequest,
  checkSessionCreationTrigger,
  extractUserIdFromRequest,
  shouldCreateSession,
  processSessionUpdates,
  getUserIdFromRequestWithConfig,
};
