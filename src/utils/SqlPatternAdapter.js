/**
 * SqlPatternAdapter - Convert regex patterns to SQL fuzzy search patterns
 *
 * This module provides database-agnostic pattern conversion for endpoint matching.
 * Different databases have different syntax for pattern matching:
 * - SQLite: GLOB (case-sensitive, Unix-style wildcards) or LIKE (case-insensitive)
 * - PostgreSQL: SIMILAR TO, ~ (regex), or LIKE
 * - SQL Server: LIKE with ESCAPE, or PATINDEX
 *
 * Current implementation supports SQLite only.
 * To add support for other databases:
 * 1. Create a new adapter class (e.g., PostgresPatternAdapter)
 * 2. Implement the same interface methods
 * 3. Update the factory method to return the appropriate adapter
 */

const logger = require("./logger");

/**
 * Base interface for SQL pattern adapters
 * All database-specific adapters should implement these methods
 */
class BaseSqlPatternAdapter {
  /**
   * Convert a JavaScript regex pattern to SQL fuzzy search pattern
   * @param {string} requestPath - The incoming request path
   * @param {string} pattern - JavaScript regex pattern string
   * @returns {Object|null} { sqlPattern, sqlOperator } or null if pattern doesn't match
   */
  convertPatternToSql(requestPath, pattern) {
    throw new Error("Method not implemented");
  }

  /**
   * Generate all possible SQL patterns for a request path
   * @param {string} requestPath - The incoming request path
   * @param {Array<string>} patterns - Array of regex pattern strings
   * @returns {Array<Object>} Array of { sqlPattern, sqlOperator, originalPattern }
   */
  generateSqlPatterns(requestPath, patterns) {
    throw new Error("Method not implemented");
  }

  /**
   * Build SQL WHERE clause for endpoint matching
   * @param {string} requestPath - The incoming request path
   * @param {Array<string>} patterns - Array of regex pattern strings
   * @returns {Object} { conditions: string[], params: any[] }
   */
  buildEndpointWhereClause(requestPath, patterns) {
    throw new Error("Method not implemented");
  }
}

/**
 * SQLite implementation of SQL pattern adapter
 * Uses GLOB for pattern matching (case-sensitive, Unix-style wildcards)
 */
class SqlitePatternAdapter extends BaseSqlPatternAdapter {
  constructor() {
    super();
    // Cache for compiled regex patterns
    this._regexCache = new Map();
  }

  /**
   * Get or create a compiled regex from pattern string
   * @private
   */
  _getRegex(pattern) {
    if (!this._regexCache.has(pattern)) {
      try {
        this._regexCache.set(pattern, new RegExp(pattern, "i"));
      } catch (err) {
        logger.warn("[SqlitePatternAdapter] Invalid regex pattern", {
          pattern,
          error: err.message,
        });
        return null;
      }
    }
    return this._regexCache.get(pattern);
  }

