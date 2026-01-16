/**
 * Login Handler
 *
 * Checks if a request is a login/authentication request.
 * In replay mode, login requests are treated like any other secure endpoint
 * and responses are fetched from the cache using DPSESSION cookies.
 */

const logger = require("../utils/logger");

/**
 * Check if request is a login request
 * @param {Object} req - Express request object
 * @returns {boolean} True if login request
 */
function isLoginRequest(req) {
  const path = req.path.toLowerCase();
  const method = req.method.toUpperCase();

  // OAuth token endpoint
  if (path.includes("/sec/services-a/token") && method === "POST") {
    return true;
  }

  // OAuth authorize endpoint
  if (path.includes("/sec/services-a/authorize")) {
    return true;
  }

  // Other login patterns
  if (path.includes("/login") || path.includes("/authenticate")) {
    return true;
  }

  return false;
}

module.exports = {
  isLoginRequest,
};
