/**
 * Dimension Matchers - Match specific dimensions (version, language, platform, environment)
 *
 * Purpose:
 * - Provide specialized matching logic for each dimension
 * - Support exact and fuzzy matching
 * - Calculate match scores
 * - Enable extensible matching strategies
 */

/**
 * Base Matcher class
 */
class BaseMatcher {
  /**
   * Match two values and return score
   * @param {*} value1 - First value
   * @param {*} value2 - Second value
   * @returns {number} Match score (0-10)
   */
  match(value1, value2) {
    throw new Error("match() must be implemented");
  }

  /**
   * Normalize value for comparison
   * @protected
   */
  _normalize(value) {
    if (value === null || value === undefined) {
      return null;
    }
    return String(value).toLowerCase().trim();
  }
}

/**
 * VersionMatcher - Match application versions
 *
 * Features:
 * - Exact match: "1.0.0" === "1.0.0" (score: 10)
 * - Major match: "1.x.x" === "1.y.z" (score: 7)
 * - Minor match: "1.2.x" === "1.2.y" (score: 9)
 * - Wildcard support: "*" matches any
 */
class VersionMatcher extends BaseMatcher {
  match(version1, version2) {
    const v1 = this._normalize(version1);
    const v2 = this._normalize(version2);

    // Null or undefined
    if (!v1 || !v2) {
      return v1 === v2 ? 10 : 0;
    }

    // Wildcard match
    if (v1 === "*" || v2 === "*") {
      return 10;
    }

    // Exact match
    if (v1 === v2) {
      return 10;
    }

    // Parse semantic versions
    const parts1 = v1.split(".").map((p) => parseInt(p) || 0);
    const parts2 = v2.split(".").map((p) => parseInt(p) || 0);

    // Major version match
    if (parts1[0] === parts2[0]) {
      // Minor version match
      if (parts1[1] === parts2[1]) {
        // Patch version match
        if (parts1[2] === parts2[2]) {
          return 10; // Exact match
        }
        return 9; // Minor match
      }
      return 7; // Major match
    }

    return 0; // No match
  }

  /**
   * Check if version matches pattern
   * @param {string} version - Version to check
   * @param {string} pattern - Pattern (e.g., "1.2.*", "1.*", "*")
   * @returns {boolean} True if matches
   */
  matchesPattern(version, pattern) {
    const v = this._normalize(version);
    const p = this._normalize(pattern);

    if (!v || !p) return false;
    if (p === "*") return true;

    const vParts = v.split(".");
    const pParts = p.split(".");

    for (let i = 0; i < pParts.length; i++) {
      if (pParts[i] === "*") return true;
      if (pParts[i] !== vParts[i]) return false;
    }

    return true;
  }
}

/**
 * LanguageMatcher - Match application language
 *
 * Features:
 * - Exact match: "en-US" === "en-US" (score: 10)
 * - Language match: "en" in "en-US" (score: 8)
 * - Fallback: "en-US" -> "en" (score: 6)
 */
class LanguageMatcher extends BaseMatcher {
  match(lang1, lang2) {
    const l1 = this._normalize(lang1);
    const l2 = this._normalize(lang2);

    // Null or undefined
    if (!l1 || !l2) {
      return l1 === l2 ? 10 : 0;
    }

    // Exact match
    if (l1 === l2) {
      return 10;
    }

    // Extract language code (before hyphen)
    const code1 = l1.split("-")[0];
    const code2 = l2.split("-")[0];

    // Language code match
    if (code1 === code2) {
      return 8;
    }

    // Common language families
    const families = {
      en: ["en-us", "en-gb", "en-ca", "en-au"],
      zh: ["zh-cn", "zh-tw", "zh-hk"],
      es: ["es-es", "es-mx", "es-ar"],
      fr: ["fr-fr", "fr-ca"],
      pt: ["pt-br", "pt-pt"],
    };

    for (const [family, langs] of Object.entries(families)) {
      if (langs.includes(l1) && langs.includes(l2)) {
        return 6; // Same family
      }
    }

    return 0; // No match
  }

  /**
   * Get language code (primary language)
   * @param {string} language - Language tag
   * @returns {string} Language code
   */
  getLanguageCode(language) {
    const normalized = this._normalize(language);
    return normalized ? normalized.split("-")[0] : null;
  }
}

/**
 * PlatformMatcher - Match application platform
 *
 * Features:
 * - Exact match: "ios" === "ios" (score: 10)
 * - Platform family: "android" ~= "android-tablet" (score: 7)
 * - OS family: "ios" ~= "ipad" (score: 7)
 */
class PlatformMatcher extends BaseMatcher {
  constructor() {
    super();

    // Platform families
    this.families = {
      ios: ["ios", "iphone", "ipad", "ipod"],
      android: ["android", "android-phone", "android-tablet"],
      web: ["web", "browser", "desktop"],
      windows: ["windows", "win", "win32", "win64"],
      macos: ["macos", "mac", "darwin"],
    };
  }

