/**
 * SessionConfigManager - Manages session configuration for user tracking
 *
 * Purpose:
 * - Handle session configuration stored in database (type='session')
 * - Provide configurable session creation rules (create triggers)
 * - Provide configurable session update rules (update triggers)
 * - Support flexible user ID extraction from body, header, query params
 * - Support flexible token extraction from cookies, body, headers
 *
 * Configuration Structure (stored in config table with type='session'):
 * - create: Array of rules to trigger session creation
 *   Each rule has: method, endpoint, source (body/header/query), key, pattern
 * - update: Array of rules to extract tokens from responses
 *   Each rule has: method, endpoint, source (cookie/body/header), key, pattern, type
 * - session: Settings object with expiry (seconds)
 */

const db = require("../database/connection");
const logger = require("../utils/logger");
const { getLocalISOString } = require("../utils/datetimeUtils");

class SessionConfigManager {
  constructor() {
    this.config = null;
    this.configLoaded = false;
  }

  /**
   * Load session configuration from database
   * @returns {Promise<Object|null>} Session config or null
   */
  async loadConfig() {
    try {
      const database = db.getDatabase();
      const row = database.prepare("SELECT * FROM config WHERE type = 'session'").get();

      if (!row) {
        logger.debug("[SESSION_CONFIG] No session config found in database");
        this.config = null;
        this.configLoaded = true;
        return null;
      }

      this.config = JSON.parse(row.config);
      this.configLoaded = true;

      logger.info("[SESSION_CONFIG] Session configuration loaded", {
        createRulesCount: this.config.create?.length || 0,
        updateRulesCount: this.config.update?.length || 0,
        hasSessionSettings: !!this.config.session,
      });

      return this.config;
    } catch (error) {
      logger.error("[SESSION_CONFIG] Failed to load session config", { error: error.message });
      this.config = null;
      this.configLoaded = true;
      return null;
    }
  }

  /**
   * Get session configuration (loads from DB if not cached)
   * @returns {Promise<Object|null>} Session config or null
   */
  async getConfig() {
    if (!this.configLoaded) {
      await this.loadConfig();
    }
    return this.config;
  }

  /**
   * Get session configuration synchronously (returns cached value)
   * @returns {Object|null} Session config or null
   */
  getConfigSync() {
    return this.config;
  }

  /**
   * Check if session config exists
   * @returns {boolean} True if config exists
   */
  hasConfig() {
    return this.config !== null;
  }

  /**
   * Get create rules
   * @returns {Array} Array of create rules
   */
  getCreateRules() {
    return this.config?.create || [];
  }

  /**
   * Get update rules
   * @returns {Array} Array of update rules
   */
  getUpdateRules() {
    return this.config?.update || [];
  }

  /**
   * Get session settings
   * @returns {Object} Session settings (expiry, etc.)
   */
  getSessionSettings() {
    return this.config?.session || { expiry: 86400 }; // Default 24 hours
  }

  /**
   * Get update rules by type
   * @param {string} type - "cookie" or "auth"
   * @returns {Array} Filtered update rules
   */
  getUpdateRulesByType(type) {
    return this.getUpdateRules().filter((rule) => rule.type === type);
  }

  /**
   * Save session configuration to database
   * Normalizes configuration:
   * - Converts method="Any" to method=null (null means any method)
   * - Converts empty endpoint to null (null means any endpoint)
   * @param {Object} config - Session configuration
   * @returns {Promise<boolean>} Success status
   */
  async saveConfig(config) {
    try {
      // Normalize configuration before saving
      const normalizedConfig = this._normalizeConfig(config);

      const database = db.getDatabase();
      const configJson = JSON.stringify(normalizedConfig);
      const now = getLocalISOString();

      // Check if session config exists
      const existing = database.prepare("SELECT id FROM config WHERE type = 'session'").get();

      if (existing) {
        database.prepare("UPDATE config SET config = ?, updated_at = ? WHERE type = 'session'").run(configJson, now);
      } else {
        database.prepare("INSERT INTO config (type, config, created_at, updated_at) VALUES ('session', ?, ?, ?)").run(configJson, now, now);
      }

      this.config = normalizedConfig;
      this.configLoaded = true;

      logger.info("[SESSION_CONFIG] Session configuration saved", {
        createRulesCount: normalizedConfig.create?.length || 0,
        updateRulesCount: normalizedConfig.update?.length || 0,
      });

      return true;
    } catch (error) {
      logger.error("[SESSION_CONFIG] Failed to save session config", { error: error.message });
      throw error;
    }
  }

