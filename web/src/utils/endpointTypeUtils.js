/**
 * Utility functions for endpoint type classification
 */

/**
 * Check if endpoint path is a transmit endpoint
 * @param {string} endpointPath - The endpoint path or name
 * @returns {boolean} - True if endpoint is transmit type
 */
export const isTransmitEndpoint = (endpointPath) => {
  if (!endpointPath) return false;
  return endpointPath.includes("/transmit/mfa/api/");
};

/**
 * Get display type for endpoint
 * - If path contains "/transmit/mfa/api/", return "Transmit"
 * - Otherwise return endpoint_type (public or secure), with optional default
 * @param {string} endpointPathOrName - The endpoint path or name
 * @param {string} endpointType - The endpoint type (public/secure/null)
 * @param {string} defaultType - Default type if endpointType is not provided (defaults to "public")
 * @returns {string} - Display type (Transmit, public, secure, or defaultType)
 */
export const getDisplayType = (endpointPathOrName, endpointType, defaultType = "public") => {
  if (isTransmitEndpoint(endpointPathOrName)) {
    return "Transmit";
  }
  return endpointType || defaultType;
};
