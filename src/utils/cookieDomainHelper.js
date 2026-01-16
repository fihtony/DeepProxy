/**
 * Cookie Domain Helper
 *
 * Utilities for creating DPSESSION cookies for configured monitored domains.
 * All domain information is sourced from TrafficConfigManager which reads from database.
 * No fallback to hardcoded domains - if config is not initialized, no cookies are created.
 */

const logger = require("./logger");

/**
 * Get all monitored domains that need DPSESSION cookie
 * Requires TrafficConfigManager to be initialized with configured domains.
 *
 * @returns {string[]} Array of domain names from database config
 * @throws {Error} If TrafficConfigManager is not initialized
 */
function getMonitoredDomains() {
  try {
    const { getInstance } = require("../config/TrafficConfigManager");
    const configManager = getInstance();

    if (!configManager || !configManager.isInitialized()) {
      logger.warn("[COOKIE_HELPER] TrafficConfigManager not initialized - returning empty domain list");
      return [];
    }

    return configManager.getDomainNames();
  } catch (error) {
    logger.error("[COOKIE_HELPER] Error getting monitored domains", { error: error.message });
    return [];
  }
}

/**
 * Check if a domain requires HTTPS (Secure flag)
 * Uses domain protocol configuration from TrafficConfigManager.
 *
 * @param {string} domain - Domain name to check
 * @returns {boolean} True if domain requires HTTPS, false otherwise
 */
function isSecureDomain(domain) {
  if (!domain) {
    return false;
  }

  try {
    const { getInstance } = require("../config/TrafficConfigManager");
    const configManager = getInstance();

    if (!configManager || !configManager.isInitialized()) {
      return false;
    }

    return configManager.isSecureDomain(domain);
  } catch (error) {
    logger.error("[COOKIE_HELPER] Error checking if domain is secure", { domain, error: error.message });
    return false;
  }
}

/**
 * Create DPSESSION cookie headers for configured monitored domains
 *
 * @param {string} sessionToken - Session token (UUID)
 * @returns {string[]} Array of Set-Cookie header values for each configured domain
 *
 * @example
 * createMonitoredDomainCookies('abc-123-def-456')
 * // returns [
 * //   'DPSESSION=abc-123-def-456; Domain=api.example.com; Path=/; HttpOnly; SameSite=None',
 * //   'DPSESSION=abc-123-def-456; Domain=auth.example.com; Path=/; Secure; HttpOnly; SameSite=None',
 * // ]
 */
function createMonitoredDomainCookies(sessionToken) {
  if (!sessionToken) {
    logger.warn("[COOKIE_HELPER] No session token provided for cookie creation");
    return [];
  }

  const domains = getMonitoredDomains();
  if (domains.length === 0) {
    logger.debug("[COOKIE_HELPER] No monitored domains configured - skipping cookie creation");
    return [];
  }

  const cookies = [];

  for (const domain of domains) {
    let cookieValue = `DPSESSION=${sessionToken}; Domain=${domain}; Path=/; HttpOnly; SameSite=None`;

    // Add Secure flag if domain uses HTTPS
    if (isSecureDomain(domain)) {
      cookieValue = `DPSESSION=${sessionToken}; Domain=${domain}; Path=/; Secure; HttpOnly; SameSite=None`;
    }

    cookies.push(cookieValue);
  }

  return cookies;
}

module.exports = {
  getMonitoredDomains,
  createMonitoredDomainCookies,
  isSecureDomain,
};
