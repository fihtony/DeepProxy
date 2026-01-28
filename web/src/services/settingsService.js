/**
 * Settings Service
 *
 * API client for settings configuration management.
 * Handles traffic, mapping, endpoint, and session configuration.
 */

import axios from "axios";

// Create axios instance with defaults
const api = axios.create({
  baseURL: "/admin/api/settings",
  timeout: 30000,
  headers: {
    "Content-Type": "application/json",
  },
});

// Add response interceptor for error handling
api.interceptors.response.use(
  (response) => response.data,
  (error) => {
    console.error("Settings API error:", error);
    return Promise.reject(error);
  }
);

// ============================================================================
// Traffic Configuration
// ============================================================================

/**
 * Get traffic monitoring configuration
 * @returns {Promise<Object>} Traffic config with monitor and domains
 */
export const getTrafficConfig = () => api.get("/traffic");

/**
 * Update traffic monitoring configuration
 * @param {Object} config - Traffic config { monitor, domains }
 * @returns {Promise<Object>} Updated config
 */
export const updateTrafficConfig = (config) => api.put("/traffic", config);

// ============================================================================
// Mapping Configuration
// ============================================================================

/**
 * Get field mapping configuration
 * @returns {Promise<Object>} Mapping config
 */
export const getMappingConfig = () => api.get("/mapping");

/**
 * Update field mapping configuration
 * @param {Object} config - Mapping config
 * @returns {Promise<Object>} Updated config
 */
export const updateMappingConfig = (config) => api.put("/mapping", config);

// ============================================================================
// Endpoint Configuration
// ============================================================================

/**
 * Get endpoint type configuration
 * @returns {Promise<Object>} Endpoint config with types, tags, fallback
 */
export const getEndpointConfig = () => api.get("/endpoint");

/**
 * Update endpoint type configuration
 * @param {Object} config - Endpoint config { types, tags, fallback }
 * @returns {Promise<Object>} Updated config
 */
export const updateEndpointConfig = (config) => api.put("/endpoint", config);

/**
 * Test endpoint classification for a given path
 * @param {string} path - URL path to test
 * @returns {Promise<Object>} Classification result { path, endpointType, tags, isSecure }
 */
export const testEndpointClassification = (path) => api.post("/endpoint/test", { path });

// ============================================================================
// Proxy Configuration
// ============================================================================

/**
 * Get proxy configuration (default matching settings)
 * @returns {Promise<Object>} Proxy config with replayDefaults and recordingDefaults
 */
export const getProxyConfig = () => api.get("/proxy");

/**
 * Update proxy configuration (only replayDefaults can be updated)
 * @param {Object} config - Proxy config { replayDefaults }
 * @returns {Promise<Object>} Updated config
 */
export const updateProxyConfig = (config) => api.put("/proxy", config);

/**
 * Get CA certificate info (without downloading)
 * @returns {Promise<Object>} CA cert info { available, fileName, size, modifiedAt }
 */
export const getCaCertInfo = () => api.get("/proxy/ca-cert/info");

/**
 * Get CA certificate download URL
 * @returns {string} URL to download the CA certificate
 */
export const getCaCertDownloadUrl = () => "/admin/api/settings/proxy/ca-cert";

// ============================================================================
// Session Configuration
// ============================================================================

/**
 * Get session management configuration
 * @returns {Promise<Object>} Session config with create, update, session settings
 */
export const getSessionConfig = () => api.get("/session");

/**
 * Update session management configuration
 * @param {Object} config - Session config { create, update, session }
 * @returns {Promise<Object>} Updated config
 */
export const updateSessionConfig = (config) => api.put("/session", config);

/**
 * Delete session management configuration (revert to legacy)
 * @returns {Promise<Object>} Success message
 */
export const deleteSessionConfig = () => api.delete("/session");

/**
 * Validate session configuration without saving
 * @param {Object} config - Session config to validate
 * @returns {Promise<Object>} Validation result { valid, errors }
 */
export const validateSessionConfig = (config) => api.post("/session/validate", config);

// ============================================================================
// Export/Import
// ============================================================================

/**
 * Export all configurations as a backup file
 * @returns {Promise<Object>} Export data with all configs
 */
export const exportAllConfigs = () => api.get("/export");

/**
 * Import configurations from backup
 * @param {Object} configs - Configs to import { traffic?, mapping?, endpoint?, session? }
 * @param {boolean} overwrite - Whether to overwrite existing configs
 * @returns {Promise<Object>} Import result with conflicts or success
 */
export const importConfigs = (configs, overwrite = false) => api.post("/import", { configs, overwrite });

// ============================================================================
// General
// ============================================================================

/**
 * Get all settings (traffic, mapping, endpoint, session)
 * @returns {Promise<Object>} All settings
 */
export const getAllSettings = () => api.get("/");

/**
 * Refresh all settings from database
 * @returns {Promise<Object>} Refreshed settings
 */
export const refreshSettings = () => api.post("/refresh");

export default {
  getTrafficConfig,
  updateTrafficConfig,
  getMappingConfig,
  updateMappingConfig,
  getEndpointConfig,
  updateEndpointConfig,
  testEndpointClassification,
  getAllSettings,
  refreshSettings,
};
