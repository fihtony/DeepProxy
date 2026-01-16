/**
 * TrafficConfigManager
 *
 * Centralized configuration manager for traffic monitoring settings.
 * Caches configuration from database and provides synchronous access for proxy operations.
 *
 * Configuration types:
 * - traffic: Monitor settings (header/query param pattern matching) and domain list
 * - mapping: Field mapping for app_version, app_platform, app_environment, app_language, correlation_id, traceability_id
 * - endpoint: Endpoint type classification rules (public/secure patterns) and tags
 *
 * Important: No default configurations are stored in code.
 * If config is missing, traffic is not monitored (passthrough mode).
 */

const logger = require("../utils/logger");
const dbConnection = require("../database/connection");
const { getLocalISOString } = require("../utils/datetimeUtils");
const { normalizeLanguage, normalizePlatform, normalizeEnvironment } = require("../utils/header_extractor");

class TrafficConfigManager {
  constructor() {
    // Cached configurations
    this._trafficConfig = null;
    this._mappingConfig = null;
    this._endpointConfig = null;

    // Compiled regex patterns for performance
    this._compiledMonitorPattern = null;
    this._compiledDomainPatterns = null;
    this._compiledEndpointPatterns = null;
    this._compiledTagPatterns = null;

    // Flag to track initialization
    this._initialized = false;
  }

  /**
   * Initialize configuration from database
   * Should be called once during application startup
   */
  async initialize() {
    try {
      logger.info("[TrafficConfigManager] Initializing configuration from database");

      await this._loadTrafficConfig();
      await this._loadMappingConfig();
      await this._loadEndpointConfig();

      this._initialized = true;
      logger.info("[TrafficConfigManager] Configuration initialized successfully", {
        hasTrafficConfig: !!this._trafficConfig,
        hasMappingConfig: !!this._mappingConfig,
        hasEndpointConfig: !!this._endpointConfig,
        monitoringEnabled: this._isMonitoringEnabled(),
      });
    } catch (error) {
      logger.error("[TrafficConfigManager] Failed to initialize configuration", {
        error: error.message,
      });
      // No defaults - traffic will not be monitored
      this._initialized = true;
    }
  }

  /**
   * Check if traffic monitoring is enabled
   * Requires valid traffic config with monitor pattern and at least one domain
   * @private
   */
  _isMonitoringEnabled() {
    const config = this._trafficConfig;
    if (!config) return false;
    if (!config.monitor || !config.monitor.key || !config.monitor.pattern) return false;
    if (!config.domains || config.domains.length === 0) return false;
    return true;
  }

  /**
   * Load traffic config from database
   * @private
   */
  async _loadTrafficConfig() {
    try {
      const database = dbConnection.getDatabase();
      const row = database.prepare("SELECT config FROM config WHERE type = 'traffic'").get();

      if (row && row.config) {
        this._trafficConfig = JSON.parse(row.config);
        logger.debug("[TrafficConfigManager] Traffic config loaded from database");
      } else {
        this._trafficConfig = null;
        logger.debug("[TrafficConfigManager] No traffic config in database - monitoring disabled");
      }

      this._compileMonitorPattern();
      this._compileDomainPatterns();
    } catch (error) {
      logger.error("[TrafficConfigManager] Failed to load traffic config", {
        error: error.message,
      });
      this._trafficConfig = null;
      this._compiledMonitorPattern = null;
      this._compiledDomainPatterns = null;
    }
  }

  /**
   * Load mapping config from database
   * @private
   */
  async _loadMappingConfig() {
    try {
      const database = dbConnection.getDatabase();
      const row = database.prepare("SELECT config FROM config WHERE type = 'mapping'").get();

      if (row && row.config) {
        this._mappingConfig = JSON.parse(row.config);
        logger.debug("[TrafficConfigManager] Mapping config loaded from database");
      } else {
        this._mappingConfig = null;
        logger.debug("[TrafficConfigManager] No mapping config in database");
      }
    } catch (error) {
      logger.error("[TrafficConfigManager] Failed to load mapping config", {
        error: error.message,
      });
      this._mappingConfig = null;
    }
  }