  /**
   * Convert JavaScript regex pattern to fuzzy search string for a specific request path
   *
   * CORRECT LOGIC (as per user specification):
   *
   * Step 1: Test if the pattern matches the request path
   *   If no match, return null
   *
   * Step 2: If pattern has capture groups (parentheses):
   *   Extract the captured values from the request path
   *   Replace each captured value in the request path with appropriate GLOB wildcard
   *   Captured value replacements:
   *     For digits (backslash-d or [0-9]): replace with [0-9]
   *     For words (backslash-w or [a-zA-Z0-9_]): replace with [a-zA-Z0-9_]
   *     For patterns [a-z]+: replace with [a-z]*
   *     For patterns [a-zA-Z]+: replace with [a-zA-Z]*
   *     For patterns [a-zA-Z0-9]+: replace with [a-zA-Z0-9]*
   *   Return the fuzzy search string
   *
   * Step 3: If pattern has NO capture groups:
   *   Return null to indicate exact match should be used
   *   This prevents overly broad GLOB patterns from matching unrelated endpoints
   *
   * Examples:
   * 1. Pattern with capture group:
   *    Pattern regex: dot-star([0-9])-ns slash dot-star
   *    Request path: use forward slashes normally
   *    Captured value: "2"
   *    Result: with [0-9] replacing captured digit
   *
   * 2. Pattern without capture group:
   *    Pattern regex: dot-star slash pub slash services-[AB] slash dot-star
   *    Request path: use forward slashes normally
   *    No captures
   *    Result: null - use exact match fallback
   *
   * @param {string} requestPath - The incoming request path
   * @param {string} pattern - JavaScript regex pattern string
   * @returns {Object|null} { sqlPattern, sqlOperator } or null if pattern doesn't match or has no capture groups
   */
  convertPatternToSql(requestPath, pattern) {
    const regex = this._getRegex(pattern);
    if (!regex) return null;

    // Check if the pattern matches the request path
    const match = requestPath.match(regex);
    if (!match) {
      return null;
    }

    logger.debug("[SqlPatternAdapter] Converting pattern to SQL", {
      pattern: pattern,
      requestPath: requestPath.substring(0, 80),
      captureGroups: match.length - 1,
    });

    // Check if pattern has capture groups
    const hasCaptureGroups = this._hasCaptureGroups(pattern);

    if (hasCaptureGroups && match.length > 1) {
      // Pattern has capture groups and we captured values
      return this._buildFuzzyPatternFromCaptures(requestPath, pattern, match);
    } else if (hasCaptureGroups) {
      // Pattern has capture groups but no values captured - use exact match
      logger.debug("[SqlPatternAdapter] Pattern has capture groups but no values captured - using exact match", {
        pattern: pattern,
        requestPath: requestPath.substring(0, 80),
      });
      return null;
    } else {
      // Pattern has NO capture groups - use exact match fallback
      // This prevents overly broad GLOB patterns (e.g., [AB] character class) from matching unrelated endpoints
      logger.debug("[SqlPatternAdapter] Pattern has no capture groups - using exact match fallback", {
        pattern: pattern,
        requestPath: requestPath.substring(0, 80),
      });
      return null;
    }
  }

