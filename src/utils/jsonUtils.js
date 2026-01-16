/**
 * JSON Utilities
 *
 * Purpose:
 * - Safe JSON parsing and stringification
 * - Deep cloning and merging
 * - JSON path operations
 * - Schema validation helpers
 */

/**
 * Safe JSON parse with default value
 * @param {string} json - JSON string
 * @param {*} defaultValue - Default value if parse fails
 * @returns {*} Parsed value or default
 */
function safeParse(json, defaultValue = null) {
  if (!json || typeof json !== "string") {
    return defaultValue;
  }

  try {
    return JSON.parse(json);
  } catch (error) {
    return defaultValue;
  }
}

/**
 * Safe JSON stringify
 * @param {*} value - Value to stringify
 * @param {*} defaultValue - Default value if stringify fails
 * @param {number} space - Indentation spaces
 * @returns {string} JSON string or default
 */
function safeStringify(value, defaultValue = "{}", space = 0) {
  try {
    return JSON.stringify(value, null, space);
  } catch (error) {
    return defaultValue;
  }
}

/**
 * Pretty print JSON
 * @param {*} value - Value to print
 * @param {number} space - Indentation spaces (default 2)
 * @returns {string} Formatted JSON string
 */
function prettyPrint(value, space = 2) {
  return safeStringify(value, "{}", space);
}

/**
 * Deep clone object
 * @param {*} obj - Object to clone
 * @returns {*} Cloned object
 */
function deepClone(obj) {
  if (obj === null || typeof obj !== "object") {
    return obj;
  }

  if (obj instanceof Date) {
    return new Date(obj.getTime());
  }

  if (obj instanceof Array) {
    return obj.map((item) => deepClone(item));
  }

  if (obj instanceof Buffer) {
    return Buffer.from(obj);
  }

  const cloned = {};
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      cloned[key] = deepClone(obj[key]);
    }
  }

  return cloned;
}

/**
 * Deep merge two objects
 * @param {Object} target - Target object
 * @param {Object} source - Source object
 * @returns {Object} Merged object
 */
function deepMerge(target, source) {
  const result = { ...target };

  for (const key in source) {
    if (source.hasOwnProperty(key)) {
      if (source[key] instanceof Object && !Array.isArray(source[key])) {
        result[key] = deepMerge(result[key] || {}, source[key]);
      } else {
        result[key] = source[key];
      }
    }
  }

  return result;
}

/**
 * Get value from object by path
 * @param {Object} obj - Object to query
 * @param {string} path - Dot-separated path (e.g., 'user.profile.name')
 * @param {*} defaultValue - Default value if path not found
 * @returns {*} Value at path or default
 */
function getPath(obj, path, defaultValue = undefined) {
  if (!obj || !path) {
    return defaultValue;
  }

  const keys = path.split(".");
  let current = obj;

  for (const key of keys) {
    if (current === null || current === undefined || !(key in current)) {
      return defaultValue;
    }
    current = current[key];
  }

  return current;
}

/**
 * Set value in object by path
 * @param {Object} obj - Object to modify
 * @param {string} path - Dot-separated path
 * @param {*} value - Value to set
 * @returns {Object} Modified object
 */
function setPath(obj, path, value) {
  if (!obj || !path) {
    return obj;
  }

  const keys = path.split(".");
  const lastKey = keys.pop();
  let current = obj;

  for (const key of keys) {
    if (!(key in current) || typeof current[key] !== "object") {
      current[key] = {};
    }
    current = current[key];
  }

  current[lastKey] = value;
  return obj;
}

/**
 * Delete path from object
 * @param {Object} obj - Object to modify
 * @param {string} path - Dot-separated path
 * @returns {boolean} True if path existed and was deleted
 */
function deletePath(obj, path) {
  if (!obj || !path) {
    return false;
  }

  const keys = path.split(".");
  const lastKey = keys.pop();
  let current = obj;

  for (const key of keys) {
    if (!(key in current)) {
      return false;
    }
    current = current[key];
  }

  if (lastKey in current) {
    delete current[lastKey];
    return true;
  }

  return false;
}

