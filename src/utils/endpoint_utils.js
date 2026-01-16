/**
 * Endpoint Utilities
 *
 * Centralized functions for endpoint name extraction and security classification.
 * Uses TrafficConfigManager to read endpoint type rules from database.
 * If endpoint config is not available, all endpoints default to "public" type.
 *
 * @module utils/endpoint_utils
 */

const logger = require("./logger");
const { getInstance } = require("../config/TrafficConfigManager");

/**
 * Extract endpoint name from URL path
 *
 * Extracts a human-readable endpoint name from the URL path.
 * Removes query parameters and returns the last path segment.
 *
 * @param {string} path - Full URL path (may include query string)
 * @returns {string} Clean endpoint name
 *
 * @example
 * getEndpointName("/api/users/123?v=1") // -> "123"
 * getEndpointName("/sec/dashboard") // -> "dashboard"
 */
function getEndpointName(path) {
  if (!path) {
    return "unknown";
  }

  // Step 1: Remove query parameters
  const cleanPath = path.split("?")[0];

  // Step 2: Extract last segment from clean path
  const segments = cleanPath.split("/").filter((s) => s.length > 0);
  if (segments.length > 0) {
    const lastSegment = segments[segments.length - 1];
    // Remove any remaining query params or file extensions
    return lastSegment.split("?")[0].split(".")[0];
  }

  return "unknown";
}

/**
 * Check if endpoint is secure (requires authentication)
 *
 * Uses TrafficConfigManager to determine endpoint type.
 * If config is not available, defaults to public (not secure).
 *
 * @param {string} path - URL path
 * @returns {boolean} True if endpoint requires authentication
 */
function isSecureEndpoint(path) {
  if (!path) {
    return false;
  }

  const configManager = getInstance();
  if (configManager && configManager.isInitialized()) {
    return configManager.isSecureEndpoint(path);
  }

  // No config available - default to public (not secure)
  return false;
}

/**
 * Check if endpoint is public (does not require authentication)
 *
 * @param {string} path - URL path
 * @returns {boolean} True if endpoint is public
 */
function isPublicEndpoint(path) {
  return !isSecureEndpoint(path);
}

/**
 * Determine endpoint type category
 *
 * Returns the endpoint type based on configured rules.
 * Uses TrafficConfigManager to read endpoint type rules from database.
 * If config is not available, returns the configured fallback type (default: "public").
 *
 * @param {string} path - URL path
 * @returns {string} Endpoint type (e.g., 'secure', 'public', or custom type)
 */
function getEndpointType(path) {
  const configManager = getInstance();
  if (configManager && configManager.isInitialized()) {
    return configManager.getEndpointType(path);
  }

  // No config available - default to "public"
  return "public";
}

/**
 * Get tags for an endpoint
 *
 * Returns array of matching tags based on endpoint config in database.
 * If config is not available, returns empty array.
 *
 * @param {string} path - URL path
 * @returns {Array} Array of tag objects { name, color }
 */
function getEndpointTags(path) {
  const configManager = getInstance();
  if (configManager && configManager.isInitialized()) {
    return configManager.getEndpointTags(path);
  }
  return [];
}

/**
 * Check if endpoint is a transmit endpoint
 *
 * Identifies special transmit/mfa endpoints that are used for MFA authentication.
 * These endpoints are typically excluded from normal request recording/matching.
 *
 * @param {string} path - URL path
 * @returns {boolean} True if endpoint is a transmit endpoint
 */
function isTransmitEndpoint(path) {
  if (!path) {
    return false;
  }
  return path.includes("/transmit/mfa/api/");
}

module.exports = {
  getEndpointName,
  isSecureEndpoint,
  isPublicEndpoint,
  getEndpointType,
  getEndpointTags,
  isTransmitEndpoint,
};
