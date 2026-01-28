/**
 * EndpointConfigRepository - Repository for endpoint_matching_config table
 *
 * Purpose:
 * - Manage endpoint matching configurations
 * - Support priority-based matching
 * - Enable/disable matching rules
 * - Provide rule lookup by pattern
 */

const BaseRepository = require("./BaseRepository");
const { getLocalISOString } = require("../../utils/datetimeUtils");

class EndpointConfigRepository extends BaseRepository {
  constructor(db) {
    super(db, "endpoint_matching_config");
  }

  /**
   * Create endpoint configuration
   * @param {Object} configData - Configuration data
   * @returns {Promise<number>} Created config ID
   */
  async createConfig(configData) {
    const data = {
      endpoint_pattern: configData.endpointPattern,
      http_method: configData.httpMethod || "*",
      match_version: configData.matchVersion ? 1 : 0,
      match_language: configData.matchLanguage ? 1 : 0,
      match_platform: configData.matchPlatform ? 1 : 0,
      match_environment: configData.matchEnvironment ? 1 : 0,
      match_headers: configData.matchHeaders ? JSON.stringify(configData.matchHeaders) : null,
      match_body_fields: configData.matchBodyFields ? JSON.stringify(configData.matchBodyFields) : null,
      priority: configData.priority || 0,
      enabled: configData.enabled !== false ? 1 : 0,
      description: configData.description || null,
    };

    return await this.create(data);
  }

  /**
   * Find configuration by endpoint pattern and method
   * @param {string} pattern - Endpoint pattern
   * @param {string} method - HTTP method
   * @returns {Promise<Object|null>} Configuration or null
   */
  async findByPatternAndMethod(pattern, method) {
    return await this.findOne({
      endpoint_pattern: pattern,
      http_method: method,
    });
  }

  /**
   * Find all enabled configurations
   * @param {string} type - Optional type filter ('replay' or 'recording')
   * @returns {Promise<Array>} Array of enabled configurations
   */
  async findAllEnabled(type = null) {
    const conditions = { enabled: 1 };
    if (type) {
      conditions.type = type;
    }
    return await this.findBy(conditions, {
      orderBy: "priority",
      orderDir: "ASC", // Lower priority value = higher priority (matched first)
    });
  }

  /**
   * Find matching configuration for request
   * Supports both exact matching and fuzzy matching with endpoint patterns
   * @param {string} method - HTTP method
   * @param {string} path - Request path
   * @param {string} type - Optional type filter ('replay' or 'recording')
   * @param {Object} options - Optional matching options
   *   - endpointPatterns: Array of global endpoint patterns for fuzzy matching
   *   - fuzzyPatterns: Pre-computed fuzzy patterns from global rules
   * @returns {Promise<Object|null>} Matching configuration or null
   */
  async findMatchingConfig(method, path, type = null, options = null) {
    const logger = require("../../utils/logger");

    // Get all enabled configs ordered by priority
    const configs = await this.findAllEnabled(type);

    // Try exact method match first, then wildcard
    for (const config of configs) {
      if (config.http_method === method || config.http_method === "*") {
        // Try exact pattern match first
        if (this._matchesPattern(path, config.endpoint_pattern)) {
          return config;
        }

        // If fuzzy patterns provided (from global endpoint matching rules),
        // try fuzzy matching using SQL GLOB
        if (options?.fuzzyPatterns && options.fuzzyPatterns.length > 0) {
          for (const fuzzyPattern of options.fuzzyPatterns) {
            if (this._matchesGlobPattern(config.endpoint_pattern, fuzzyPattern)) {
              logger.debug("[EndpointConfigRepository] Matched config via fuzzy pattern", {
                configId: config.id,
                configPattern: config.endpoint_pattern,
                fuzzyPattern: fuzzyPattern,
              });
              return config;
            }
          }
        }
      }
    }

    return null;
  }

  /**
   * Get all unique endpoint patterns
   * @returns {Promise<Array>} Array of patterns
   */
  async getAllPatterns() {
    const sql = `
      SELECT DISTINCT endpoint_pattern, http_method, COUNT(*) as count
      FROM ${this.tableName}
      GROUP BY endpoint_pattern, http_method
      ORDER BY endpoint_pattern
    `;

    return await this.db.all(sql);
  }

  /**
   * Update configuration
   * @param {number} configId - Configuration ID
   * @param {Object} updates - Updated data
   * @returns {Promise<number>} Number of affected rows
   */
  async updateConfig(configId, updates) {
    const data = {};

    if (updates.matchVersion !== undefined) {
      data.match_version = updates.matchVersion ? 1 : 0;
    }
    if (updates.matchLanguage !== undefined) {
      data.match_language = updates.matchLanguage ? 1 : 0;
    }
    if (updates.matchPlatform !== undefined) {
      data.match_platform = updates.matchPlatform ? 1 : 0;
    }
    if (updates.matchEnvironment !== undefined) {
      data.match_environment = updates.matchEnvironment ? 1 : 0;
    }
    if (updates.matchHeaders !== undefined) {
      data.match_headers = JSON.stringify(updates.matchHeaders);
    }
    if (updates.matchBodyFields !== undefined) {
      data.match_body_fields = JSON.stringify(updates.matchBodyFields);
    }
    if (updates.priority !== undefined) {
      data.priority = updates.priority;
    }
    if (updates.enabled !== undefined) {
      data.enabled = updates.enabled ? 1 : 0;
    }
    if (updates.description !== undefined) {
      data.description = updates.description;
    }

    // Always update the updated_at timestamp when modifying a configuration
    data.updated_at = getLocalISOString();

    return await this.update(configId, data);
  }

