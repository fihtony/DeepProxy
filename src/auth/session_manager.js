/**
 * Session Manager
 *
 * Manages user sessions and session tokens.
 * DPSESSION cookie = simple random UUID for session identification.
 * No encryption needed - DPSESSION is just a session ID, not sensitive data.
 */

const crypto = require("crypto");
const config = require("../config");
const logger = require("../utils/logger");
const sessionRepository = require("../database/repositories/session_repository");
const userRepository = require("../database/repositories/user_repository");
const { getLocalISOString } = require("../utils/datetimeUtils");

/**
 * Generate a new session for a user
 * @param {number} userId - User ID
 * @param {Object} mobileHeaders - Mobile app headers
 * @param {string} deviceId - Device identifier
 * @returns {Promise<Object>} Created session with session token
 */
async function generateSession(userId, mobileHeaders, deviceId) {
  try {
    // Generate session token (random UUID for DPSESSION cookie)
    const sessionToken = generateSessionToken();

    // Calculate expiry time
    const expiresAt = new Date();
    expiresAt.setSeconds(expiresAt.getSeconds() + config.security.sessionExpirySeconds);

    // Create session in database
    // Note: mobileHeaders from extractMobileHeaders has format:
    // { mobilePlatform, mobileVersion, mobileEnvironment, acceptLanguage }
    // But createSession expects format:
    // { platform, version, environment }
    const headersForDb = {
      platform: mobileHeaders.mobilePlatform,
      version: mobileHeaders.mobileVersion,
      environment: mobileHeaders.mobileEnvironment,
    };

    const session = await sessionRepository.createSession(userId, sessionToken, deviceId, headersForDb, getLocalISOString(expiresAt));

    logger.info("Session generated", {
      userId,
      sessionId: session.id,
      deviceId,
      platform: mobileHeaders.platform,
    });

    return {
      ...session,
      sessionToken,
    };
  } catch (error) {
    logger.error("Failed to generate session", {
      userId,
      error: error.message,
    });
    throw error;
  }
}

/**
 * Get session by token
 * @param {string} sessionToken - Session token
 * @returns {Promise<Object|null>} Session or null
 */
async function getSessionByToken(sessionToken) {
  try {
    const session = await sessionRepository.getSessionByToken(sessionToken);

    if (!session) {
      return null;
    }

    // Check if session is expired
    if (new Date(session.expires_at) < new Date()) {
      logger.debug("Session expired", { sessionId: session.id });
      return null;
    }

    return session;
  } catch (error) {
    logger.error("Failed to get session by token", {
      error: error.message,
    });
    return null;
  }
}

/**
 * Get user from session cookie in request
 * @param {Object} req - Express request object
 * @returns {Promise<Object|null>} User with session info or null
 */
async function getUserFromSession(req) {
  try {
    // Extract session token from cookie
    const sessionToken = extractSessionToken(req);

    if (!sessionToken) {
      logger.debug("No session token found in request");
      return null;
    }

    // Get session
    const session = await getSessionByToken(sessionToken);

    if (!session) {
      logger.debug("Session not found or expired");
      return null;
    }

    // Update session activity
    await updateSessionActivity(session.id);

    // Get user
    const user = await userRepository.findById(session.user_id);

    if (!user) {
      logger.warn("User not found for session", { sessionId: session.id });
      return null;
    }

    return {
      ...user,
      sessionId: session.id,
      sessionToken: session.session_token,
    };
  } catch (error) {
    logger.error("Failed to get user from session", {
      error: error.message,
    });
    return null;
  }
}

/**
 * Validate session token
 * @param {string} sessionToken - Session token to validate
 * @returns {Promise<boolean>} True if valid
 */
async function validateSession(sessionToken) {
  try {
    const session = await getSessionByToken(sessionToken);
    return session !== null;
  } catch (error) {
    logger.error("Failed to validate session", {
      error: error.message,
    });
    return false;
  }
}

/**
 * Update session activity timestamp
 * @param {number} sessionId - Session ID
 * @returns {Promise<void>}
 */
async function updateSessionActivity(sessionId) {
  try {
    await sessionRepository.updateSessionActivity(sessionId);
  } catch (error) {
    logger.warn("Failed to update session activity", {
      sessionId,
      error: error.message,
    });
  }
}

/**
 * Extract session token from request cookies or headers
 * @param {Object} req - Express request object
 * @returns {string|null} Session token or null
 */
function extractSessionToken(req) {
  // Try to extract from Cookie header
  const cookieHeader = req.headers.cookie;

  if (cookieHeader) {
    const cookies = parseCookies(cookieHeader);
    const sessionToken = cookies[config.security.sessionCookieName];

    if (sessionToken) {
      return sessionToken;
    }
  }

  // Try to extract from Authorization header (for testing)
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.substring(7);
  }

  return null;
}

/**
 * Parse cookie header string
 * @param {string} cookieHeader - Cookie header value
 * @returns {Object} Parsed cookies
 */
function parseCookies(cookieHeader) {
  const cookies = {};

  cookieHeader.split(";").forEach((cookie) => {
    const parts = cookie.split("=");
    const key = parts[0].trim();
    const value = parts.slice(1).join("=").trim();
    cookies[key] = value;
  });

  return cookies;
}

/**
 * Generate random session token (plain random UUID)
 * DPSESSION is just a session identifier, no encryption needed
 * @returns {string} Session token
 */
function generateSessionToken() {
  return crypto.randomUUID();
}

module.exports = {
  generateSession,
  getSessionByToken,
  getUserFromSession,
  validateSession,
  updateSessionActivity,
};