  /**
   * Check if a regex pattern has capture groups (parentheses)
   * @private
   */
  _hasCaptureGroups(pattern) {
    // Simple check: look for unescaped parentheses that are not followed by ? (non-capturing)
    // This is a simplified check - a full parser would be more accurate
    const nonEscapedParens = /(?<!\\)\((?!\?)/;
    return nonEscapedParens.test(pattern);
  }

  /**
   * Build fuzzy search pattern from captured values
   * Replaces each captured group with appropriate wildcard
   * @private
   */
  _buildFuzzyPatternFromCaptures(requestPath, pattern, match) {
    let fuzzySearchString = requestPath;

    // Get capture group patterns from the regex pattern
    const captureGroupPatterns = this._extractCaptureGroupPatterns(pattern);

    logger.debug("[SqlPatternAdapter] Building fuzzy pattern from captures", {
      pattern: pattern,
      captureGroupCount: match.length - 1,
      captureGroupPatterns: captureGroupPatterns,
    });

    // Replace each captured value in reverse order to avoid index shifting
    for (let i = match.length - 1; i >= 1; i--) {
      const capturedValue = match[i];
      if (capturedValue !== undefined && capturedValue !== null && capturedValue !== "") {
        // Determine the wildcard pattern to use
        const wildcardPattern = this._determineWildcardForCaptureGroup(
          pattern,
          i - 1, // capture group index (0-based)
          capturedValue,
          captureGroupPatterns,
        );

        // Find and replace the last occurrence of the captured value
        const lastIndex = fuzzySearchString.lastIndexOf(capturedValue);
        if (lastIndex !== -1) {
          fuzzySearchString =
            fuzzySearchString.substring(0, lastIndex) + wildcardPattern + fuzzySearchString.substring(lastIndex + capturedValue.length);
        }
      }
    }

    logger.debug("[SqlPatternAdapter] Final fuzzy pattern from captures", {
      pattern: pattern,
      fuzzyPattern: fuzzySearchString.substring(0, 100),
    });

    return {
      sqlPattern: fuzzySearchString,
      sqlOperator: "GLOB",
      originalPattern: pattern,
    };
  }

  /**
   * Convert regex pattern (without capture groups) to GLOB pattern
   * @private
   */
  _convertPatternToGlob(pattern) {
    // Convert regex pattern to GLOB pattern by direct syntax mapping
    // Step 1: Replace escaped dots (\.) with a placeholder to protect them
    const ESCAPED_DOT_PLACEHOLDER = "\x00DOT\x00";
    let globPattern = pattern.replace(/\\\./g, ESCAPED_DOT_PLACEHOLDER);

    // Step 2: Remove regex anchors (^ and $)
    globPattern = globPattern.replace(/^\^/, "").replace(/\$$/, "");

    // Step 3: Convert character classes with quantifiers BEFORE converting other patterns
    // This needs to happen before Step 4 to avoid double conversion
    // [ABC]+ -> [ABC]* (character class with one-or-more becomes zero-or-more)
    globPattern = globPattern.replace(/\[([^\]]+)\]\+/g, "[$1]*");

    // Step 4: Convert regex escape sequences to GLOB equivalents
    globPattern = globPattern
      .replace(/\\d\+/g, "[0-9]*") // \d+ -> [0-9]* (process first)
      .replace(/\\d/g, "[0-9]") // \d -> [0-9]
      .replace(/\\w\+/g, "[a-zA-Z0-9_]*") // \w+ -> word chars
      .replace(/\\w/g, "[a-zA-Z0-9_]") // \w -> word character
      .replace(/\\s\+/g, "[ \t\n]*") // \s+ -> whitespace
      .replace(/\\s/g, "[ \t\n]"); // \s -> single whitespace

    // Step 5: Convert regex quantifiers to GLOB
    globPattern = globPattern
      .replace(/\.\*/g, "*") // .* -> * (any characters)
      .replace(/\.\+/g, "*"); // .+ -> * (one or more -> zero or more)

    // Step 6: Replace unescaped dots with GLOB single-char wildcard
    globPattern = globPattern.replace(/\./g, "?"); // . -> ? (single character)

    // Step 7: Restore escaped dots as literal dots in GLOB
    globPattern = globPattern.replace(new RegExp(ESCAPED_DOT_PLACEHOLDER, "g"), ".");

    // Step 8: Remove capture group parentheses
    // After converting escape sequences, remove remaining parentheses
    globPattern = globPattern.replace(/\(([^()]*)\)/g, "$1");

    logger.debug("[SqlPatternAdapter] Converted pattern to GLOB", {
      pattern: pattern,
      globPattern: globPattern.substring(0, 100),
    });

    return {
      sqlPattern: globPattern,
      sqlOperator: "GLOB",
      originalPattern: pattern,
    };
  }

  /**
   * Extract capture group patterns from a regex pattern
   * Returns array of capture group contents
   * @private
   */
  _extractCaptureGroupPatterns(pattern) {
    const captureGroups = [];
    let depth = 0;
    let currentGroup = "";
    let inCharClass = false;

    for (let i = 0; i < pattern.length; i++) {
      const char = pattern[i];
      const prevChar = i > 0 ? pattern[i - 1] : "";

      // Handle character classes [...]
      if (char === "[" && prevChar !== "\\") {
        inCharClass = true;
      } else if (char === "]" && prevChar !== "\\") {
        inCharClass = false;
      }

      // Handle capture groups (...)
      if (!inCharClass) {
        if (char === "(" && prevChar !== "\\") {
          if (depth === 0) {
            currentGroup = "";
          }
          depth++;
        } else if (char === ")" && prevChar !== "\\") {
          depth--;
          if (depth === 0) {
            captureGroups.push(currentGroup);
            currentGroup = "";
          } else {
            currentGroup += char;
          }
        } else if (depth > 0) {
          currentGroup += char;
        }
      } else if (depth > 0) {
        currentGroup += char;
      }
    }

    return captureGroups;
  }