/**
 * Check if path exists in object
 * @param {Object} obj - Object to check
 * @param {string} path - Dot-separated path
 * @returns {boolean} True if path exists
 */
function hasPath(obj, path) {
  if (!obj || !path) {
    return false;
  }

  const keys = path.split(".");
  let current = obj;

  for (const key of keys) {
    if (current === null || current === undefined || !(key in current)) {
      return false;
    }
    current = current[key];
  }

  return true;
}

/**
 * Flatten nested object to dot-notation
 * @param {Object} obj - Object to flatten
 * @param {string} prefix - Key prefix
 * @returns {Object} Flattened object
 */
function flatten(obj, prefix = "") {
  const result = {};

  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      const fullKey = prefix ? `${prefix}.${key}` : key;

      if (obj[key] && typeof obj[key] === "object" && !Array.isArray(obj[key])) {
        Object.assign(result, flatten(obj[key], fullKey));
      } else {
        result[fullKey] = obj[key];
      }
    }
  }

  return result;
}

/**
 * Unflatten dot-notation object to nested
 * @param {Object} obj - Flattened object
 * @returns {Object} Nested object
 */
function unflatten(obj) {
  const result = {};

  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      setPath(result, key, obj[key]);
    }
  }

  return result;
}

/**
 * Compare two objects for deep equality
 * @param {*} a - First value
 * @param {*} b - Second value
 * @returns {boolean} True if equal
 */
function deepEqual(a, b) {
  if (a === b) {
    return true;
  }

  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") {
    return false;
  }

  const keysA = Object.keys(a);
  const keysB = Object.keys(b);

  if (keysA.length !== keysB.length) {
    return false;
  }

  for (const key of keysA) {
    if (!keysB.includes(key) || !deepEqual(a[key], b[key])) {
      return false;
    }
  }

  return true;
}

/**
 * Pick specified keys from object
 * @param {Object} obj - Source object
 * @param {string[]} keys - Keys to pick
 * @returns {Object} Object with only specified keys
 */
function pick(obj, keys) {
  const result = {};
  keys.forEach((key) => {
    if (key in obj) {
      result[key] = obj[key];
    }
  });
  return result;
}

/**
 * Omit specified keys from object
 * @param {Object} obj - Source object
 * @param {string[]} keys - Keys to omit
 * @returns {Object} Object without specified keys
 */
function omit(obj, keys) {
  const result = { ...obj };
  keys.forEach((key) => {
    delete result[key];
  });
  return result;
}

/**
 * Compact object (remove null/undefined values)
 * @param {Object} obj - Object to compact
 * @returns {Object} Compacted object
 */
function compact(obj) {
  const result = {};
  for (const key in obj) {
    if (obj.hasOwnProperty(key) && obj[key] !== null && obj[key] !== undefined) {
      result[key] = obj[key];
    }
  }
  return result;
}

/**
 * Normalize query parameters for consistent comparison
 *
 * This function ensures that query parameters are compared correctly regardless of:
 * 1. Key order - keys are sorted alphabetically
 * 2. Case sensitivity - keys and values are converted to lowercase
 *
 * Requirements from IMPORTANT_REQUEST_MATCHING_RULES_CN.md:
 * - query_params 必须完全匹配（Key/Value pair 完全匹配，参数个数也完全一致，忽略大小写）
 *
 * @param {Object|string|null} queryParams - Query parameters object or JSON string
 * @returns {string|null} Normalized JSON string with sorted keys and lowercase, or null
 */
