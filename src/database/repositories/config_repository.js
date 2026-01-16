/**
 * Config Repository
 *
 * Manages application configuration stored in the database config table.
 * New structure: type column indicates config type ('master' for proxy mode/timeWindow, 'log' for logging)
 * config column stores JSON data
 */

const db = require("../connection");
const logger = require("../../utils/logger");
const { getLocalISOString } = require("../../utils/datetimeUtils");

class ConfigRepository {
  /**
   * Get master config (type='master') - contains proxy mode and timeWindow
   * @returns {Object|null} Master config object with mode and timeWindow, or null if not found
   */
  async getMasterConfig() {
    try {
      const database = db.getDatabase();
      const row = database.prepare("SELECT * FROM config WHERE type = 'master'").get();

      if (!row) {
        logger.warn("Master config row not found in database, using defaults");
        return null;
      }

      // Parse JSON config field
      return {
        id: row.id,
        type: row.type,
        mode: JSON.parse(row.config).mode || "passthrough",
        timeWindow: JSON.parse(row.config).timeWindow || "3d",
        created_at: row.created_at,
        updated_at: row.updated_at,
      };
    } catch (error) {
      logger.error("Failed to get master config from database", { error: error.message });
      throw error;
    }
  }

  /**
   * Get logging config (type='log') - contains logging configuration
   * @returns {Object|null} Logging config object, or null if not found
   */
  async getLoggingConfigRow() {
    try {
      const database = db.getDatabase();
      const row = database.prepare("SELECT * FROM config WHERE type = 'log'").get();

      if (!row) {
        logger.warn("Logging config row not found in database, using defaults");
        return null;
      }

      // Parse JSON config field
      return {
        id: row.id,
        type: row.type,
        config: JSON.parse(row.config),
        created_at: row.created_at,
        updated_at: row.updated_at,
      };
    } catch (error) {
      logger.error("Failed to get logging config from database", { error: error.message });
      throw error;
    }
  }

  /**
   * Get the complete config (master + logging) for backward compatibility
   * @returns {Object|null} Config object with proxy, logging, admin fields, or null if not found
   */
  async getConfig() {
    try {
      const masterConfig = await this.getMasterConfig();
      const loggingConfig = await this.getLoggingConfigRow();

      if (!masterConfig) {
        logger.warn("Config not found in database, using defaults");
        return null;
      }

      // Reconstruct the old format for backward compatibility
      return {
        id: masterConfig.id,
        proxy: {
          mode: masterConfig.mode,
          timeWindow: masterConfig.timeWindow,
        },
        logging: loggingConfig?.config || {
          proxy: { overall: "INFO" },
          db: { overall: "INFO" },
          traffic_logging: { overall: true, body: true, header: true },
        },
      };
    } catch (error) {
      logger.error("Failed to get config from database", { error: error.message });
      throw error;
    }
  }

  /**
   * Get proxy mode from master config
   * @returns {string|null} Proxy mode ('passthrough', 'recording', or 'replay'), or null if not found
   */
  async getProxyMode() {
    try {
      const masterConfig = await this.getMasterConfig();
      return masterConfig?.mode || null;
    } catch (error) {
      logger.error("Failed to get proxy mode from database", { error: error.message });
      return null;
    }
  }

