/**
 * Request Type Detector
 *
 * Purpose:
 * - Detect whether a request should be monitored based on configurable criteria
 * - Uses TrafficConfigManager to read monitor pattern and domain list from database
 * - If config is not available, all traffic passes through (not monitored)
 *
 * Monitoring requires TWO conditions to be met:
 * 1. Request must match the configured monitor criteria (header/query pattern)
 * 2. Request must come from one of the configured monitored domains
 *
 * Non-monitored requests (e.g., CDN, static image requests, requests from other domains) should be:
 * - Directly forwarded without endpoint matching
 * - Not recorded in stats table or other dProxy tables
 * - Passed through with minimal processing
 */

const logger = require("./logger");
const { getInstance } = require("../config/TrafficConfigManager");

/**
 * Check if request is a monitored request based on configured criteria
 * Requires BOTH monitor pattern match AND domain match
 * @param {Object} requestContext - RequestContext instance
 * @returns {boolean} True if request matches monitor criteria AND comes from monitored domain
 */
function isMonitoredRequest(requestContext) {
  const headers = requestContext.getCurrent().headers || {};
  const configManager = getInstance();

  // If config manager is not initialized or monitoring not enabled, return false
  if (!configManager || !configManager.isInitialized() || !configManager.isMonitoringEnabled()) {
    logger.debug("[RequestTypeDetector] Monitoring not enabled, passing through");
    return false;
  }

  // Extract query params if available
  let queryParams = {};
  try {
    const current = requestContext.getCurrent();
    const url = current.url || current.originalUrl || "";
    if (url.includes("?")) {
      const queryString = url.split("?")[1];
      const params = new URLSearchParams(queryString);
      params.forEach((value, key) => {
        queryParams[key] = value;
      });
    }
  } catch (e) {
    // Ignore query param parsing errors
  }

  // Check 1: Request must match monitor criteria (header/query pattern)
  const matchesMonitorCriteria = configManager.isMonitoredRequest(headers, queryParams);

  if (!matchesMonitorCriteria) {
    logger.debug("[RequestTypeDetector] Request does not match monitor criteria, bypassing", {
      monitorConfig: configManager.getTrafficConfig()?.monitor,
    });
    return false;
  }

  // Check 2: Request must come from a monitored domain
  // Try to extract host from multiple sources:
  // 1. headers.host (HTTP/1.1 proxy requests)
  // 2. headers[":authority"] (HTTP/2)
  // 3. Extract from original URL (HTTP proxy protocol with full URL)
  // 4. Extract from current URL
  let host = headers.host || headers[":authority"];

  // If no host in headers, try to extract from URL
  if (!host) {
    const current = requestContext.getCurrent();
    const url = current.originalUrl || current.url || "";

    if (url && (url.startsWith("http://") || url.startsWith("https://"))) {
      try {
        const urlObj = new URL(url);
        host = urlObj.hostname;
      } catch (e) {
        // URL parsing failed, host remains undefined
      }
    }
  }

  // Default to unknown if still no host
  if (!host) {
    host = "unknown";
  }

  const matchesDomain = configManager.isMonitoredDomain(host);

  if (!matchesDomain) {
    logger.info("[RequestTypeDetector] Request matches monitor pattern but not from monitored domain, bypassing", {
      host,
      monitoredDomains: configManager.getMonitoredDomains().map((d) => d.domain),
    });
    return false;
  }

  logger.debug("[RequestTypeDetector] Request is monitored (matches criteria and domain)", {
    host,
    monitorConfig: configManager.getTrafficConfig()?.monitor,
  });

  return true;
}

/**
 * Check if request should bypass dProxy processing
 * (i.e., should be directly forwarded)
 * @param {Object} requestContext - RequestContext instance
 * @returns {boolean} True if request should bypass dProxy
 */
function shouldBypassDProxy(requestContext) {
  return !isMonitoredRequest(requestContext);
}

module.exports = {
  isMonitoredRequest,
  shouldBypassDProxy,
};