  /**
   * Enable configuration
   * @param {number} configId - Configuration ID
   * @returns {Promise<number>} Number of affected rows
   */
  async enable(configId) {
    return await this.update(configId, { enabled: 1 });
  }

  /**
   * Disable configuration
   * @param {number} configId - Configuration ID
   * @returns {Promise<number>} Number of affected rows
   */
  async disable(configId) {
    return await this.update(configId, { enabled: 0 });
  }

  /**
   * Update priority
   * @param {number} configId - Configuration ID
   * @param {number} priority - New priority
   * @returns {Promise<number>} Number of affected rows
   */
  async updatePriority(configId, priority) {
    return await this.update(configId, { priority });
  }

  /**
   * Find configurations by method
   * @param {string} method - HTTP method
   * @returns {Promise<Array>} Array of configurations
   */
  async findByMethod(method) {
    return await this.findBy(
      { http_method: method },
      {
        orderBy: "priority",
        orderDir: "DESC",
      },
    );
  }

  /**
   * Count enabled configurations
   * @returns {Promise<number>} Count of enabled configurations
   */
  async countEnabled() {
    return await this.count({ enabled: 1 });
  }

  /**
   * Get statistics
   * @returns {Promise<Object>} Statistics object
   */
  async getStats() {
    const sql = `
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN enabled = 1 THEN 1 ELSE 0 END) as enabled_count,
        SUM(CASE WHEN enabled = 0 THEN 1 ELSE 0 END) as disabled_count,
        AVG(priority) as avg_priority,
        MAX(priority) as max_priority
      FROM ${this.tableName}
    `;

    return await this.db.get(sql);
  }

  /**
   * Check if pattern matches path
   * @private
   */
  _matchesPattern(path, pattern) {
    // Convert pattern to regex
    // /api/users/:id -> /api/users/[^/]+
    // /api/products/* -> /api/products/.*

    const regexPattern = pattern
      .replace(/:[^/]+/g, "[^/]+") // :id -> [^/]+
      .replace(/\*/g, ".*") // * -> .*
      .replace(/\//g, "\\/"); // Escape slashes

    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(path);
  }

  /**
   * Check if database endpoint pattern matches a fuzzy search pattern using GLOB
   * This is used for matching configured patterns against dynamically generated fuzzy patterns
   * from global endpoint matching rules
   * @private
   */
  _matchesGlobPattern(dbPattern, fuzzyPattern) {
    // Convert GLOB pattern to regex for comparison
    // In GLOB:
    // - * matches any sequence of characters
    // - ? matches any single character
    // - [...] matches any character in the set
    // - [a-z] matches any character in range

    const globToRegex = (glob) => {
      let i = 0;
      let regex = "";

      while (i < glob.length) {
        const char = glob[i];

        if (char === "*") {
          // * matches zero or more characters
          regex += ".*";
          i++;
        } else if (char === "?") {
          // ? matches exactly one character
          regex += ".";
          i++;
        } else if (char === "[") {
          // Character class [...]
          let j = i + 1;
          let hasNegation = false;

          // Check for negation [^...]
          if (j < glob.length && glob[j] === "^") {
            hasNegation = true;
            j++;
          }

          // Find the closing bracket
          while (j < glob.length && glob[j] !== "]") {
            j++;
          }

          if (j < glob.length) {
            // Extract the character class content
            const classContent = glob.substring(i + 1 + (hasNegation ? 1 : 0), j);

            if (hasNegation) {
              regex += "[^" + classContent + "]";
            } else {
              regex += "[" + classContent + "]";
            }
            i = j + 1;
          } else {
            // No closing bracket found, treat [ as literal
            regex += "\\[";
            i++;
          }
        } else if (char === "\\") {
          // Escaped character
          if (i + 1 < glob.length) {
            const nextChar = glob[i + 1];
            regex += "\\" + nextChar;
            i += 2;
          } else {
            regex += "\\\\";
            i++;
          }
        } else {
          // Regular character - escape special regex chars
          if (".+^${}()|[]\\".includes(char)) {
            regex += "\\" + char;
          } else {
            regex += char;
          }
          i++;
        }
      }

      return new RegExp(`^${regex}$`);
    };

    const fuzzyRegex = globToRegex(fuzzyPattern);
    const logger = require("../../utils/logger");

    const matches = fuzzyRegex.test(dbPattern);
    logger.debug("[EndpointConfigRepository] GLOB pattern match check", {
      dbPattern: dbPattern.substring(0, 80),
      fuzzyPattern: fuzzyPattern.substring(0, 80),
      matches: matches,
    });

    return matches;
  }

  /**
   * Bulk create configurations
   * @param {Array} configs - Array of configuration data
   * @returns {Promise<Array>} Array of created IDs
   */
  async bulkCreate(configs) {
    const ids = [];

    await this.beginTransaction();

    try {
      for (const config of configs) {
        const id = await this.createConfig(config);
        ids.push(id);
      }

      await this.commit();
      return ids;
    } catch (error) {
      await this.rollback();
      throw error;
    }
  }

  /**
   * Delete configuration by pattern and method
   * @param {string} pattern - Endpoint pattern
   * @param {string} method - HTTP method
   * @returns {Promise<number>} Number of deleted rows
   */
  async deleteByPatternAndMethod(pattern, method) {
    return await this.deleteBy({
      endpoint_pattern: pattern,
      http_method: method,
    });
  }
}

module.exports = EndpointConfigRepository;