  /**
   * Update proxy mode in master config
   * @param {string} mode - Proxy mode ('passthrough', 'recording', or 'replay')
   * @returns {boolean} Success status
   */
  async updateProxyMode(mode) {
    try {
      const database = db.getDatabase();
      const masterConfig = await this.getMasterConfig();

      if (!masterConfig) {
        // Config doesn't exist, create it with the new mode
        const configData = JSON.stringify({ mode, timeWindow: "3d" });

        database
          .prepare(
            `INSERT INTO config (type, config, created_at, updated_at) 
           VALUES ('master', ?, ?, ?)`
          )
          .run(configData, getLocalISOString(), getLocalISOString());

        // Also create log config if it doesn't exist
        try {
          const loggingConfig = await this.getLoggingConfigRow();
          if (!loggingConfig) {
            const defaultLogConfig = JSON.stringify({
              proxy: { overall: "INFO" },
              db: { overall: "INFO" },
              traffic_logging: { overall: true, body: true, header: true },
            });
            database
              .prepare(
                `INSERT INTO config (type, config, created_at, updated_at) 
               VALUES ('log', ?, ?, ?)`
              )
              .run(defaultLogConfig, getLocalISOString(), getLocalISOString());
          }
        } catch (err) {
          logger.warn("Could not create default log config", { error: err.message });
        }
      } else {
        // Update existing master config, preserve timeWindow if it exists
        const configData = JSON.stringify({
          mode,
          timeWindow: masterConfig.timeWindow || "3d",
        });
        database
          .prepare(
            `UPDATE config 
           SET config = ?, updated_at = ? 
           WHERE type = 'master'`
          )
          .run(configData, getLocalISOString());
      }

      logger.info("Proxy mode updated in database", { mode });
      return true;
    } catch (error) {
      logger.error("Failed to update proxy mode in database", { error: error.message, mode });
      throw error;
    }
  }

  /**
   * Get logging configuration from log config
   * @returns {Object|null} Logging config object, or null if not found
   */
  async getLoggingConfig() {
    try {
      const loggingConfigRow = await this.getLoggingConfigRow();
      return loggingConfigRow?.config || null;
    } catch (error) {
      logger.error("Failed to get logging config from database", { error: error.message });
      return null;
    }
  }

  /**
   * Get traffic logging configuration from log config
   * @returns {Object|null} Traffic logging config object, or null if not found
   */
  async getTrafficLoggingConfig() {
    try {
      const loggingConfig = await this.getLoggingConfig();
      return loggingConfig?.traffic_logging || null;
    } catch (error) {
      logger.error("Failed to get traffic logging config from database", { error: error.message });
      return null;
    }
  }

  /**
   * Update traffic logging configuration in log config
   * @param {Object} trafficLogConfig - Traffic logging config object
   * @returns {boolean} Success status
   */
  async updateTrafficLoggingConfig(trafficLogConfig) {
    try {
      const database = db.getDatabase();
      const loggingConfigRow = await this.getLoggingConfigRow();

      if (!loggingConfigRow) {
        throw new Error("Logging config row does not exist. Please run db:init first.");
      }

      // Update log config with new traffic_logging settings
      const updatedLogging = {
        ...loggingConfigRow.config,
        traffic_logging: trafficLogConfig,
      };

      database
        .prepare(
          `UPDATE config 
         SET config = ?, updated_at = ? 
         WHERE type = 'log'`
        )
        .run(JSON.stringify(updatedLogging), getLocalISOString());

      logger.info("Traffic logging config updated in database", { trafficLogConfig });
      return true;
    } catch (error) {
      logger.error("Failed to update traffic logging config in database", {
        error: error.message,
        trafficLogConfig,
      });
      throw error;
    }
  }

  /**
   * Get timeline filter from master config
   * @returns {string|null} Timeline filter value, or null if not set
   */
  async getTimelineFilter() {
    try {
      const masterConfig = await this.getMasterConfig();
      return masterConfig?.timeWindow || null;
    } catch (error) {
      logger.error("Failed to get timeline filter from database", { error: error.message });
      return null;
    }
  }

  /**
   * Update timeline filter in master config
   * @param {string} timeWindow - Timeline filter value (e.g., '7d', '30d', 'all')
   * @returns {boolean} Success status
   */
  async updateTimelineFilter(timeWindow) {
    try {
      const database = db.getDatabase();
      const masterConfig = await this.getMasterConfig();

      if (!masterConfig) {
        throw new Error("Master config row does not exist. Please run db:init first.");
      }

      // Update master config with new timeWindow, preserving mode
      const updatedMaster = {
        mode: masterConfig.mode,
        timeWindow,
      };

      database
        .prepare(
          `UPDATE config 
         SET config = ?, updated_at = ? 
         WHERE type = 'master'`
        )
        .run(JSON.stringify(updatedMaster), getLocalISOString());

      logger.info("Timeline filter updated in database", { timeWindow });
      return true;
    } catch (error) {
      logger.error("Failed to update timeline filter in database", { error: error.message, timeWindow });
      throw error;
    }
  }
}

module.exports = new ConfigRepository();
