/**
 * Cookie Session Manager
 *
 * Manages DPSESSION cookie for user/session identification in replay mode.
 * One device = one session = identified by DPSESSION cookie.
 */

const sessionRepository = require("../database/repositories/session_repository");
const sessionManager = require("./session_manager");
const logger = require("../utils/logger");
const config = require("../config");
const { getMonitoredDomains, createMonitoredDomainCookies } = require("../utils/cookieDomainHelper");

/**
 * Get session from DPSESSION cookie
 * @param {Object} req - Express request object
 * @returns {Object|null} Session object or null if not found/expired
 */
function getSessionFromCookie(req) {
  const cookies = parseCookies(req);
  const sessionToken = cookies.DPSESSION;

  logger.info("[COOKIE_SESSION] Cookie parsing result", {
    cookieHeader: req.headers.cookie ? req.headers.cookie.substring(0, 50) + "..." : "none",
    sessionToken: sessionToken ? sessionToken.substring(0, 30) + "..." : "none",
  });

  if (!sessionToken) {
    logger.info("[COOKIE_SESSION] No DPSESSION cookie found");
    return null;
  }

  try {
    logger.info("[COOKIE_SESSION] Attempting to retrieve session by token", {
      tokenPrefix: sessionToken.substring(0, 20),
    });

    const session = sessionRepository.getSessionByToken(sessionToken);

    logger.info("[COOKIE_SESSION] Session lookup completed", {
      sessionFound: !!session,
      sessionId: session ? session.id : null,
      userId: session ? session.user_id : null,
    });

    if (!session) {
      return null;
    }

    // Check if session is expired
    if (new Date(session.expires_at) < new Date()) {
      logger.debug("Session expired", { sessionId: session.id, expiresAt: session.expires_at });
      return null;
    }

    return session;
  } catch (err) {
    logger.error("Error retrieving session from cookie", { error: err.message });
    return null;
  }
}

/**
 * Create new session and set DPSESSION cookie
 * @param {number} userId - User ID
 * @param {Object} mobileHeaders - Mobile device headers
 * @param {string} deviceId - Device identifier
 * @returns {Promise<Object>} { session, cookieHeaders }
 */
async function createSessionAndCookie(userId, mobileHeaders, deviceId) {
  try {
    const session = await sessionManager.generateSession(userId, mobileHeaders, deviceId);

    // Create cookie headers for all monitored domains
    const cookieHeaders = createMonitoredDomainCookies(session.sessionToken);
    const domains = getMonitoredDomains();

    logger.info("[SESSION_MANAGER] Created DPSESSION cookies for multiple domains", {
      userId,
      sessionId: session.id,
      deviceId,
      sessionToken: session.sessionToken.substring(0, 12) + "...",
      domains,
      cookieCount: cookieHeaders.length,
    });

    return {
      session,
      cookieHeaders, // Array of cookie strings
      cookieHeader: cookieHeaders[0], // For backward compatibility, return first cookie
    };
  } catch (err) {
    logger.error("Error creating session and cookie", { error: err.message });
    throw err;
  }
}

/**
 * Parse cookies from request
 * @param {Object} req - Express request object
 * @returns {Object} Parsed cookies { name: value }
 */
function parseCookies(req) {
  const cookies = {};
  const cookieHeader = req.headers.cookie || "";

  cookieHeader.split(";").forEach((cookie) => {
    const [name, value] = cookie.trim().split("=");
    if (name && value) {
      cookies[name] = decodeURIComponent(value);
    }
  });

  return cookies;
}

/**
 * Update session last activity
 * @param {number} sessionId - Session ID
 */
function updateSessionActivity(sessionId) {
  try {
    sessionRepository.updateSessionActivity(sessionId);
  } catch (err) {
    logger.error("Error updating session activity", { error: err.message });
  }
}

module.exports = {
  getSessionFromCookie,
  createSessionAndCookie,
  parseCookies,
  updateSessionActivity,
};
