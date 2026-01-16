/**
 * Header Extraction Utilities
 *
 * Extracts and normalizes mobile-specific headers from HTTP requests.
 * Uses TrafficConfigManager to read field mapping from database.
 * If config is not available, values will be extracted from standard headers.
 */

const logger = require("./logger");

/**
 * Extract mobile headers from request using configurable mapping
 * Tries to extract from configured sources (header or query param)
 * Returns empty strings if values cannot be extracted
 * @param {Object} req - Express request object with headers property
 * @returns {Object} Normalized mobile headers
 */
function extractMobileHeaders(req) {
  const headers = req.headers || {};

  // Try to use TrafficConfigManager for configurable mapping
  let configManager = null;
  try {
    const { getInstance } = require("../config/TrafficConfigManager");
    configManager = getInstance();
  } catch (e) {
    // Config manager not available
  }

  // Extract query params from URL if available
  let queryParams = {};
  try {
    const url = req.url || req.originalUrl || "";
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

  let mobileEnvironment = null;
  let mobilePlatform = null;
  let mobileVersion = null;
  let acceptLanguage = null;

  // If config manager is available and initialized, use configured mapping
  if (configManager && configManager.isInitialized()) {
    mobileEnvironment = normalizeEnvironment(configManager.extractMappedValue("app_environment", headers, queryParams));
    mobilePlatform = normalizePlatform(configManager.extractMappedValue("app_platform", headers, queryParams));
    mobileVersion = configManager.extractMappedValue("app_version", headers, queryParams);
    acceptLanguage = normalizeLanguage(configManager.extractMappedValue("app_language", headers, queryParams));
  } else {
    // Use standard header names as fallback
    mobileEnvironment = normalizeEnvironment(headers["mobile-environment"] || headers["x-environment"]);
    mobilePlatform = normalizePlatform(headers["mobile-platform"] || headers["x-platform"]);
    mobileVersion = headers["mobile-version"] || headers["x-version"] || null;
    acceptLanguage = normalizeLanguage(headers["accept-language"] || headers["x-language"]);
  }

  // IMPORTANT: Return empty string instead of null for missing values
  // This prevents database errors when saving to api_requests table
  const result = {
    mobileEnvironment: mobileEnvironment || "",
    mobilePlatform: mobilePlatform || "",
    mobileVersion: mobileVersion || "",
    acceptLanguage: acceptLanguage || "en",
  };

  logger.debug("[HEADER_EXTRACTOR] Extracted mobile headers", {
    extracted: result,
    usingConfigManager: !!(configManager && configManager.isInitialized()),
  });

  return result;
}

/**
 * Normalize environment value
 * @param {string} environment - Environment from header
 * @returns {string} Normalized environment (sit, stage, dev, prod) or empty string if not found
 */
function normalizeEnvironment(environment) {
  if (!environment) {
    return "";
  }

  const normalized = environment.toLowerCase().trim();

  // Map variations to standard values
  const envMap = {
    sit: "sit",
    uat: "sit",
    stage: "stage",
    staging: "stage",
    dev: "dev",
    development: "dev",
    prod: "prod",
    production: "prod",
  };

  return envMap[normalized] || normalized;
}

/**
 * Normalize platform value
 * @param {string} platform - Platform from header
 * @returns {string} Normalized platform (android, ios) or empty string if not found
 */
function normalizePlatform(platform) {
  if (!platform) {
    return "";
  }

  const normalized = platform.toLowerCase().trim();

  // Accept variations
  if (normalized === "android" || normalized.startsWith("android")) {
    return "android";
  }

  if (normalized === "ios" || normalized.startsWith("ios") || normalized === "iphone") {
    return "ios";
  }

  return normalized;
}

/**
 * Normalize language value
 * @param {string} language - Language from accept-language header
 * @returns {string} Normalized language (en, fr)
 */
function normalizeLanguage(language) {
  if (!language) {
    return "en"; // Default to English
  }

  const normalized = language.toLowerCase().trim();

  // Extract language code (first 2 characters or full locale)
  // Examples: en_US -> en, fr_CA -> fr, en-US -> en
  const langCode = normalized.split(/[-_]/)[0];

  if (langCode === "fr" || langCode === "french") {
    return "fr";
  }

  // Default to English if no match
  return langCode || "en";
}

/**
 * Extract query parameters and normalize them for caching
 * @param {Object} query - Express query object
 * @returns {Object} Normalized query parameters
 */
function normalizeQueryParams(query) {
  if (!query || Object.keys(query).length === 0) {
    return {};
  }

  // Sort keys alphabetically for consistent hashing
  const sorted = {};
  Object.keys(query)
    .sort()
    .forEach((key) => {
      sorted[key] = query[key];
    });

  return sorted;
}

/**
 * Generate cache key for public requests
 * @param {string} endpointName - Endpoint name
 * @param {Object} headers - Mobile headers object
 * @param {Object} queryParams - Normalized query parameters
 * @returns {string} Cache key
 */
function generatePublicCacheKey(endpointName, headers, queryParams) {
  const parts = [endpointName, headers.mobileVersion, headers.mobileEnvironment, headers.mobilePlatform, headers.acceptLanguage];

  // Add query params if present
  if (queryParams && Object.keys(queryParams).length > 0) {
    parts.push(JSON.stringify(queryParams));
  }

  return parts.join("|");
}

/**
 * Generate cache key for secure requests (no version)
 * @param {number} userId - User ID
 * @param {string} endpointName - Endpoint name
 * @param {Object} headers - Mobile headers object
 * @returns {string} Cache key
 */
function generateSecureCacheKey(userId, endpointName, headers) {
  return [userId, endpointName, headers.mobileEnvironment, headers.mobilePlatform, headers.acceptLanguage].join("|");
}

/**
 * Extract correlation ID from request headers
 * @param {Object} req - Express request object
 * @returns {string} Correlation ID or generated UUID
 */
function getCorrelationId(req) {
  return req.headers["x-correlation-id"] || req.headers["correlation-id"] || require("uuid").v4();
}

/**
 * Extract traceability ID from request headers
 * @param {Object} req - Express request object
 * @returns {string} Traceability ID or null
 */
function getTraceabilityId(req) {
  return req.headers["x-traceability-id"] || req.headers["traceability-id"] || null;
}

/**
 * Extract session token from cookies
 * @param {Object} req - Express request object
 * @returns {string} Session token or null
 */
function getSessionToken(req) {
  const config = require("../config");
  const cookies = parseCookies(req.headers.cookie);
  return cookies[config.security.sessionCookieName] || null;
}

/**
 * Extract OAuth Bearer token from Authorization header
 * @param {Object} req - Express request object
 * @returns {string} Bearer token or null
 */
function getBearerToken(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return null;
  }

  const matches = authHeader.match(/Bearer\s+(.+)/i);
  return matches ? matches[1] : null;
}