function normalizeQueryParams(queryParams) {
  if (queryParams === null || queryParams === undefined) {
    return null;
  }

  // Parse if string
  let params = queryParams;
  if (typeof queryParams === "string") {
    try {
      params = JSON.parse(queryParams);
    } catch (e) {
      // Invalid JSON, return null
      return null;
    }
  }

  // If not an object, return null
  if (typeof params !== "object" || params === null || Array.isArray(params)) {
    return null;
  }

  // If empty object, return null (no query params)
  const keys = Object.keys(params);
  if (keys.length === 0) {
    return null;
  }

  // Sort keys alphabetically (case-insensitive) and convert to lowercase
  const sortedKeys = keys.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

  // Build normalized object with lowercase keys and values
  const normalized = {};
  for (const key of sortedKeys) {
    const lowerKey = key.toLowerCase();
    const value = params[key];
    // Convert value to lowercase if string, otherwise keep as is
    normalized[lowerKey] = typeof value === "string" ? value.toLowerCase() : value;
  }

  return JSON.stringify(normalized);
}

/**
 * Compare two query parameter sets for equality
 * Uses normalized comparison (sorted keys, case-insensitive)
 *
 * @param {Object|string|null} params1 - First query parameters
 * @param {Object|string|null} params2 - Second query parameters
 * @returns {boolean} True if parameters are equal
 */
function compareQueryParams(params1, params2) {
  const normalized1 = normalizeQueryParams(params1);
  const normalized2 = normalizeQueryParams(params2);

  // Both null means equal
  if (normalized1 === null && normalized2 === null) {
    return true;
  }

  // One null, one not null means not equal
  if (normalized1 === null || normalized2 === null) {
    return false;
  }

  return normalized1 === normalized2;
}

/**
 * Compare query parameters with partial matching based on specified keys
 * Only compares the keys specified in matchKeys array (case-insensitive)
 *
 * @param {Object|string|null} params1 - First query parameters (incoming request)
 * @param {Object|string|null} params2 - Second query parameters (database record)
 * @param {Array<string>} matchKeys - Array of keys to match (case-insensitive)
 * @returns {boolean} True if specified parameters match
 */
function compareQueryParamsPartial(params1, params2, matchKeys) {
  // If no matchKeys provided, use full comparison
  if (!matchKeys || !Array.isArray(matchKeys) || matchKeys.length === 0) {
    return compareQueryParams(params1, params2);
  }

  // Parse params to objects
  let obj1 = params1;
  let obj2 = params2;

  if (typeof params1 === "string") {
    try {
      obj1 = JSON.parse(params1);
    } catch (e) {
      obj1 = null;
    }
  }

  if (typeof params2 === "string") {
    try {
      obj2 = JSON.parse(params2);
    } catch (e) {
      obj2 = null;
    }
  }

  // Normalize matchKeys to lowercase
  const lowerMatchKeys = matchKeys.map((k) => k.toLowerCase());

  // Helper to get value by key (case-insensitive)
  const getValueCaseInsensitive = (obj, key) => {
    if (!obj || typeof obj !== "object") return undefined;
    const lowerKey = key.toLowerCase();
    for (const k of Object.keys(obj)) {
      if (k.toLowerCase() === lowerKey) {
        const val = obj[k];
        return typeof val === "string" ? val.toLowerCase() : val;
      }
    }
    return undefined;
  };

  // Compare each specified key
  for (const key of lowerMatchKeys) {
    const val1 = getValueCaseInsensitive(obj1, key);
    const val2 = getValueCaseInsensitive(obj2, key);

    // Both must have the same value (or both undefined/null)
    if (val1 !== val2) {
      // Handle undefined vs null edge case
      if (val1 == null && val2 == null) continue;
      return false;
    }
  }

  return true;
}

/**
 * Extract subset of query parameters based on specified keys
 *
 * @param {Object|string|null} params - Query parameters
 * @param {Array<string>} keys - Keys to extract (case-insensitive)
 * @returns {Object|null} Extracted parameters or null
 */
