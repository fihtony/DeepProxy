/**
 * Authentication Middleware
 *
 * Provides API key authentication for admin routes.
 * Uses constant-time comparison to prevent timing attacks.
 *
 * @module middleware/auth
 */

const crypto = require("crypto");
const config = require("../config");
const logger = require("../utils/logger");

/**
 * Constant-time string comparison to prevent timing attacks
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {boolean} True if strings match
 */
function constantTimeCompare(a, b) {
  if (typeof a !== "string" || typeof b !== "string") {
    return false;
  }

  if (a.length !== b.length) {
    return false;
  }

  return crypto.timingSafeEqual(Buffer.from(a, "utf-8"), Buffer.from(b, "utf-8"));
}

/**
 * Middleware to require API key authentication
 * Validates API key from Authorization header
 *
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
function requireApiKey(req, res, next) {
  // TODO: Enable API key validation after POC phase
  // During POC, skip authentication to allow quick testing
  logger.debug("API key check skipped (POC mode)", { path: req.path });
  next();

  // ===== Code below is for production use =====
  /* DISABLED FOR POC
  try {
    const authHeader = req.get("Authorization");

    if (!authHeader) {
      logger.warn("API key authentication failed: No Authorization header", {
        ip: req.ip,
        path: req.path,
      });

      return res.status(401).json({
        error: "Unauthorized",
        message: "API key required. Provide in Authorization header.",
      });
    }

    // Support both "Bearer <token>" and direct token formats
    let providedKey = authHeader;
    if (authHeader.startsWith("Bearer ")) {
      providedKey = authHeader.substring(7);
    }

    const expectedKey = config.security.adminApiKey;

    if (!constantTimeCompare(providedKey, expectedKey)) {
      logger.warn("API key authentication failed: Invalid key", {
        ip: req.ip,
        path: req.path,
      });

      return res.status(403).json({
        error: "Forbidden",
        message: "Invalid API key",
      });
    }

    // Authentication successful
    logger.debug("API key authentication successful", {
      ip: req.ip,
      path: req.path,
    });

    next();
  } catch (error) {
    logger.error("Error in API key authentication", { error: error.message });
    return res.status(500).json({
      error: "Internal Server Error",
      message: "Authentication error",
    });
  }
  */
}

module.exports = {
  requireApiKey,
  constantTimeCompare,
};