  /**
   * Determine the wildcard pattern to use for a specific capture group
   * Based on the capture group definition in the regex pattern
   * @private
   */
  _determineWildcardForCaptureGroup(pattern, groupIndex, capturedValue, captureGroupPatterns) {
    // Get the pattern that defines this capture group
    const groupPattern = captureGroupPatterns[groupIndex] || "";

    logger.debug("[SqlPatternAdapter] Determining wildcard for capture group", {
      groupIndex: groupIndex,
      capturedValue: capturedValue,
      groupPattern: groupPattern,
    });

    // Analyze the group pattern to determine the wildcard
    // Examples:
    // "\d" -> [0-9] (single digit)
    // "\d+" -> [0-9]* (one or more digits)
    // "[a-z]+" -> [a-z]* (one or more lowercase)
    // "[a-zA-Z0-9]+" -> [a-zA-Z0-9]* (one or more alphanumeric)

    // Check for digit patterns
    if (groupPattern.includes("\\d")) {
      // \d or \d+
      return groupPattern.includes("+") ? "[0-9]*" : "[0-9]";
    }

    if (groupPattern.includes("[0-9]")) {
      // [0-9] or [0-9]+
      return groupPattern.includes("+") ? "[0-9]*" : "[0-9]";
    }

    // Check for word patterns
    if (groupPattern.includes("\\w")) {
      // \w or \w+
      return groupPattern.includes("+") ? "[a-zA-Z0-9_]*" : "[a-zA-Z0-9_]";
    }

    if (groupPattern.includes("[a-zA-Z0-9_]")) {
      return groupPattern.includes("+") ? "[a-zA-Z0-9_]*" : "[a-zA-Z0-9_]";
    }

    // Check for lowercase letter patterns
    if (groupPattern.includes("[a-z]")) {
      // [a-z] or [a-z]+
      return groupPattern.includes("+") ? "[a-z]*" : "[a-z]";
    }

    // Check for mixed case letter patterns
    if (groupPattern.includes("[a-zA-Z]") || groupPattern.includes("[A-Za-z]")) {
      // [a-zA-Z] or [a-zA-Z]+
      return groupPattern.includes("+") ? "[a-zA-Z]*" : "[a-zA-Z]";
    }

    // Check for alphanumeric patterns
    if (groupPattern.includes("[a-zA-Z0-9]")) {
      // [a-zA-Z0-9] or [a-zA-Z0-9]+
      return groupPattern.includes("+") ? "[a-zA-Z0-9]*" : "[a-zA-Z0-9]";
    }

    // Check for character class patterns with + quantifier
    // e.g. [a-z]+ becomes [a-z]*
    const charClassMatch = groupPattern.match(/\[([^\]]+)\]\+?/);
    if (charClassMatch) {
      const charClass = "[" + charClassMatch[1] + "]";
      return groupPattern.includes("+") ? charClass + "*" : charClass;
    }

