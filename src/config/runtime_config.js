/**
 * Runtime Configuration Manager
 *
 * Manages persistent runtime configuration stored in the database config table.
 * Provides fallback to environment variables if database config doesn't exist or item missing.
 *
 * Priority: Database config > Environment variables
 */

const logger = require("../utils/logger");
const configRepository = require("../database/repositories/config_repository");

// Default config from environment variables
const envConfig = require("./index");

/**
 * Load runtime configuration from database
 * @returns {Object} Runtime configuration object (cached)
 */
let cachedConfig = null;

async function loadRuntimeConfig() {
  try {
    if (cachedConfig) {
      return cachedConfig;
    }

    const masterConfig = await configRepository.getMasterConfig();
    
    if (masterConfig) {
      cachedConfig = {
        mode: masterConfig.mode || null,
        timeWindow: masterConfig.timeWindow || null,
      };
      logger.info("Runtime configuration loaded from database", {
        keys: Object.keys(cachedConfig),
      });
      return cachedConfig;
    }

    // No config in database, return empty object
    logger.info("Runtime config not found in database, will use defaults from .env");
    return {};
  } catch (error) {
    logger.error("Failed to load runtime config from database", {
      error: error.message,
    });
    // Return empty object on error, will fall back to .env
    return {};
  }
}

/**
 * Clear cached config (call after updating database)
 */
function clearCache() {
  cachedConfig = null;
}

/**
 * Get a configuration value
 * Priority: Database config > Environment variables
 *
 * @param {string} key - Configuration key (e.g., 'mode', 'timeWindow')
 * @returns {any} Configuration value (synchronous, uses cached value or .env fallback)
 */
function getConfig(key) {
  // For synchronous access, use cached config or fall back to .env
  if (cachedConfig && key in cachedConfig && cachedConfig[key] !== null) {
    logger.debug("Using cached config value from database", { key, value: cachedConfig[key] });
    return cachedConfig[key];
  }

  // Fall back to environment variable based config
  switch (key) {
    case "mode":
      logger.debug("Using default mode from .env", {
        value: envConfig.proxy.defaultMode,
      });
      return envConfig.proxy.defaultMode;
    case "timeWindow":
      logger.debug("Using default timeWindow from .env", {
        value: "3d",
      });
      return "3d";
    default:
      logger.warn("Unknown config key requested", { key });
      return null;
  }
}

/**
 * Get a configuration value asynchronously (reads from database)
 * Priority: Database config > Environment variables
 *
 * @param {string} key - Configuration key (e.g., 'mode', 'timeWindow')
 * @returns {Promise<any>} Configuration value
 */
async function getConfigAsync(key) {
  const runtimeConfig = await loadRuntimeConfig();

  // Check if value exists in runtime config
  if (key in runtimeConfig && runtimeConfig[key] !== null) {
    logger.debug("Using runtime config value from database", { key, value: runtimeConfig[key] });
    return runtimeConfig[key];
  }

  // Fall back to environment variable based config
  switch (key) {
    case "mode":
      logger.debug("Using default mode from .env", {
        value: envConfig.proxy.defaultMode,
      });
      return envConfig.proxy.defaultMode;
    case "timeWindow":
      logger.debug("Using default timeWindow from .env", {
        value: "3d",
      });
      return "3d";
    default:
      logger.warn("Unknown config key requested", { key });
      return null;
  }
}

/**
 * Set a configuration value and persist to database
 *
 * @param {string} key - Configuration key (e.g., 'mode', 'timeWindow')
 * @param {any} value - Configuration value
 * @returns {Promise<void>}
 */
async function setConfig(key, value) {
  try {
    const oldValue = cachedConfig?.[key];

    // Update database
    if (key === "mode") {
      await configRepository.updateProxyMode(value);
    } else if (key === "timeWindow") {
      await configRepository.updateTimelineFilter(value);
    } else {
      logger.warn("Unknown config key for database update", { key });
      return;
    }

    // Update cache
    if (!cachedConfig) {
      cachedConfig = {};
    }
    cachedConfig[key] = value;

    logger.info("Runtime configuration updated in database", {
      key,
      oldValue,
      newValue: value,
    });
  } catch (error) {
    logger.error("Failed to update runtime config in database", {
      key,
      value,
      error: error.message,
    });
    throw error;
  }
}

/**
 * Get entire runtime configuration
 * Merges runtime config with defaults from environment
 *
 * @returns {Promise<Object>} Complete runtime configuration
 */
async function getFullConfig() {
  const runtimeConfig = await loadRuntimeConfig();

  return {
    mode: runtimeConfig.mode || envConfig.proxy.defaultMode,
    timeWindow: runtimeConfig.timeWindow || '3d',
    // Add other runtime-configurable items here as needed
  };
}

module.exports = {
  loadRuntimeConfig,
  getConfig,
  getConfigAsync,
  setConfig,
  getFullConfig,
  clearCache,
};
