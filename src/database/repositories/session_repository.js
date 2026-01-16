/**
 * Session Repository
 *
 * Handles all session-related database operations including session creation,
 * retrieval, updates, and cleanup of expired sessions.
 *
 * Security: Session tokens are stored as plain text (just random UUIDs for identification).
 *
 * @module repositories/session_repository
 */

const dbConnection = require("../connection");
const logger = require("../../utils/logger");
const { getLocalISOString } = require("../../utils/datetimeUtils");

/**
 * Create a new session
 *
 * @param {number} userId - User ID
 * @param {string} sessionToken - DPSESSION cookie value (plain random UUID)
 * @param {string} deviceId - Device identifier
 * @param {Object} requestHeaders - app request headers
 * @param {string} requestHeaders.platform - android, ios, etc
 * @param {string} requestHeaders.version - App version (e.g., 6.9.0)
 * @param {string} requestHeaders.environment - sit/stage/dev/prod
 * @param {Date|string} expiresAt - Session expiration timestamp
 * @returns {Object} Created session object
 * @throws {Error} If creation fails
 */
function createSession(userId, sessionToken, deviceId = null, requestHeaders = {}, expiresAt = null) {
  try {
    const db = dbConnection.getDatabase();

    // Default expiration: 24 hours from now, in ISO 8601 format with timezone
    const now = getLocalISOString();
    const expirationDate = expiresAt || getLocalISOString(new Date(Date.now() + 24 * 60 * 60 * 1000));

    const stmt = db.prepare(`
      INSERT INTO sessions (
        user_id,
        p_session,
        device_id,
        app_platform,
        app_version,
        app_environment,
        app_language,
        expires_at,
        created_at,
        last_activity_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      userId,
      sessionToken,
      deviceId,
      requestHeaders.platform || null,
      requestHeaders.version || null,
      requestHeaders.environment || null,
      requestHeaders.language || null,
      expirationDate,
      now,
      now
    );

    logger.info(`Session created for user id ${userId} (Session ID: ${result.lastInsertRowid})`);

    return getSessionById(result.lastInsertRowid);
  } catch (error) {
    logger.error("Failed to create session:", error);
    throw new Error(`Failed to create session: ${error.message}`);
  }
}

/**
 * Get session by ID (internal helper)
 *
 * @param {number} sessionId - Session ID
 * @returns {Object|null} Session object
 */
function getSessionById(sessionId) {
  try {
    const db = dbConnection.getDatabase();

    const stmt = db.prepare(`
      SELECT 
        id,
        user_id,
        p_session,
        device_id,
        app_platform,
        app_version,
        app_environment,
        app_language,
        expires_at,
        created_at,
        last_activity_at
      FROM sessions
      WHERE id = ?
    `);

    const session = stmt.get(sessionId);

    if (!session) {
      return null;
    }

    return session;
  } catch (error) {
    logger.error(`Failed to get session by ID ${sessionId}:`, error);
    throw new Error(`Failed to get session: ${error.message}`);
  }
}

/**
 * Get session by session token
 *
 * @param {string} sessionToken - Session token to search for
 * @returns {Object|null} Session object, or null if not found/expired
 */
function getSessionByToken(sessionToken) {
  try {
    const db = dbConnection.getDatabase();

    // Direct SQL query - session tokens are plain UUIDs, no encryption
    const stmt = db.prepare(`
      SELECT 
        id,
        user_id,
        p_session,
        device_id,
        app_platform,
        app_version,
        app_environment,
        app_language,
        expires_at,
        created_at,
        last_activity_at
      FROM sessions
      WHERE p_session = ? AND expires_at > CURRENT_TIMESTAMP
      LIMIT 1
    `);

    const session = stmt.get(sessionToken);
    return session || null;
  } catch (error) {
    logger.error("Failed to get session by token:", error);
    throw new Error(`Failed to get session: ${error.message}`);
  }
}

/**
 * Get all sessions for a user
 *
 * @param {number} userId - User ID
 * @param {boolean} [activeOnly=false] - Return only non-expired sessions
 * @returns {Array} Array of session objects
 */
function getSessionsByUserId(userId, activeOnly = false) {
  try {
    const db = dbConnection.getDatabase();

    let whereClause = "WHERE user_id = ?";
    if (activeOnly) {
      whereClause += " AND expires_at > CURRENT_TIMESTAMP";
    }

    const stmt = db.prepare(`
      SELECT 
        id,
        user_id,
        p_session,
        device_id,
        app_platform,
        app_version,
        app_environment,
        app_language,
        expires_at,
        created_at,
        last_activity_at
      FROM sessions
      ${whereClause}
      ORDER BY last_activity_at DESC
    `);

    const sessions = stmt.all(userId);
    return sessions;
  } catch (error) {
    logger.error(`Failed to get sessions for user ${userId}:`, error);
    throw new Error(`Failed to get sessions: ${error.message}`);
  }
}

/**
 * Update session last activity timestamp
 *
 * @param {number} sessionId - Session ID
 * @returns {boolean} True if updated successfully
 */
function updateSessionActivity(sessionId) {
  try {
    const db = dbConnection.getDatabase();
    const now = getLocalISOString();

    const stmt = db.prepare(`
      UPDATE sessions
      SET last_activity_at = ?
      WHERE id = ?
    `);

    const result = stmt.run(now, sessionId);

    if (result.changes === 0) {
      logger.warn(`Session ${sessionId} not found for activity update`);
      return false;
    }

    return true;
  } catch (error) {
    logger.error(`Failed to update session activity ${sessionId}:`, error);
    throw new Error(`Failed to update session activity: ${error.message}`);
  }
}

/**
 * Expire a session (set expiration to now)
 *
 * @param {number} sessionId - Session ID to expire
 * @returns {boolean} True if expired successfully
 */
function expireSession(sessionId) {
  try {
    const db = dbConnection.getDatabase();
    const now = getLocalISOString();

    const stmt = db.prepare(`
      UPDATE sessions
      SET expires_at = ?
      WHERE id = ?
    `);

    const result = stmt.run(now, sessionId);

    if (result.changes === 0) {
      logger.warn(`Session ${sessionId} not found for expiration`);
      return false;
    }

    logger.info(`Session ${sessionId} expired`);
    return true;
  } catch (error) {
    logger.error(`Failed to expire session ${sessionId}:`, error);
    throw new Error(`Failed to expire session: ${error.message}`);
  }
}

/**
 * Expire all sessions for a user
 *
 * @param {number} userId - User ID
 * @returns {number} Number of sessions expired
 */
function expireUserSessions(userId) {
  try {
    const db = dbConnection.getDatabase();
    const now = getLocalISOString();

    const stmt = db.prepare(`
      UPDATE sessions
      SET expires_at = ?
      WHERE user_id = ? AND expires_at > ?
    `);

    const result = stmt.run(now, userId, now);

    logger.info(`Expired ${result.changes} sessions for user ${userId}`);
    return result.changes;
  } catch (error) {
    logger.error(`Failed to expire sessions for user ${userId}:`, error);
    throw new Error(`Failed to expire user sessions: ${error.message}`);
  }
}

/**
 * Clean up expired sessions (delete old records)
 * Should be run periodically (e.g., daily cron job)
 *
 * @param {number} [daysOld=7] - Delete sessions expired more than N days ago
 * @returns {number} Number of sessions deleted
 */
function cleanupExpiredSessions(daysOld = 7) {
  try {
    const db = dbConnection.getDatabase();

    const stmt = db.prepare(`
      DELETE FROM sessions
      WHERE expires_at < datetime('now', '-' || ? || ' days')
    `);

    const result = stmt.run(daysOld);

    logger.info(`Cleaned up ${result.changes} expired sessions older than ${daysOld} days`);
    return result.changes;
  } catch (error) {
    logger.error("Failed to cleanup expired sessions:", error);
    throw new Error(`Failed to cleanup sessions: ${error.message}`);
  }
}

/**
 * Delete a session
 *
 * @param {number} sessionId - Session ID to delete
 * @returns {boolean} True if deleted
 */
function deleteSession(sessionId) {
  try {
    const db = dbConnection.getDatabase();

    const stmt = db.prepare("DELETE FROM sessions WHERE id = ?");
    const result = stmt.run(sessionId);

    if (result.changes === 0) {
      throw new Error(`Session ${sessionId} not found`);
    }

    logger.info(`Session ${sessionId} deleted`);
    return true;
  } catch (error) {
    logger.error(`Failed to delete session ${sessionId}:`, error);
    throw new Error(`Failed to delete session: ${error.message}`);
  }
}

/**
 * Get session count by user
 *
 * @param {number} userId - User ID
 * @param {boolean} [activeOnly=false] - Count only active sessions
 * @returns {number} Session count
 */
function getSessionCount(userId, activeOnly = false) {
  try {
    const db = dbConnection.getDatabase();

    let whereClause = "WHERE user_id = ?";
    if (activeOnly) {
      whereClause += " AND expires_at > CURRENT_TIMESTAMP";
    }

    const stmt = db.prepare(`SELECT COUNT(*) as count FROM sessions ${whereClause}`);
    const { count } = stmt.get(userId);

    return count;
  } catch (error) {
    logger.error(`Failed to get session count for user ${userId}:`, error);
    throw new Error(`Failed to get session count: ${error.message}`);
  }
}

/**
 * Update session with user session and append its hash to us_hash array
 * - u_session field stores only the latest user session value
 * - us_hash field is a JSON array that accumulates all historical hashes
 *
 * @param {number} sessionId - Session ID
 * @param {string} userSession - user session cookie value
 * @param {string} sessionHash - SHA256 hash of user session
 * @returns {boolean} True if updated successfully
 */
function updateUserSession(sessionId, userSession, sessionHash) {
  try {
    const db = dbConnection.getDatabase();
    const now = getLocalISOString();

    // First get the existing us_hash array
    const getStmt = db.prepare(`SELECT us_hash FROM sessions WHERE id = ?`);
    const existing = getStmt.get(sessionId);

    if (!existing) {
      logger.warn(`Session ${sessionId} not found for SM session update`);
      return false;
    }

    // Parse existing array or create new one
    let hashArray = [];
    if (existing.us_hash) {
      try {
        hashArray = JSON.parse(existing.us_hash);
        if (!Array.isArray(hashArray)) {
          // Handle legacy single value - convert to array
          hashArray = [existing.us_hash];
        }
      } catch (parseError) {
        // Legacy format: single hash string, convert to array
        hashArray = [existing.us_hash];
      }
    }

    // Append new hash if not already present
    if (!hashArray.includes(sessionHash)) {
      hashArray.push(sessionHash);
    }

    const stmt = db.prepare(`
      UPDATE sessions
      SET u_session = ?, us_hash = ?, last_activity_at = ?
      WHERE id = ?
    `);

    const result = stmt.run(userSession, JSON.stringify(hashArray), now, sessionId);

    if (result.changes === 0) {
      logger.warn(`Session ${sessionId} not found for SM session update`);
      return false;
    }

    logger.info(`SM session updated for session ${sessionId}`, {
      sessionHashPrefix: sessionHash ? sessionHash.substring(0, 12) + "..." : null,
      totalHashes: hashArray.length,
    });
    return true;
  } catch (error) {
    logger.error(`Failed to update SM session for ${sessionId}:`, error);
    throw new Error(`Failed to update SM session: ${error.message}`);
  }
}

/**
 * Update session with OAuth token and append hash to oauth_hash array
 * - oauth_token field stores only the latest JWT token value
 * - oauth_hash field is a JSON array that accumulates all historical hashes
 *
 * @param {number} sessionId - Session ID
 * @param {string} oauthToken - JWT token value
 * @param {string} oauthHash - SHA256 hash of JWT token
 * @returns {boolean} True if updated successfully
 */
function updateOAuthHash(sessionId, oauthToken, oauthHash) {
  try {
    const db = dbConnection.getDatabase();
    const now = getLocalISOString();

    // First get the existing oauth_hash array
    const getStmt = db.prepare(`SELECT oauth_hash FROM sessions WHERE id = ?`);
    const existing = getStmt.get(sessionId);

    if (!existing) {
      logger.warn(`Session ${sessionId} not found for OAuth update`);
      return false;
    }

    // Parse existing array or create new one
    let hashArray = [];
    if (existing.oauth_hash) {
      try {
        hashArray = JSON.parse(existing.oauth_hash);
        if (!Array.isArray(hashArray)) {
          // Handle legacy single value - convert to array
          hashArray = [existing.oauth_hash];
        }
      } catch (parseError) {
        // Legacy format: single hash string, convert to array
        hashArray = [existing.oauth_hash];
      }
    }

    // Append new hash if not already present
    if (!hashArray.includes(oauthHash)) {
      hashArray.push(oauthHash);
    }

    const stmt = db.prepare(`
      UPDATE sessions
      SET oauth_token = ?, oauth_hash = ?, last_activity_at = ?
      WHERE id = ?
    `);

    const result = stmt.run(oauthToken, JSON.stringify(hashArray), now, sessionId);

    if (result.changes === 0) {
      logger.warn(`Session ${sessionId} not found for OAuth update`);
      return false;
    }

    logger.info(`OAuth token and hash updated for session ${sessionId}`, {
      oauthHashPrefix: oauthHash ? oauthHash.substring(0, 12) + "..." : null,
      totalHashes: hashArray.length,
    });
    return true;
  } catch (error) {
    logger.error(`Failed to update OAuth for ${sessionId}:`, error);
    throw new Error(`Failed to update OAuth: ${error.message}`);
  }
}

/**
 * Get session by user session hash
 * Searches within the us_hash JSON array for matching hash
 *
 * @param {string} sessionHash - SHA256 hash of user session
 * @returns {Object|null} Session object, or null if not found/expired
 */
function getSessionBySessionHash(sessionHash) {
  try {
    const db = dbConnection.getDatabase();

    // Get all non-expired sessions that have us_hash set
    const stmt = db.prepare(`
      SELECT 
        id,
        user_id,
        p_session,
        u_session,
        us_hash,
        oauth_hash,
        device_id,
        app_platform,
        app_version,
        app_environment,
        app_language,
        expires_at,
        created_at,
        last_activity_at
      FROM sessions
      WHERE us_hash IS NOT NULL AND expires_at > CURRENT_TIMESTAMP
      ORDER BY last_activity_at DESC
    `);

    const sessions = stmt.all();

    // Search for the hash in each session's us_hash array
    for (const session of sessions) {
      if (session.us_hash) {
        try {
          const hashArray = JSON.parse(session.us_hash);
          if (Array.isArray(hashArray) && hashArray.includes(sessionHash)) {
            return session;
          }
          // Legacy support: if it's a string that matches directly
          if (typeof hashArray === "string" && hashArray === sessionHash) {
            return session;
          }
        } catch (parseError) {
          // Legacy format: single hash string
          if (session.us_hash === sessionHash) {
            return session;
          }
        }
      }
    }

    return null;
  } catch (error) {
    logger.error("Failed to get session by session hash:", error);
    throw new Error(`Failed to get session: ${error.message}`);
  }
}

/**
 * Get session by OAuth token hash
 * Searches within the oauth_hash JSON array for matching hash
 *
 * @param {string} oauthHash - SHA256 hash of JWT token
 * @returns {Object|null} Session object, or null if not found/expired
 */
function getSessionByOAuthHash(oauthHash) {
  try {
    const db = dbConnection.getDatabase();

    // Get all non-expired sessions that have oauth_hash set
    const stmt = db.prepare(`
      SELECT 
        id,
        user_id,
        p_session,
        u_session,
        us_hash,
        oauth_hash,
        device_id,
        app_platform,
        app_version,
        app_environment,
        app_language,
        expires_at,
        created_at,
        last_activity_at
      FROM sessions
      WHERE oauth_hash IS NOT NULL AND expires_at > CURRENT_TIMESTAMP
      ORDER BY last_activity_at DESC
    `);

    const sessions = stmt.all();

    // Search for the hash in each session's oauth_hash array
    for (const session of sessions) {
      if (session.oauth_hash) {
        try {
          const hashArray = JSON.parse(session.oauth_hash);
          if (Array.isArray(hashArray) && hashArray.includes(oauthHash)) {
            return session;
          }
          // Legacy support: if it's a string that matches directly
          if (typeof hashArray === "string" && hashArray === oauthHash) {
            return session;
          }
        } catch (parseError) {
          // Legacy format: single hash string
          if (session.oauth_hash === oauthHash) {
            return session;
          }
        }
      }
    }

    return null;
  } catch (error) {
    logger.error("Failed to get session by OAuth hash:", error);
    throw new Error(`Failed to get session: ${error.message}`);
  }
}

module.exports = {
  createSession,
  getSessionById,
  getSessionByToken,
  getSessionsByUserId,
  updateSessionActivity,
  expireSession,
  expireUserSessions,
  cleanupExpiredSessions,
  deleteSession,
  getSessionCount,
  updateUserSession,
  updateOAuthHash,
  getSessionBySessionHash,
  getSessionByOAuthHash,
};
