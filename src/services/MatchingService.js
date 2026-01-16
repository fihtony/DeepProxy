/**
 * MatchingService.js
 *
 * Service layer for managing endpoint matching and configuration.
 * Provides business logic for:
 * - Endpoint matching configuration
 * - Matching rule management
 * - Matching execution and testing
 */

const EndpointConfigRepository = require("../database/repositories/EndpointConfigRepository");
const MatchingEngine = require("../core/matching/MatchingEngine");
const ApiRequestRepository = require("../database/repositories/ApiRequestRepository");
const ApiResponseRepository = require("../database/repositories/ApiResponseRepository");
const logger = require("../utils/logger");

class MatchingService {
  constructor(db) {
    if (!db) {
      throw new Error("MatchingService requires a database connection");
    }
    this.configRepo = new EndpointConfigRepository(db);
    this.requestRepo = new ApiRequestRepository(db);

    // Initialize MatchingEngine with proper repositories structure
    const repositories = {
      apiRequestRepo: this.requestRepo,
      apiResponseRepo: new ApiResponseRepository(db),
      endpointConfigRepo: this.configRepo,
    };
    this.matchingEngine = new MatchingEngine(repositories);
  }

  /**
   * Create a new endpoint matching configuration
   * @param {Object} configData Configuration data
   * @returns {Promise<Object>} Created configuration record
   */
  async createConfig(configData) {
    try {
      logger.debug("Creating endpoint matching config", {
        method: configData.method,
        path_pattern: configData.path_pattern,
      });

      // Validate required fields
      this._validateConfigData(configData);

      const record = {
        method: configData.method,
        path_pattern: configData.path_pattern,
        match_user_id: configData.match_user_id !== false, // default true
        match_app_version: configData.match_app_version !== false,
        match_app_language: configData.match_app_language !== false,
        match_app_platform: configData.match_app_platform !== false,
        match_app_environment: configData.match_app_environment !== false,
        match_headers: configData.match_headers || null,
        match_body_fields: configData.match_body_fields || null,
        is_enabled: configData.is_enabled !== false, // default true
      };

      const created = await this.configRepo.create(record);
      logger.info("Endpoint matching config created", { config_id: created.id });

      return created;
    } catch (error) {
      logger.error("Failed to create matching config", { error: error.message });
      throw error;
    }
  }

  /**
   * Get configuration by ID
   * @param {number} configId Configuration ID
   * @returns {Promise<Object|null>} Configuration record or null
   */
  async getConfigById(configId) {
    try {
      return await this.configRepo.findById(configId);
    } catch (error) {
      logger.error("Failed to get config by ID", { configId, error: error.message });
      throw error;
    }
  }

  /**
   * Get all configurations
   * @param {Object} filters Optional filters
   * @returns {Promise<Array>} List of configurations
   */
  async getAllConfigs(filters = {}) {
    try {
      const where = {};

      if (filters.is_enabled !== undefined) {
        where.is_enabled = filters.is_enabled ? 1 : 0;
      }
      if (filters.method) {
        where.method = filters.method;
      }

      return await this.configRepo.findAll({ where });
    } catch (error) {
      logger.error("Failed to get all configs", { error: error.message });
      throw error;
    }
  }

  /**
   * Find matching configuration for a request
   * @param {string} method HTTP method
   * @param {string} path Request path
   * @param {string} type Optional type filter ('replay' or 'recording')
   * @returns {Promise<Object|null>} Matching configuration or null
   */
  async findMatchingConfig(method, path, type = null) {
    try {
      return await this.configRepo.findMatchingConfig(method, path, type);
    } catch (error) {
      logger.error("Failed to find matching config", { method, path, type, error: error.message });
      throw error;
    }
  }

  /**
   * Update configuration
   * @param {number} configId Configuration ID
   * @param {Object} updates Update data
   * @returns {Promise<Object>} Updated configuration record
   */
  async updateConfig(configId, updates) {
    try {
      logger.debug("Updating matching config", { configId });

      const allowedFields = [
        "method",
        "path_pattern",
        "match_user_id",
        "match_app_version",
        "match_app_language",
        "match_app_platform",
        "match_app_environment",
        "match_headers",
        "match_body_fields",
        "is_enabled",
      ];

      const updateData = {};
      for (const [key, value] of Object.entries(updates)) {
        if (allowedFields.includes(key)) {
          updateData[key] = value;
        }
      }

      if (Object.keys(updateData).length === 0) {
        throw new Error("No valid fields to update");
      }

      const updated = await this.configRepo.update(configId, updateData);
      logger.info("Matching config updated", { configId });

      return updated;
    } catch (error) {
      logger.error("Failed to update matching config", { configId, error: error.message });
      throw error;
    }
  }

  /**
   * Delete configuration
   * @param {number} configId Configuration ID
   * @returns {Promise<boolean>} True if deleted
   */
  async deleteConfig(configId) {
    try {
      const deleted = await this.configRepo.delete(configId);
      logger.info("Matching config deleted", { configId });
      return deleted;
    } catch (error) {
      logger.error("Failed to delete matching config", { configId, error: error.message });
      throw error;
    }
  }

  /**
   * Enable a configuration
   * @param {number} configId Configuration ID
   * @returns {Promise<Object>} Updated configuration
   */
  async enableConfig(configId) {
    try {
      return await this.configRepo.enable(configId);
    } catch (error) {
      logger.error("Failed to enable config", { configId, error: error.message });
      throw error;
    }
  }