  /**
   * Delete session configuration from database
   * @returns {Promise<boolean>} Success status
   */
  async deleteConfig() {
    try {
      const database = db.getDatabase();
      database.prepare("DELETE FROM config WHERE type = 'session'").run();

      this.config = null;
      this.configLoaded = true;

      logger.info("[SESSION_CONFIG] Session configuration deleted");
      return true;
    } catch (error) {
      logger.error("[SESSION_CONFIG] Failed to delete session config", { error: error.message });
      throw error;
    }
  }

  /**
   * Check if a request matches a create rule
   * @param {Object} rule - Create rule
   * @param {string} method - HTTP method
   * @param {string} endpoint - Endpoint path or URL
   * @returns {boolean} True if matches
   */
  matchesCreateRule(rule, method, endpoint) {
    // Check method (null means any method)
    if (rule.method && rule.method.toUpperCase() !== method.toUpperCase()) {
      return false;
    }

    // Check endpoint pattern (null/empty means any endpoint)
    if (rule.endpoint) {
      try {
        const regex = new RegExp(rule.endpoint, "i");
        if (!regex.test(endpoint)) {
          return false;
        }
      } catch (e) {
        logger.warn("[SESSION_CONFIG] Invalid endpoint regex in create rule", {
          pattern: rule.endpoint,
          error: e.message,
        });
        return false;
      }
    }

    return true;
  }

  /**
   * Check if a request/response matches an update rule
   * @param {Object} rule - Update rule
   * @param {string} method - HTTP method
   * @param {string} endpoint - Endpoint path or URL
   * @returns {boolean} True if matches
   */
  matchesUpdateRule(rule, method, endpoint) {
    // Check method (null/empty means any method)
    if (rule.method && rule.method.toUpperCase() !== method.toUpperCase()) {
      return false;
    }

    // Check endpoint pattern (null/empty means any endpoint)
    if (rule.endpoint) {
      try {
        const regex = new RegExp(rule.endpoint, "i");
        if (!regex.test(endpoint)) {
          return false;
        }
      } catch (e) {
        logger.warn("[SESSION_CONFIG] Invalid endpoint regex in update rule", {
          pattern: rule.endpoint,
          error: e.message,
        });
        return false;
      }
    }

    return true;
  }

  /**
   * Extract value from request based on source and key
   * @param {Object} requestContext - Request context
   * @param {string} source - "body", "header", or "query"
   * @param {string} key - Key path (dot notation for body/nested objects)
   * @param {string|null} pattern - Optional regex pattern for extraction
   * @returns {string|null} Extracted value or null
   */
  extractValueFromRequest(requestContext, source, key, pattern = null) {
    try {
      const current = requestContext.getCurrent();
      let rawValue = null;

      switch (source.toLowerCase()) {
        case "body":
          rawValue = this._getNestedValue(current.body, key);
          break;

        case "header":
          // Headers are case-insensitive
          const headerKey = key.toLowerCase();
          rawValue = current.headers[headerKey] || current.headers[key];
          break;

        case "query":
          // Try from query object first, then from URL
          const original = requestContext.getOriginal();
          const query = current.query || original.query || {};
          rawValue = query[key];

          // If not found in query object, try parsing from URL
          if (!rawValue) {
            const url = current.originalUrl || current.url || "";
            const urlParams = new URLSearchParams(url.split("?")[1] || "");
            rawValue = urlParams.get(key);
          }
          break;

        default:
          logger.warn("[SESSION_CONFIG] Unknown source type", { source });
          return null;
      }

      if (rawValue === null || rawValue === undefined) {
        return null;
      }

      // Convert to string if needed
      const strValue = String(rawValue);

      // Apply pattern extraction if provided
      if (pattern) {
        return this._extractWithPattern(strValue, pattern);
      }

      return strValue;
    } catch (error) {
      logger.error("[SESSION_CONFIG] Failed to extract value from request", {
        source,
        key,
        error: error.message,
      });
      return null;
    }
  }

  /**
   * Extract value from response based on source and key
   * @param {Object} responseContext - Response context
   * @param {Object} requestHeaders - Original request headers (for cookies)
   * @param {string} source - "cookie", "body", or "header"
   * @param {string} key - Key path (cookie name, header name, or body path)
   * @param {string|null} pattern - Optional regex pattern for extraction
   * @returns {string|null} Extracted value or null
   */
  extractValueFromResponse(responseContext, requestHeaders, source, key, pattern = null) {
    try {
      let rawValue = null;

      switch (source.toLowerCase()) {
        case "cookie":
          // Extract from Set-Cookie header in response
          const setCookieHeaders = responseContext.getHeader("set-cookie") || [];
          rawValue = this._extractCookieValue(setCookieHeaders, key);
          break;

        case "body":
          let body = responseContext.getBody();

          // If body is a Buffer, convert to string first
          if (Buffer.isBuffer(body)) {
            body = body.toString("utf-8");
          }

          // If body is a string, try to parse as JSON
          if (typeof body === "string" && body.trim()) {
            try {
              body = JSON.parse(body);
            } catch (parseErr) {
              // Keep as string if not valid JSON
              logger.debug("[SESSION_CONFIG] Response body is not valid JSON, treating as string", {
                bodyPreview: body.substring(0, 100),
              });
            }
          }

          rawValue = this._getNestedValue(body, key);
          break;

        case "header":
          const headerKey = key.toLowerCase();
          const headers = responseContext.getHeaders();
          rawValue = headers[headerKey] || headers[key];
          break;

        default:
          logger.warn("[SESSION_CONFIG] Unknown response source type", { source });
          return null;
      }

      if (rawValue === null || rawValue === undefined) {
        return null;
      }

      // Convert to string if needed
      const strValue = String(rawValue);

      // Apply pattern extraction if provided
      if (pattern) {
        return this._extractWithPattern(strValue, pattern);
      }

      return strValue;
    } catch (error) {
      logger.error("[SESSION_CONFIG] Failed to extract value from response", {
        source,
        key,
        error: error.message,
      });
      return null;
    }
  }