  /**
   * Load endpoint config from database
   * @private
   */
  async _loadEndpointConfig() {
    try {
      const database = dbConnection.getDatabase();
      const row = database.prepare("SELECT config FROM config WHERE type = 'endpoint'").get();

      if (row && row.config) {
        this._endpointConfig = JSON.parse(row.config);
        logger.debug("[TrafficConfigManager] Endpoint config loaded from database");
      } else {
        this._endpointConfig = null;
        logger.debug("[TrafficConfigManager] No endpoint config in database");
      }

      this._compileEndpointPatterns();
      this._compileTagPatterns();
    } catch (error) {
      logger.error("[TrafficConfigManager] Failed to load endpoint config", {
        error: error.message,
      });
      this._endpointConfig = null;
      this._compiledEndpointPatterns = null;
      this._compiledTagPatterns = null;
    }
  }

  /**
   * Compile monitor pattern for efficient matching
   * @private
   */
  _compileMonitorPattern() {
    try {
      const pattern = this._trafficConfig?.monitor?.pattern;
      if (pattern) {
        this._compiledMonitorPattern = new RegExp(pattern, "i");
      } else {
        this._compiledMonitorPattern = null;
      }
    } catch (error) {
      logger.error("[TrafficConfigManager] Invalid monitor pattern", {
        pattern: this._trafficConfig?.monitor?.pattern,
        error: error.message,
      });
      this._compiledMonitorPattern = null;
    }
  }

  /**
   * Compile domain patterns for efficient matching (supports regex)
   * @private
   */
  _compileDomainPatterns() {
    this._compiledDomainPatterns = [];
    const domains = this._trafficConfig?.domains || [];

    for (const domainConfig of domains) {
      try {
        if (domainConfig.domain) {
          this._compiledDomainPatterns.push({
            pattern: new RegExp(domainConfig.domain, "i"),
            secure: domainConfig.secure === true,
            original: domainConfig.domain,
          });
        }
      } catch (error) {
        logger.error("[TrafficConfigManager] Invalid domain pattern", {
          domain: domainConfig.domain,
          error: error.message,
        });
      }
    }
  }

  /**
   * Compile endpoint type patterns for efficient matching
   * @private
   */
  _compileEndpointPatterns() {
    this._compiledEndpointPatterns = [];
    const types = this._endpointConfig?.types || [];

    // Sort by priority (lower value = higher priority)
    const sortedTypes = [...types].sort((a, b) => (a.priority || 0) - (b.priority || 0));

    for (const type of sortedTypes) {
      const compiledPatterns = [];
      if (type.patterns && Array.isArray(type.patterns)) {
        for (const pattern of type.patterns) {
          try {
            compiledPatterns.push(new RegExp(pattern, "i"));
          } catch (error) {
            logger.error("[TrafficConfigManager] Invalid endpoint pattern", {
              typeName: type.name,
              pattern,
              error: error.message,
            });
          }
        }
      }
      if (compiledPatterns.length > 0) {
        this._compiledEndpointPatterns.push({
          name: type.name,
          patterns: compiledPatterns,
          priority: type.priority || 0,
        });
      }
    }
  }

  /**
   * Compile tag patterns for efficient matching
   * @private
   */
  _compileTagPatterns() {
    this._compiledTagPatterns = [];
    const tags = this._endpointConfig?.tags || [];

    for (const tag of tags) {
      try {
        if (tag.pattern) {
          this._compiledTagPatterns.push({
            name: tag.name,
            pattern: new RegExp(tag.pattern, "i"),
            color: tag.color || "",
          });
        }
      } catch (error) {
        logger.error("[TrafficConfigManager] Invalid tag pattern", {
          tagName: tag.name,
          pattern: tag.pattern,
          error: error.message,
        });
      }
    }
  }

  /**
   * Compile all patterns
   * @private
   */
  _compilePatterns() {
    this._compileMonitorPattern();
    this._compileDomainPatterns();
    this._compileEndpointPatterns();
    this._compileTagPatterns();
  }