  match(platform1, platform2) {
    const p1 = this._normalize(platform1);
    const p2 = this._normalize(platform2);

    // Null or undefined
    if (!p1 || !p2) {
      return p1 === p2 ? 10 : 0;
    }

    // Exact match
    if (p1 === p2) {
      return 10;
    }

    // Check platform families
    for (const [family, platforms] of Object.entries(this.families)) {
      const in1 = platforms.includes(p1);
      const in2 = platforms.includes(p2);

      if (in1 && in2) {
        return 7; // Same family
      }
    }

    // Substring match (e.g., "android" in "android-phone")
    if (p1.includes(p2) || p2.includes(p1)) {
      return 5;
    }

    return 0; // No match
  }

  /**
   * Get platform family
   * @param {string} platform - Platform name
   * @returns {string|null} Family name
   */
  getPlatformFamily(platform) {
    const p = this._normalize(platform);

    for (const [family, platforms] of Object.entries(this.families)) {
      if (platforms.includes(p)) {
        return family;
      }
    }

    return null;
  }
}

/**
 * EnvironmentMatcher - Match application environment
 *
 * Features:
 * - Exact match: "production" === "production" (score: 10)
 * - Alias match: "prod" === "production" (score: 10)
 * - Dev environments: "dev" ~= "development" (score: 10)
 */
class EnvironmentMatcher extends BaseMatcher {
  constructor() {
    super();

    // Environment aliases
    this.aliases = {
      development: ["dev", "develop", "development", "local"],
      staging: ["stage", "staging", "uat", "test"],
      production: ["prod", "production", "live"],
    };
  }

  match(env1, env2) {
    const e1 = this._normalize(env1);
    const e2 = this._normalize(env2);

    // Null or undefined
    if (!e1 || !e2) {
      return e1 === e2 ? 10 : 0;
    }

    // Exact match
    if (e1 === e2) {
      return 10;
    }

    // Check aliases
    for (const [canonical, aliases] of Object.entries(this.aliases)) {
      const in1 = aliases.includes(e1);
      const in2 = aliases.includes(e2);

      if (in1 && in2) {
        return 10; // Same environment (alias match)
      }
    }

    return 0; // No match
  }

  /**
   * Get canonical environment name
   * @param {string} environment - Environment name
   * @returns {string} Canonical name
   */
  getCanonicalName(environment) {
    const e = this._normalize(environment);

    for (const [canonical, aliases] of Object.entries(this.aliases)) {
      if (aliases.includes(e)) {
        return canonical;
      }
    }

    return e;
  }
}

/**
 * HeaderMatcher - Match HTTP headers
 *
 * Features:
 * - Match specific headers by name
 * - Case-insensitive matching
 * - Partial scoring
 */
class HeaderMatcher {
  /**
   * Match headers
   * @param {Object} headers1 - First headers object
   * @param {Object} headers2 - Second headers object
   * @param {Array} matchHeaders - Headers to match
   * @returns {number} Match score (0-10)
   */
  match(headers1, headers2, matchHeaders = []) {
    if (matchHeaders.length === 0) {
      return 10; // No specific headers to match
    }

    let matches = 0;

    for (const headerName of matchHeaders) {
      const key = headerName.toLowerCase();
      const value1 = headers1[key];
      const value2 = headers2[key];

      if (value1 === value2) {
        matches++;
      }
    }

    // Calculate score based on match percentage
    const matchRatio = matches / matchHeaders.length;
    return Math.round(matchRatio * 10);
  }
}

/**
 * BodyMatcher - Match request body fields
 *
 * Features:
 * - Match specific JSON fields by path
 * - Deep object comparison
 * - Partial scoring
 */
class BodyMatcher {
  /**
   * Match body fields
   * @param {Object} body1 - First body object
   * @param {Object} body2 - Second body object
   * @param {Array} matchFields - Field paths to match (e.g., ['user.id', 'order.items'])
   * @returns {number} Match score (0-10)
   */
  match(body1, body2, matchFields = []) {
    if (matchFields.length === 0) {
      return 10; // No specific fields to match
    }

    if (!body1 || !body2) {
      return body1 === body2 ? 10 : 0;
    }

    let matches = 0;

    for (const fieldPath of matchFields) {
      const value1 = this._getPath(body1, fieldPath);
      const value2 = this._getPath(body2, fieldPath);

      if (this._deepEqual(value1, value2)) {
        matches++;
      }
    }

    // Calculate score based on match percentage
    const matchRatio = matches / matchFields.length;
    return Math.round(matchRatio * 10);
  }

  /**
   * Get value from object by path
   * @private
   */
  _getPath(obj, path) {
    const keys = path.split(".");
    let current = obj;

    for (const key of keys) {
      if (current === null || current === undefined) {
        return undefined;
      }
      current = current[key];
    }

    return current;
  }

  /**
   * Deep equality check
   * @private
   */
  _deepEqual(a, b) {
    if (a === b) return true;
    if (a === null || b === null) return false;
    if (typeof a !== "object" || typeof b !== "object") return false;

    const keysA = Object.keys(a);
    const keysB = Object.keys(b);

    if (keysA.length !== keysB.length) return false;

    for (const key of keysA) {
      if (!keysB.includes(key)) return false;
      if (!this._deepEqual(a[key], b[key])) return false;
    }

    return true;
  }
}

module.exports = {
  VersionMatcher,
  LanguageMatcher,
  PlatformMatcher,
  EnvironmentMatcher,
  HeaderMatcher,
  BodyMatcher,
};
