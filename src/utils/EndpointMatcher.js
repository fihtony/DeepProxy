// EndpointMatcher - Handle endpoint path matching with regex patterns
// Applies endpoint matching rules to find matching endpoints in database
// Supports flexible path matching for versioning, namespaces, service pods
// Generates SQL fuzzy query patterns for database search
// Caches compiled regex patterns for performance

const logger = require("./logger");
const { getDefaultAdapter } = require("./SqlPatternAdapter");

class EndpointMatcher {
  /**
   * @param {Array<string>} patterns - Array of regex pattern strings
   */
  constructor(patterns = []) {
    this.patterns = patterns;
    this.compiledPatterns = [];
    this._sqlAdapter = getDefaultAdapter();
    this._compilePatterns();
  }

  /**
   * Compile regex patterns for better performance
   * @private
   */
  _compilePatterns() {
    this.compiledPatterns = [];

    for (let i = 0; i < this.patterns.length; i++) {
      const pattern = this.patterns[i];
      try {
        this.compiledPatterns.push({
          pattern: pattern,
          regex: new RegExp(pattern, "i"), // case-insensitive
          index: i,
        });
      } catch (err) {
        logger.warn("[EndpointMatcher] Invalid regex pattern, skipping", {
          pattern: pattern,
          error: err.message,
        });
        // Skip invalid patterns
      }
    }

    logger.debug("[EndpointMatcher] Patterns compiled", {
      total: this.patterns.length,
      valid: this.compiledPatterns.length,
    });
  }

  /**
   * Generate SQL fuzzy search patterns for a request path
   * Returns all patterns that match the request path
   *
   * @param {string} requestPath - The incoming request endpoint path
   * @returns {Array<Object>} Array of { sqlPattern, sqlOperator, originalPattern }
   */
  generateSqlPatterns(requestPath) {
    if (!requestPath || this.compiledPatterns.length === 0) {
      return [];
    }

    return this._sqlAdapter.generateSqlPatterns(requestPath, this.patterns);
  }

  /**
   * Build SQL WHERE clause for endpoint matching
   * Returns conditions and params for SQL query
   *
   * @param {string} requestPath - The incoming request endpoint path
   * @returns {Object} { conditions: string[], params: any[], isExactMatch: boolean }
   */
  buildEndpointWhereClause(requestPath) {
    return this._sqlAdapter.buildEndpointWhereClause(requestPath, this.patterns);
  }

  /**
   * Normalize endpoint path using matching rules
   * This is used for display/logging purposes
   *
   * @param {string} requestPath - The incoming request endpoint path
   * @returns {Object} { normalizedPath, matchedPattern, originalPath, wasMatched }
   */
  normalizeEndpointPath(requestPath) {
    if (!requestPath) {
      return { normalizedPath: requestPath, matchedPattern: null, originalPath: requestPath, wasMatched: false };
    }

    // Try to find a matching pattern (in array order)
    for (const compiled of this.compiledPatterns) {
      if (compiled.regex.test(requestPath)) {
        // Found a matching pattern
        const normalizedPath = this._generateNormalizedPath(requestPath, compiled.regex);

        logger.debug("[EndpointMatcher] Endpoint path matched", {
          originalPath: requestPath,
          pattern: compiled.pattern,
          normalizedPath: normalizedPath,
        });

        return {
          normalizedPath: normalizedPath,
          matchedPattern: compiled.pattern,
          originalPath: requestPath,
          wasMatched: true,
        };
      }
    }

    // No matching pattern, return original path
    return {
      normalizedPath: requestPath,
      matchedPattern: null,
      originalPath: requestPath,
      wasMatched: false,
    };
  }

  /**
   * Generate normalized path by replacing captured groups with wildcard
   * This creates a pattern that can match multiple database records
   * For patterns with greedy matchers (.*), we replace from the LAST capture group first
   *
   * @private
   */
  _generateNormalizedPath(path, regex) {
    // Get the number of capture groups
    const match = path.match(regex);
    if (!match) {
      return path;
    }

    let normalizedPath = path;
    // Replace each captured group with a wildcard pattern
    // Process from the end to avoid index shifting issues
    for (let i = match.length - 1; i >= 1; i--) {
      const capturedText = match[i];
      if (capturedText !== undefined && capturedText !== null && capturedText !== "") {
        // For greedy patterns, we need to be more careful
        // Find the LAST occurrence of this captured text in the path
        const lastIndex = normalizedPath.lastIndexOf(capturedText);
        if (lastIndex !== -1) {
          // Replace only the last occurrence
          normalizedPath = normalizedPath.substring(0, lastIndex) + "%" + normalizedPath.substring(lastIndex + capturedText.length);
        }
      }
    }
    return normalizedPath;
  }

  /**
   * Check if a database endpoint matches the request path with patterns applied
   *
   * @param {string} requestPath - The incoming request path
   * @param {string} databasePath - The stored endpoint path in database
   * @returns {boolean} True if paths match according to patterns
   */
  pathsMatch(requestPath, databasePath) {
    if (!requestPath || !databasePath) {
      return requestPath === databasePath;
    }

    // If exact match, return true
    if (requestPath === databasePath) {
      return true;
    }

    // Normalize both paths using the same patterns
    const requestNormalized = this.normalizeEndpointPath(requestPath);
    const databaseNormalized = this.normalizeEndpointPath(databasePath);

    // If both paths match the same pattern and produce the same normalized path, they match
    if (requestNormalized.wasMatched && databaseNormalized.wasMatched) {
      if (requestNormalized.matchedPattern === databaseNormalized.matchedPattern) {
        if (requestNormalized.normalizedPath === databaseNormalized.normalizedPath) {
          logger.debug("[EndpointMatcher] Paths match via pattern", {
            requestPath: requestPath,
            databasePath: databasePath,
            pattern: requestNormalized.matchedPattern,
          });
          return true;
        }
      }
    }

    // No pattern matched, so paths must match exactly
    return false;
  }

  /**
   * Update patterns dynamically
   * @param {Array<string>} newPatterns - New set of pattern strings
   */
  updatePatterns(newPatterns) {
    this.patterns = newPatterns || [];
    this._compilePatterns();
    logger.debug("[EndpointMatcher] Patterns updated", {
      patternCount: this.patterns.length,
    });
  }

  /**
   * Get current patterns
   * @returns {Array<string>} Current patterns
   */
  getPatterns() {
    return [...this.patterns];
  }

  /**
   * Check if any patterns are configured
   * @returns {boolean} True if patterns exist
   */
  hasPatterns() {
    return this.compiledPatterns.length > 0;
  }

  /**
   * Validate a pattern string
   * @param {string} pattern - Pattern to validate
   * @returns {Object} { valid: boolean, error: string|null }
   */
  static validatePattern(pattern) {
    if (!pattern || typeof pattern !== "string") {
      return { valid: false, error: "Pattern must be a non-empty string" };
    }

    try {
      new RegExp(pattern, "i");
      return { valid: true, error: null };
    } catch (err) {
      return { valid: false, error: err.message };
    }
  }
}

module.exports = EndpointMatcher;