  // ============================================================================
  // Traffic Config Methods
  // ============================================================================

  /**
   * Get traffic configuration
   * @returns {Object|null} Traffic configuration or null if not configured
   */
  getTrafficConfig() {
    return this._trafficConfig;
  }

  /**
   * Check if monitoring is enabled (has valid config)
   * @returns {boolean} True if traffic monitoring is enabled
   */
  isMonitoringEnabled() {
    return this._isMonitoringEnabled();
  }

  /**
   * Check if a request should be monitored based on configured criteria
   * Returns false if traffic config is missing or incomplete
   * @param {Object} headers - Request headers (case-insensitive)
   * @param {Object} queryParams - Query parameters
   * @returns {boolean} True if request matches monitor criteria
   */
  isMonitoredRequest(headers, queryParams = {}) {
    // If monitoring is not enabled, return false (passthrough mode)
    if (!this._isMonitoringEnabled()) {
      return false;
    }

    const monitor = this._trafficConfig.monitor;

    // Get the value to check based on 'source' setting
    let valueToCheck = "";
    if (monitor.source === "header") {
      // Headers are case-insensitive, try both lowercase and original
      const headerKey = monitor.key.toLowerCase();
      valueToCheck = headers?.[headerKey] || headers?.[monitor.key] || "";
    } else if (monitor.source === "query") {
      valueToCheck = queryParams?.[monitor.key] || "";
    }

    // Must have a value to match
    if (!valueToCheck) {
      return false;
    }

    // Must have compiled pattern
    if (!this._compiledMonitorPattern) {
      return false;
    }

    // Match against pattern
    return this._compiledMonitorPattern.test(valueToCheck);
  }

  /**
   * Get monitored domains
   * @returns {Array} Array of domain objects { domain, secure } or empty array
   */
  getMonitoredDomains() {
    return this._trafficConfig?.domains || [];
  }

  /**
   * Get domain names only
   * @returns {Array} Array of domain pattern strings
   */
  getDomainNames() {
    const domains = this.getMonitoredDomains();
    return domains.map((d) => d.domain);
  }

  /**
   * Check if a domain is monitored (matches any domain pattern)
   * @param {string} domain - Domain name to check
   * @returns {boolean} True if domain matches any monitored pattern
   */
  isMonitoredDomain(domain) {
    if (!domain) return false;
    if (!this._compiledDomainPatterns || this._compiledDomainPatterns.length === 0) {
      return false;
    }

    const lowerDomain = domain.toLowerCase();
    return this._compiledDomainPatterns.some((dp) => dp.pattern.test(lowerDomain));
  }

  /**
   * Check if a domain requires HTTPS
   * @param {string} domain - Domain name to check
   * @returns {boolean} True if domain is configured as secure (HTTPS)
   */
  isSecureDomain(domain) {
    if (!domain) return false;
    if (!this._compiledDomainPatterns || this._compiledDomainPatterns.length === 0) {
      return false;
    }

    const lowerDomain = domain.toLowerCase();
    for (const dp of this._compiledDomainPatterns) {
      if (dp.pattern.test(lowerDomain)) {
        return dp.secure;
      }
    }
    return false;
  }

  /**
   * Update traffic configuration
   * @param {Object} config - New traffic configuration
   */
  async updateTrafficConfig(config) {
    try {
      const database = dbConnection.getDatabase();

      // Upsert the config
      const existing = database.prepare("SELECT id FROM config WHERE type = 'traffic'").get();
      const configJson = JSON.stringify(config);

      if (existing) {
        database.prepare("UPDATE config SET config = ?, updated_at = ? WHERE type = 'traffic'").run(configJson, getLocalISOString());
      } else {
        database
          .prepare("INSERT INTO config (type, config, created_at, updated_at) VALUES ('traffic', ?, ?, ?)")
          .run(configJson, getLocalISOString(), getLocalISOString());
      }

      // Update cache
      this._trafficConfig = config;
      this._compileMonitorPattern();
      this._compileDomainPatterns();

      logger.info("[TrafficConfigManager] Traffic config updated", {
        monitoringEnabled: this._isMonitoringEnabled(),
      });
    } catch (error) {
      logger.error("[TrafficConfigManager] Failed to update traffic config", {
        error: error.message,
      });
      throw error;
    }
  }