  /**
   * Extract cookie value from Set-Cookie headers
   * @private
   * @param {Array|string} setCookieHeaders - Set-Cookie header(s)
   * @param {string} cookieName - Cookie name to extract
   * @returns {string|null} Cookie value or null
   */
  _extractCookieValue(setCookieHeaders, cookieName) {
    const cookies = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];

    for (const cookie of cookies) {
      if (!cookie) continue;
      // Create regex to match cookie name (case-insensitive)
      const regex = new RegExp(`${cookieName}=([^;]+)`, "i");
      const match = cookie.match(regex);
      if (match && match[1]) {
        return match[1];
      }
    }

    return null;
  }

  /**
   * Get nested value from object using dot notation
   * @private
   * @param {Object} obj - Source object
   * @param {string} path - Dot notation path (e.g., "data.user")
   * @returns {*} Value at path or null
   */
  _getNestedValue(obj, path) {
    if (!obj || typeof obj !== "object" || !path) {
      return null;
    }

    const parts = path.split(".");
    let current = obj;

    for (const part of parts) {
      if (current === null || current === undefined) {
        return null;
      }
      current = current[part];
    }

    return current;
  }

  /**
   * Set value in nested object using dot notation path
   * @private
   * @param {Object} obj - Target object
   * @param {string} path - Dot notation path (e.g., "data.user.id")
   * @param {*} value - Value to set
   * @returns {Object} Modified object
   */
  _setNestedValue(obj, path, value) {
    if (!obj || typeof obj !== "object" || !path) {
      return obj;
    }

    const parts = path.split(".");
    let current = obj;

    // Navigate to parent of target
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (current[part] === null || current[part] === undefined) {
        current[part] = {};
      }
      current = current[part];
    }

    // Set the final value
    const lastPart = parts[parts.length - 1];
    current[lastPart] = value;

    return obj;
  }

  /**
   * Extract value using regex pattern
   * @private
   * @param {string} value - Value to extract from
   * @param {string} pattern - Regex pattern with capture group
   * @returns {string|null} Extracted value or null
   */
  _extractWithPattern(value, pattern) {
    try {
      const regex = new RegExp(pattern);
      const match = value.match(regex);

      if (match) {
        // Return first capture group if exists, otherwise full match
        return match[1] !== undefined ? match[1] : match[0];
      }

      return null;
    } catch (error) {
      logger.warn("[SESSION_CONFIG] Invalid extraction pattern", {
        pattern,
        error: error.message,
      });
      return null;
    }
  }

  /**
   * Find matching create rule for a request
   * @param {string} method - HTTP method
   * @param {string} endpoint - Endpoint path/URL
   * @returns {Object|null} Matching create rule or null
   */
  findMatchingCreateRule(method, endpoint) {
    const rules = this.getCreateRules();

    for (const rule of rules) {
      if (this.matchesCreateRule(rule, method, endpoint)) {
        return rule;
      }
    }

    return null;
  }

  /**
   * Find matching update rules for a request/response
   * @param {string} method - HTTP method
   * @param {string} endpoint - Endpoint path/URL
   * @returns {Array} Array of matching update rules
   */
  findMatchingUpdateRules(method, endpoint) {
    const rules = this.getUpdateRules();
    return rules.filter((rule) => this.matchesUpdateRule(rule, method, endpoint));
  }

  /**
   * Get cookie names used for session lookup (from update rules with type="cookie")
   * @returns {Array<string>} Array of cookie names
   */
  getCookieSessionNames() {
    return this.getUpdateRulesByType("cookie")
      .map((rule) => rule.key)
      .filter(Boolean);
  }

  /**
   * Refresh configuration from database
   * @returns {Promise<Object|null>} Refreshed config
   */
  async refresh() {
    this.configLoaded = false;
    return await this.loadConfig();
  }

  /**
   * Normalize configuration before saving
   * Converts UI values to internal format:
   * - method="Any" or empty → method=null (null means match any HTTP method)
   * - empty endpoint → null (null means match any endpoint)
   * @param {Object} config - Configuration to normalize
   * @returns {Object} Normalized configuration
   * @private
   */
  _normalizeConfig(config) {
    const normalized = { ...config };

    // Normalize create rules
    if (normalized.create && Array.isArray(normalized.create)) {
      normalized.create = normalized.create.map((rule) => {
        const normalizedRule = { ...rule };

        // Convert method="Any" to method=null
        if (normalizedRule.method === "Any" || normalizedRule.method === "") {
          normalizedRule.method = null;
        }

        // Convert empty endpoint to null
        if (!normalizedRule.endpoint || normalizedRule.endpoint.trim() === "") {
          normalizedRule.endpoint = null;
        }

        return normalizedRule;
      });
    }

    // Normalize update rules
    if (normalized.update && Array.isArray(normalized.update)) {
      normalized.update = normalized.update.map((rule) => {
        const normalizedRule = { ...rule };

        // Convert method="Any" to method=null
        if (normalizedRule.method === "Any" || normalizedRule.method === "") {
          normalizedRule.method = null;
        }

        // Convert empty endpoint to null
        if (!normalizedRule.endpoint || normalizedRule.endpoint.trim() === "") {
          normalizedRule.endpoint = null;
        }

        return normalizedRule;
      });
    }

    return normalized;
  }

  /**
   * Validate configuration structure
   * @param {Object} config - Configuration to validate
   * @returns {Object} { valid: boolean, errors: string[] }
   */
  validateConfig(config) {
    const errors = [];

    // Validate create rules
    if (config.create) {
      if (!Array.isArray(config.create)) {
        errors.push("'create' must be an array");
      } else {
        config.create.forEach((rule, index) => {
          if (!rule.source) {
            errors.push(`create[${index}]: 'source' is required`);
          } else if (!["body", "header", "query"].includes(rule.source.toLowerCase())) {
            errors.push(`create[${index}]: 'source' must be 'body', 'header', or 'query'`);
          }
          if (!rule.key) {
            errors.push(`create[${index}]: 'key' is required`);
          }
          if (rule.endpoint) {
            try {
              new RegExp(rule.endpoint);
            } catch (e) {
              errors.push(`create[${index}]: invalid endpoint regex: ${e.message}`);
            }
          }
          if (rule.pattern) {
            try {
              new RegExp(rule.pattern);
            } catch (e) {
              errors.push(`create[${index}]: invalid pattern regex: ${e.message}`);
            }
          }
        });
      }
    }

    // Validate update rules
    if (config.update) {
      if (!Array.isArray(config.update)) {
        errors.push("'update' must be an array");
      } else {
        config.update.forEach((rule, index) => {
          if (!rule.source) {
            errors.push(`update[${index}]: 'source' is required`);
          } else if (!["cookie", "body", "header"].includes(rule.source.toLowerCase())) {
            errors.push(`update[${index}]: 'source' must be 'cookie', 'body', or 'header'`);
          }
          if (!rule.key) {
            errors.push(`update[${index}]: 'key' is required`);
          }
          if (!rule.type) {
            errors.push(`update[${index}]: 'type' is required`);
          } else if (!["cookie", "auth"].includes(rule.type.toLowerCase())) {
            errors.push(`update[${index}]: 'type' must be 'cookie' or 'auth'`);
          }
          if (rule.endpoint) {
            try {
              new RegExp(rule.endpoint);
            } catch (e) {
              errors.push(`update[${index}]: invalid endpoint regex: ${e.message}`);
            }
          }
          if (rule.pattern) {
            try {
              new RegExp(rule.pattern);
            } catch (e) {
              errors.push(`update[${index}]: invalid pattern regex: ${e.message}`);
            }
          }
        });
      }
    }

    // Validate session settings
    if (config.session) {
      if (typeof config.session !== "object") {
        errors.push("'session' must be an object");
      } else {
        if (config.session.expiry !== undefined) {
          if (typeof config.session.expiry !== "number" || config.session.expiry <= 0) {
            errors.push("'session.expiry' must be a positive number");
          }
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}

// Singleton instance
let instance = null;

/**
 * Get singleton instance
 * @returns {SessionConfigManager}
 */
function getInstance() {
  if (!instance) {
    instance = new SessionConfigManager();
  }
  return instance;
}

/**
 * Initialize and load config
 * @returns {Promise<SessionConfigManager>}
 */
async function initialize() {
  const manager = getInstance();
  await manager.loadConfig();
  return manager;
}

module.exports = {
  SessionConfigManager,
  getInstance,
  initialize,
};