function extractQueryParamsSubset(params, keys) {
  if (!params || !keys || !Array.isArray(keys) || keys.length === 0) {
    return null;
  }

  let obj = params;
  if (typeof params === "string") {
    try {
      obj = JSON.parse(params);
    } catch (e) {
      return null;
    }
  }

  if (!obj || typeof obj !== "object") return null;

  const lowerKeys = keys.map((k) => k.toLowerCase());
  const result = {};

  for (const key of Object.keys(obj)) {
    if (lowerKeys.includes(key.toLowerCase())) {
      result[key.toLowerCase()] = typeof obj[key] === "string" ? obj[key].toLowerCase() : obj[key];
    }
  }

  return Object.keys(result).length > 0 ? result : null;
}

/**
 * Compare request body fields based on match_body configuration
 * Used in RECORDING mode to determine if request body matches an existing record
 *
 * Rules:
 * - matchBodyFields is an array of field paths to compare, e.g., ["clientId", "memberId", "address.city"]
 * - Supports nested object access with dot notation (e.g., "address.city" means body.address.city)
 * - All specified fields must match (case-insensitive value comparison)
 * - If matchBodyFields is empty or null, no body matching is performed (returns true)
 *
 * @param {Object|string|null} body1 - First request body (incoming request)
 * @param {Object|string|null} body2 - Second request body (database record)
 * @param {Array<string>} matchBodyFields - Array of field paths to compare
 * @returns {boolean} True if all specified fields match
 */
function compareBodyFields(body1, body2, matchBodyFields) {
  // If no fields to match, return true (no body matching required)
  if (!matchBodyFields || !Array.isArray(matchBodyFields) || matchBodyFields.length === 0) {
    return true;
  }

  // Parse bodies if strings
  let obj1 = body1;
  let obj2 = body2;

  if (typeof body1 === "string") {
    try {
      obj1 = JSON.parse(body1);
    } catch (e) {
      obj1 = null;
    }
  }

  if (typeof body2 === "string") {
    try {
      obj2 = JSON.parse(body2);
    } catch (e) {
      obj2 = null;
    }
  }

  // Compare each specified field
  for (const fieldPath of matchBodyFields) {
    const val1 = getPath(obj1, fieldPath);
    const val2 = getPath(obj2, fieldPath);

    // Case-insensitive value comparison
    const str1 = val1 != null ? String(val1).toLowerCase() : null;
    const str2 = val2 != null ? String(val2).toLowerCase() : null;

    if (str1 !== str2) {
      return false;
    }
  }

  return true;
}

/**
 * Score request body field matches for REPLAY mode
 * Returns information about matched fields with priority-based scoring
 *
 * Rules (from IMPORTANT_REQUEST_MATCHING_RULES_CN.md):
 * - matchBodyFields array order defines priority (first element = highest priority)
 * - All fields are optional, dProxy tries to match as many as possible
 * - Higher priority fields should be weighted more heavily
 * - Returns { matchedFields, matchScore, highestPriorityMatch }
 *
 * Scoring algorithm:
 * - For N fields in matchBodyFields, field at index i has weight: N - i
 * - Example: ["clientId", "memberId", "planNumber"] with N=3
 *   - clientId (index 0) weight = 3, memberId (index 1) weight = 2, planNumber (index 2) weight = 1
 * - Total score = sum of weights for matched fields
 * - Higher score indicates better match
 *
 * @param {Object|string|null} incomingBody - Incoming request body
 * @param {Object|string|null} candidateBody - Candidate body from database
 * @param {Array<string>} matchBodyFields - Array of field paths to match (in priority order)
 * @returns {Object} { matchedFields: string[], matchScore: number, highestMatchedPriority: number }
 */