  // ============================================================================
  // Mapping Config Methods
  // ============================================================================

  /**
   * Get mapping configuration
   * @returns {Object|null} Mapping configuration or null if not configured
   */
  getMappingConfig() {
    return this._mappingConfig;
  }

  /**
   * Extract a mapped value from request
   * @param {string} fieldName - Field name (e.g., 'app_version', 'app_platform')
   * @param {Object} headers - Request headers
   * @param {Object} queryParams - Query parameters
   * @returns {string} Extracted value or empty string if not found
   */
  extractMappedValue(fieldName, headers, queryParams = {}) {
    const mapping = this._mappingConfig?.[fieldName];
    if (!mapping || !mapping.key) {
      return "";
    }

    let value = "";
    if (mapping.source === "header") {
      // Headers are case-insensitive
      const headerKey = mapping.key.toLowerCase();
      value = headers?.[headerKey] || headers?.[mapping.key] || "";
    } else if (mapping.source === "query") {
      value = queryParams?.[mapping.key] || "";
    }

    // If pattern is specified, extract matching group
    if (mapping.pattern && value) {
      try {
        const regex = new RegExp(mapping.pattern, "i");
        const match = value.match(regex);
        if (match && match[1]) {
          return match[1];
        }
      } catch (error) {
        // Pattern error, return value as-is
      }
    }

    // Return value or empty string (never null)
    return value || "";
  }

  /**
   * Extract all mapped values from request
   * @param {Object} headers - Request headers
   * @param {Object} queryParams - Query parameters
   * @returns {Object} Object with all mapped values
   */
  extractAllMappedValues(headers, queryParams = {}) {
    return {
      app_version: this.extractMappedValue("app_version", headers, queryParams),
      app_platform: normalizePlatform(this.extractMappedValue("app_platform", headers, queryParams)),
      app_environment: normalizeEnvironment(this.extractMappedValue("app_environment", headers, queryParams)),
      app_language: normalizeLanguage(this.extractMappedValue("app_language", headers, queryParams)),
      correlation_id: this.extractMappedValue("correlation_id", headers, queryParams),
      traceability_id: this.extractMappedValue("traceability_id", headers, queryParams),
    };
  }

  /**
   * Update mapping configuration
   * @param {Object} config - New mapping configuration
   */
  async updateMappingConfig(config) {
    try {
      const database = dbConnection.getDatabase();

      // Upsert the config
      const existing = database.prepare("SELECT id FROM config WHERE type = 'mapping'").get();
      const configJson = JSON.stringify(config);

      if (existing) {
        database.prepare("UPDATE config SET config = ?, updated_at = ? WHERE type = 'mapping'").run(configJson, getLocalISOString());
      } else {
        database
          .prepare("INSERT INTO config (type, config, created_at, updated_at) VALUES ('mapping', ?, ?, ?)")
          .run(configJson, getLocalISOString(), getLocalISOString());
      }

      // Update cache
      this._mappingConfig = config;

      logger.info("[TrafficConfigManager] Mapping config updated");
    } catch (error) {
      logger.error("[TrafficConfigManager] Failed to update mapping config", {
        error: error.message,
      });
      throw error;
    }
  }

  // ============================================================================
  // Endpoint Config Methods
  // ============================================================================

  /**
   * Get endpoint configuration
   * @returns {Object|null} Endpoint configuration or null if not configured
   */
  getEndpointConfig() {
    return this._endpointConfig;
  }