  /**
   * Disable a configuration
   * @param {number} configId Configuration ID
   * @returns {Promise<Object>} Updated configuration
   */
  async disableConfig(configId) {
    try {
      return await this.configRepo.disable(configId);
    } catch (error) {
      logger.error("Failed to disable config", { configId, error: error.message });
      throw error;
    }
  }

  /**
   * Find best matching request for incoming request
   * @param {Object} requestData Incoming request data
   * @returns {Promise<Object>} Match result { match: Object, score: number, config: Object }
   */
  async findBestMatch(requestData) {
    try {
      logger.debug("Finding best match for request", {
        method: requestData.method,
        path: requestData.path,
      });

      // Find matching configuration
      const config = await this.findMatchingConfig(requestData.method, requestData.path);
      if (!config || !config.is_enabled) {
        logger.debug("No matching config found or config disabled");
        return { match: null, score: 0, config: null };
      }

      // Use matching engine to find best match
      // Note: findMatch expects requestContext not requestData, and mode as second parameter
      // This method signature appears incorrect - storing config but matching engine doesn't use it
      const match = await this.matchingEngine.findMatch(requestData);

      if (match) {
        logger.info("Found matching request", {
          matchId: match.id,
          score: match._matchScore,
        });

        return {
          match,
          score: match._matchScore,
          config,
        };
      }

      logger.debug("No matching request found");
      return { match: null, score: 0, config };
    } catch (error) {
      logger.error("Failed to find best match", { error: error.message });
      throw error;
    }
  }

  /**
   * Find all matching requests
   * @param {Object} requestData Incoming request data
   * @param {number} limit Maximum number of matches to return
   * @returns {Promise<Array>} List of matching requests with scores
   */
  async findAllMatches(requestData, limit = 10) {
    try {
      logger.debug("Finding all matches for request", {
        method: requestData.method,
        path: requestData.path,
        limit,
      });

      // Find matching configuration
      const config = await this.findMatchingConfig(requestData.method, requestData.path);
      if (!config || !config.is_enabled) {
        logger.debug("No matching config found or config disabled");
        return [];
      }

      // Use matching engine to find all matches
      const matches = await this.matchingEngine.findAllMatches(requestData, config, limit);

      logger.info("Found matching requests", { count: matches.length });
      return matches;
    } catch (error) {
      logger.error("Failed to find all matches", { error: error.message });
      throw error;
    }
  }

  /**
   * Test if a request has any matches
   * @param {Object} requestData Incoming request data
   * @returns {Promise<boolean>} True if has matches
   */
  async hasMatch(requestData) {
    try {
      const config = await this.findMatchingConfig(requestData.method, requestData.path);
      if (!config || !config.is_enabled) {
        return false;
      }

      return await this.matchingEngine.hasMatch(requestData, config);
    } catch (error) {
      logger.error("Failed to check if has match", { error: error.message });
      throw error;
    }
  }

  /**
   * Get matching statistics
   * @param {Object} requestData Incoming request data
   * @returns {Promise<Object>} Matching statistics
   */
  async getMatchingStats(requestData) {
    try {
      const config = await this.findMatchingConfig(requestData.method, requestData.path);
      if (!config || !config.is_enabled) {
        return {
          hasConfig: false,
          totalMatches: 0,
          bestScore: 0,
        };
      }

      const stats = await this.matchingEngine.getMatchStats(requestData, config);

      return {
        hasConfig: true,
        config,
        ...stats,
      };
    } catch (error) {
      logger.error("Failed to get matching stats", { error: error.message });
      throw error;
    }
  }

  /**
   * Bulk create configurations
   * @param {Array} configsData Array of configuration data
   * @returns {Promise<Array>} Created configurations
   */
  async bulkCreateConfigs(configsData) {
    try {
      logger.debug("Bulk creating matching configs", { count: configsData.length });

      // Validate all configs first
      for (const configData of configsData) {
        this._validateConfigData(configData);
      }

      const created = await this.configRepo.bulkCreate(configsData);
      logger.info("Bulk created matching configs", { count: created.length });

      return created;
    } catch (error) {
      logger.error("Failed to bulk create configs", { error: error.message });
      throw error;
    }
  }

  /**
   * Validate configuration data
   * @param {Object} configData Configuration data to validate
   * @throws {Error} If validation fails
   * @private
   */
  _validateConfigData(configData) {
    if (!configData.method) {
      throw new Error("Configuration method is required");
    }
    if (!configData.path_pattern) {
      throw new Error("Configuration path_pattern is required");
    }

    const validMethods = ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS", "*"];
    if (!validMethods.includes(configData.method)) {
      throw new Error(`Invalid HTTP method: ${configData.method}`);
    }

    // Validate path_pattern is a valid regex
    try {
      new RegExp(configData.path_pattern);
    } catch (e) {
      throw new Error(`Invalid path_pattern regex: ${configData.path_pattern}`);
    }
  }

  /**
   * Get service statistics
   * @returns {Promise<Object>} Service statistics
   */
  async getServiceStats() {
    try {
      const totalConfigs = await this.configRepo.count();
      const enabledConfigs = await this.configRepo.count({ is_enabled: 1 });
      const disabledConfigs = totalConfigs - enabledConfigs;

      // Get configs by method
      const allConfigs = await this.getAllConfigs();
      const byMethod = {};
      for (const config of allConfigs) {
        byMethod[config.method] = (byMethod[config.method] || 0) + 1;
      }

      return {
        totalConfigs,
        enabledConfigs,
        disabledConfigs,
        byMethod,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      logger.error("Failed to get service stats", { error: error.message });
      throw error;
    }
  }
}

module.exports = MatchingService;