function scoreBodyFieldMatch(incomingBody, candidateBody, matchBodyFields) {
  const result = {
    matchedFields: [],
    matchScore: 0,
    highestMatchedPriority: -1, // -1 means no match, 0 = highest priority field matched
  };

  // If no fields to match, return empty result
  if (!matchBodyFields || !Array.isArray(matchBodyFields) || matchBodyFields.length === 0) {
    return result;
  }

  // Parse bodies if strings
  let incoming = incomingBody;
  let candidate = candidateBody;

  if (typeof incomingBody === "string") {
    try {
      incoming = JSON.parse(incomingBody);
    } catch (e) {
      incoming = null;
    }
  }

  if (typeof candidateBody === "string") {
    try {
      candidate = JSON.parse(candidateBody);
    } catch (e) {
      candidate = null;
    }
  }

  // If either body is null/undefined, return empty result
  if (!incoming || !candidate) {
    return result;
  }

  const totalFields = matchBodyFields.length;

  for (let i = 0; i < matchBodyFields.length; i++) {
    const fieldPath = matchBodyFields[i];
    const incomingValue = getPath(incoming, fieldPath);
    const candidateValue = getPath(candidate, fieldPath);

    // Skip if incoming request doesn't have this field
    if (incomingValue === undefined || incomingValue === null) {
      continue;
    }

    // Skip if candidate doesn't have this field
    if (candidateValue === undefined || candidateValue === null) {
      continue;
    }

    // Case-insensitive value comparison
    const incomingStr = String(incomingValue).toLowerCase();
    const candidateStr = String(candidateValue).toLowerCase();

    if (incomingStr === candidateStr) {
      result.matchedFields.push(fieldPath);
      // Weight = N - i (higher priority fields get higher weight)
      result.matchScore += totalFields - i;

      // Track highest priority match (lower index = higher priority)
      if (result.highestMatchedPriority === -1 || i < result.highestMatchedPriority) {
        result.highestMatchedPriority = i;
      }
    }
  }

  return result;
}

/**
 * Compare two body match scores to determine which is better
 * Used for selecting best match in REPLAY mode
 *
 * Priority rules (from IMPORTANT_REQUEST_MATCHING_RULES_CN.md):
 * 1. First compare by highest matched priority field (lower index = better)
 * 2. If same highest priority, compare by total match score
 * 3. If same score, they are equal (caller should use other criteria like updated_at)
 *
 * @param {Object} score1 - First score result from scoreBodyFieldMatch
 * @param {Object} score2 - Second score result from scoreBodyFieldMatch
 * @returns {number} -1 if score1 is better, 1 if score2 is better, 0 if equal
 */
function compareBodyMatchScores(score1, score2) {
  // If one has no matches and other has matches, prefer the one with matches
  if (score1.highestMatchedPriority === -1 && score2.highestMatchedPriority !== -1) {
    return 1; // score2 is better
  }
  if (score1.highestMatchedPriority !== -1 && score2.highestMatchedPriority === -1) {
    return -1; // score1 is better
  }
  if (score1.highestMatchedPriority === -1 && score2.highestMatchedPriority === -1) {
    return 0; // both have no matches
  }

  // Compare by highest matched priority (lower index = higher priority = better)
  if (score1.highestMatchedPriority < score2.highestMatchedPriority) {
    return -1; // score1 matched a higher priority field
  }
  if (score1.highestMatchedPriority > score2.highestMatchedPriority) {
    return 1; // score2 matched a higher priority field
  }

  // Same highest priority, compare by total score
  if (score1.matchScore > score2.matchScore) {
    return -1; // score1 has more matches
  }
  if (score1.matchScore < score2.matchScore) {
    return 1; // score2 has more matches
  }

  // Equal
  return 0;
}

module.exports = {
  safeParse,
  safeStringify,
  prettyPrint,
  deepClone,
  deepMerge,
  getPath,
  setPath,
  deletePath,
  hasPath,
  flatten,
  unflatten,
  deepEqual,
  pick,
  omit,
  compact,
  normalizeQueryParams,
  compareQueryParams,
  compareQueryParamsPartial,
  extractQueryParamsSubset,
  compareBodyFields,
  scoreBodyFieldMatch,
  compareBodyMatchScores,
};