/**
 * Parse cookie string into object
 * @param {string} cookieString - Cookie header value
 * @returns {Object} Parsed cookies
 */
function parseCookies(cookieString) {
  if (!cookieString) {
    return {};
  }

  const cookies = {};

  cookieString.split(";").forEach((cookie) => {
    const parts = cookie.trim().split("=");
    if (parts.length === 2) {
      cookies[parts[0]] = parts[1];
    }
  });

  return cookies;
}

/**
 * Format cookies object into Set-Cookie header value
 * @param {string} name - Cookie name
 * @param {string} value - Cookie value
 * @param {Object} options - Cookie options
 * @returns {string} Set-Cookie header value
 */
function formatSetCookie(name, value, options = {}) {
  let cookie = `${name}=${value}`;

  if (options.maxAge) {
    cookie += `; Max-Age=${options.maxAge}`;
  }

  if (options.expires) {
    cookie += `; Expires=${options.expires.toUTCString()}`;
  }

  if (options.path) {
    cookie += `; Path=${options.path}`;
  } else {
    cookie += "; Path=/";
  }

  if (options.domain) {
    cookie += `; Domain=${options.domain}`;
  }

  if (options.secure) {
    cookie += "; Secure";
  }

  if (options.httpOnly) {
    cookie += "; HttpOnly";
  }

  if (options.sameSite) {
    cookie += `; SameSite=${options.sameSite}`;
  }

  return cookie;
}

/**
 * Check if the request is a monitored request
 * @deprecated Use requestTypeDetector.isMonitoredRequest() instead
 * @param {Object} req - Express request object or plain headers object
 * @returns {boolean} True if the request should be monitored
 */
function isMonitoredRequest(req) {
  // Delegate to TrafficConfigManager if available
  try {
    const { getInstance } = require("../config/TrafficConfigManager");
    const configManager = getInstance();
    if (configManager && configManager.isInitialized() && configManager.isMonitoringEnabled()) {
      const headers = req.headers || req;
      return configManager.isMonitoredRequest(headers, {});
    }
  } catch (e) {
    // Config not available
  }
  return false;
}

/**
 * Validate required mobile headers
 * @param {Object} headers - Mobile headers object
 * @returns {Object} Validation result
 */
function validateMobileHeaders(headers) {
  const errors = [];

  if (!headers.mobileEnvironment) {
    errors.push("mobile-environment header is required");
  }

  if (!headers.mobilePlatform) {
    errors.push("mobile-platform header is required");
  }

  if (!["android", "ios"].includes(headers.mobilePlatform)) {
    errors.push("mobile-platform must be android or ios");
  }

  if (!headers.mobileVersion) {
    errors.push("mobile-version header is required");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

module.exports = {
  extractMobileHeaders,
  normalizeEnvironment,
  normalizePlatform,
  normalizeLanguage,
  normalizeQueryParams,
  generatePublicCacheKey,
  generateSecureCacheKey,
  getCorrelationId,
  getTraceabilityId,
  getSessionToken,
  getBearerToken,
  parseCookies,
  formatSetCookie,
  validateMobileHeaders,
  isMonitoredRequest,
};