    // Fallback: use wildcard for any other pattern
    return "*";
  }

  /**
   * Escape special characters in SQL GLOB patterns
   * In SQLite GLOB: [ ] matches characters, * matches any sequence, ? matches single char
   * Other special chars like . [ ] need to be escaped
   * @private
   */
  _escapeSqlSpecialChars(str) {
    if (!str) return str;
    // In GLOB, special characters are: * ? [ ]
    // We need to be careful with [ and ] as they delimit character classes
    // Escape [ and ] by using [[] and []]
    return str
      .replace(/\[/g, "[[]") // [ becomes [[]
      .replace(/\]/g, "[]]"); // ] becomes []]
    // Note: * and ? are used as wildcards, so we don't escape them for GLOB
    // But . is NOT special in GLOB, it's treated literally
  }

  /**
   * Generate all possible SQL patterns for a request path
   * @param {string} requestPath - The incoming request path
   * @param {Array<string>} patterns - Array of regex pattern strings
   * @returns {Array<Object>} Array of { sqlPattern, sqlOperator, originalPattern }
   */
  generateSqlPatterns(requestPath, patterns) {
    if (!patterns || patterns.length === 0) {
      return [];
    }

    const results = [];

    for (const pattern of patterns) {
      const result = this.convertPatternToSql(requestPath, pattern);
      if (result) {
        results.push(result);
        logger.debug("[SqlitePatternAdapter] Generated SQL pattern", {
          requestPath,
          pattern,
          sqlPattern: result.sqlPattern,
        });
      }
    }

    return results;
  }

  /**
   * Build SQL WHERE clause for endpoint matching
   * @param {string} requestPath - The incoming request path
   * @param {Array<string>} patterns - Array of regex pattern strings
   * @returns {Object} { conditions: string[], params: any[] }
   */
  buildEndpointWhereClause(requestPath, patterns) {
    if (!patterns || patterns.length === 0) {
      // No patterns defined, use exact match
      return {
        conditions: ["LOWER(ar.endpoint_path) = LOWER(?)"],
        params: [requestPath],
        isExactMatch: true,
      };
    }

    logger.debug("[SqlPatternAdapter] Building endpoint WHERE clause", {
      patternCount: patterns.length,
      requestPath: requestPath.substring(0, 80),
    });

    const sqlPatterns = this.generateSqlPatterns(requestPath, patterns);

    logger.debug("[SqlPatternAdapter] Generated SQL patterns", {
      matchedPatternCount: sqlPatterns.length,
      patterns: patterns,
    });

    if (sqlPatterns.length === 0) {
      // No pattern matched, use exact match
      return {
        conditions: ["LOWER(ar.endpoint_path) = LOWER(?)"],
        params: [requestPath],
        isExactMatch: true,
      };
    }

    // Build OR conditions for all matching patterns
    // Also include exact match as the first option
    const conditions = [];
    const params = [];

    // Exact match first (highest priority)
    conditions.push("LOWER(ar.endpoint_path) = LOWER(?)");
    params.push(requestPath);

    // Add fuzzy matches
    for (const sqlPattern of sqlPatterns) {
      logger.debug("[SqlPatternAdapter] Adding GLOB condition", {
        pattern: sqlPattern.originalPattern,
        sqlPattern: sqlPattern.sqlPattern.substring(0, 100),
      });

      conditions.push(`ar.endpoint_path GLOB ?`);
      params.push(sqlPattern.sqlPattern);
    }

    logger.debug("[SqlPatternAdapter] Final WHERE clause built", {
      conditionCount: conditions.length,
      paramCount: params.length,
    });

    return {
      conditions,
      params,
      isExactMatch: false,
      sqlPatterns,
    };
  }

  /**
   * Clear the regex cache
   */
  clearCache() {
    this._regexCache.clear();
  }
}

/**
 * Factory method to get the appropriate SQL pattern adapter
 * @param {string} dbType - Database type: 'sqlite', 'postgres', 'mssql'
 * @returns {BaseSqlPatternAdapter} The appropriate adapter instance
 */
function getSqlPatternAdapter(dbType = "sqlite") {
  switch (dbType.toLowerCase()) {
    case "sqlite":
      return new SqlitePatternAdapter();

    case "postgres":
    case "postgresql":
      // TODO: Implement PostgresPatternAdapter
      // PostgreSQL supports:
      // - SIMILAR TO (SQL standard regex)
      // - ~ operator (POSIX regex)
      // - LIKE with wildcards
      // For now, fall back to SQLite adapter (GLOB-like syntax may not work)
      logger.warn("[SqlPatternAdapter] PostgreSQL adapter not implemented, using SQLite adapter");
      return new SqlitePatternAdapter();

    case "mssql":
    case "sqlserver":
      // TODO: Implement MssqlPatternAdapter
      // SQL Server supports:
      // - LIKE with wildcards (%, _)
      // - PATINDEX for pattern matching
      // - No native regex support without CLR
      // For now, fall back to SQLite adapter
      logger.warn("[SqlPatternAdapter] SQL Server adapter not implemented, using SQLite adapter");
      return new SqlitePatternAdapter();

    default:
      logger.warn("[SqlPatternAdapter] Unknown database type, using SQLite adapter", { dbType });
      return new SqlitePatternAdapter();
  }
}

// Singleton instance for SQLite (most common case)
let _sqliteAdapter = null;

/**
 * Get the default SQLite pattern adapter instance (singleton)
 * @returns {SqlitePatternAdapter}
 */
function getDefaultAdapter() {
  if (!_sqliteAdapter) {
    _sqliteAdapter = new SqlitePatternAdapter();
  }
  return _sqliteAdapter;
}

module.exports = {
  BaseSqlPatternAdapter,
  SqlitePatternAdapter,
  getSqlPatternAdapter,
  getDefaultAdapter,
};