  /**
   * Determine endpoint type based on path
   * Returns fallback type if no pattern matches or config is missing
   * @param {string} path - Request path
   * @returns {string} Endpoint type name (defaults to 'public' if no config)
   */
  getEndpointType(path) {
    if (!path) {
      return this._endpointConfig?.fallback || "public";
    }

    // Check against compiled patterns (already sorted by priority)
    if (this._compiledEndpointPatterns && this._compiledEndpointPatterns.length > 0) {
      for (const typeConfig of this._compiledEndpointPatterns) {
        for (const pattern of typeConfig.patterns) {
          if (pattern.test(path)) {
            return typeConfig.name;
          }
        }
      }
    }

    // Return fallback (defaults to 'public' if not configured)
    return this._endpointConfig?.fallback || "public";
  }

  /**
   * Check if endpoint is secure
   * @param {string} path - Request path
   * @returns {boolean} True if endpoint type is 'secure'
   */
  isSecureEndpoint(path) {
    return this.getEndpointType(path) === "secure";
  }

  /**
   * Check if endpoint is public
   * @param {string} path - Request path
   * @returns {boolean} True if endpoint type is 'public'
   */
  isPublicEndpoint(path) {
    return this.getEndpointType(path) === "public";
  }

  /**
   * Get tags for an endpoint
   * @param {string} path - Request path
   * @returns {Array} Array of matching tag objects { name, color }
   */
  getEndpointTags(path) {
    if (!path) return [];
    if (!this._compiledTagPatterns || this._compiledTagPatterns.length === 0) {
      return [];
    }

    const matchingTags = [];
    for (const tagConfig of this._compiledTagPatterns) {
      if (tagConfig.pattern.test(path)) {
        matchingTags.push({
          name: tagConfig.name,
          color: tagConfig.color,
        });
      }
    }

    return matchingTags;
  }

  /**
   * Update endpoint configuration
   * @param {Object} config - New endpoint configuration
   */
  async updateEndpointConfig(config) {
    try {
      const database = dbConnection.getDatabase();

      // Upsert the config
      const existing = database.prepare("SELECT id FROM config WHERE type = 'endpoint'").get();
      const configJson = JSON.stringify(config);

      if (existing) {
        database.prepare("UPDATE config SET config = ?, updated_at = ? WHERE type = 'endpoint'").run(configJson, getLocalISOString());
      } else {
        database
          .prepare("INSERT INTO config (type, config, created_at, updated_at) VALUES ('endpoint', ?, ?, ?)")
          .run(configJson, getLocalISOString(), getLocalISOString());
      }

      // Update cache
      this._endpointConfig = config;
      this._compileEndpointPatterns();
      this._compileTagPatterns();

      logger.info("[TrafficConfigManager] Endpoint config updated");
    } catch (error) {
      logger.error("[TrafficConfigManager] Failed to update endpoint config", {
        error: error.message,
      });
      throw error;
    }
  }

  // ============================================================================
  // Refresh Methods
  // ============================================================================

  /**
   * Refresh all configurations from database
   * Called when UI updates config or reads config
   */
  async refreshAll() {
    await this._loadTrafficConfig();
    await this._loadMappingConfig();
    await this._loadEndpointConfig();
    logger.info("[TrafficConfigManager] All configurations refreshed from database");
  }

  /**
   * Check if manager is initialized
   * @returns {boolean}
   */
  isInitialized() {
    return this._initialized;
  }

  /**
   * Validate a regex pattern
   * @param {string} pattern - Pattern to validate
   * @returns {boolean} True if pattern is valid
   */
  validatePattern(pattern) {
    if (!pattern) return true;
    try {
      new RegExp(pattern);
      return true;
    } catch {
      return false;
    }
  }
}

// Singleton instance
let instance = null;

/**
 * Get singleton instance of TrafficConfigManager
 * @returns {TrafficConfigManager}
 */
function getInstance() {
  if (!instance) {
    instance = new TrafficConfigManager();
  }
  return instance;
}

/**
 * Initialize the singleton instance
 * Should be called once during application startup after database is ready
 */
async function initializeInstance() {
  const manager = getInstance();
  if (!manager.isInitialized()) {
    await manager.initialize();
  }
  return manager;
}

module.exports = {
  TrafficConfigManager,
  getInstance,
  initializeInstance,
};
