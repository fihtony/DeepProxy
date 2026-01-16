/**
 * MatchingEngine - Core matching logic for finding recorded responses
 *
 * Purpose:
 * - Match incoming requests against recorded requests
 * - Support configurable matching strategies with fallback
 * - Use endpoint_matching_config rules
 * - Implement the matching rules from IMPORTANT_REQUEST_MATCHING_RULES_CN.md
 *
 * Matching Rules Summary:
 * - match_version: 1 = exact match, 0 = exact first, then closest version
 * - match_language: 1 = exact match, 0 = exact first, then "en", then any
 * - match_platform: 1 = exact match, 0 = exact first, then any
 * - match_environment: "exact" = exact match, "sit"/"stage"/"dev"/"prod" = force match specific env
 * - match_query_params: JSON array = match only specified params, null/empty = match all (normalized)
 * - match_headers: JSON array = match only specified headers, null/empty = no header matching
 * - match_response_status: "2xx"/"error"/"404"/"500"/specific code
 */

const logger = require("../../utils/logger");
const { normalizeQueryParams, scoreBodyFieldMatch, compareBodyMatchScores } = require("../../utils/jsonUtils");

class MatchingEngine {
  /**
   * @param {Object} repositories - Repository instances
   * @param {Object} matchers - Matcher instances (optional)
   */
  constructor(repositories, matchers = {}) {
    this.apiRequestRepo = repositories.apiRequestRepo;
    this.apiResponseRepo = repositories.apiResponseRepo;
    this.endpointConfigRepo = repositories.endpointConfigRepo;
    // Get db from repository (each repository has this.db)
    this.db = repositories.apiRequestRepo?.db || repositories.db;

    // Optional matchers for complex matching
    this.versionMatcher = matchers.versionMatcher;
    this.languageMatcher = matchers.languageMatcher;
    this.platformMatcher = matchers.platformMatcher;
  }

  /**
   * Find matching response for request
   * @param {RequestContext} requestContext - Request context
   * @param {string} mode - Mode type ('replay' or 'recording'), null for any type
   * @returns {Promise<Object|null>} Match result { request, response, score, matchDetails } or null
   */
  async findMatch(requestContext, mode = null) {
    const current = requestContext.getCurrent();
    const userId = requestContext.getMetadata("userId");
    const actualPath = requestContext.getActualPath();
    const httpMethod = current.method;

    logger.info("[MatchingEngine] Finding match", {
      userId,
      method: httpMethod,
      path: actualPath,
      mode: mode || "any",
    });

    // Step 1: Get endpoint matching configuration
    // Pass mode parameter to only find configurations for this specific mode
    const config = await this.endpointConfigRepo.findMatchingConfig(httpMethod, actualPath, mode);

    logger.info("[MatchingEngine] Config found", {
      hasConfig: !!config,
      configId: config?.id,
      endpoint_pattern: config?.endpoint_pattern,
      configType: config?.type,
    });

    // Step 2: Build search parameters from request context
    const searchParams = this._buildSearchParams(requestContext, actualPath, config);

    // Step 3: Execute multi-stage matching with fallback
    const match = await this._executeMatchingStrategy(searchParams, config);

    if (match) {
      logger.info("[MatchingEngine] Match found", {
        requestId: match.request.id,
        responseStatus: match.response?.response_status,
      });
    } else {
      logger.warn("[MatchingEngine] No match found", {
        method: httpMethod,
        path: actualPath,
      });
    }

    return match;
  }

  /**
   * Build search parameters from request context
   * @private
   */
  _buildSearchParams(requestContext, actualPath, config) {
    const current = requestContext.getCurrent();

    return {
      userId: requestContext.getMetadata("userId"),
      method: current.method,
      path: actualPath,
      queryParams: current.query && Object.keys(current.query).length > 0 ? current.query : null,
      requestBody: current.body || null,
      appVersion: requestContext.getMetadata("appVersion"),
      appLanguage: requestContext.getMetadata("appLanguage"),
      appPlatform: requestContext.getMetadata("appPlatform"),
      appEnvironment: requestContext.getMetadata("appEnvironment"),
      requestHeaders: current.headers,
    };
  }

  /**
   * Execute matching strategy with fallback logic
   * @private
   */
  async _executeMatchingStrategy(searchParams, config) {
    const { userId, method, path, queryParams, appVersion, appLanguage, appPlatform, appEnvironment, requestHeaders } = searchParams;

    // Determine if this is a secure endpoint (userId is not null)
    const isSecure = userId !== null;

    // Get response status filter from config
    const responseStatusFilter = config?.match_response_status || "2xx";

    // Build base WHERE conditions (always required)
    const baseConditions = [];
    const baseParams = [];

    // User ID matching
    if (isSecure) {
      baseConditions.push("ar.user_id = ?");
      baseParams.push(userId);
    } else {
      baseConditions.push("ar.user_id IS NULL");
    }

    // Method and path (exact match, case-insensitive)
    baseConditions.push("LOWER(ar.method) = LOWER(?)");
    baseParams.push(method);
    baseConditions.push("LOWER(ar.endpoint_path) = LOWER(?)");
    baseParams.push(path);

    // endpoint_type flag
    baseConditions.push("ar.endpoint_type = ?");
    baseParams.push(isSecure ? "secure" : "public");

    // Query params matching
    const queryCondition = this._buildQueryParamsCondition(queryParams, config);

    // Environment matching
    const envCondition = this._buildEnvironmentCondition(appEnvironment, config);
    if (envCondition.sql) {
      baseConditions.push(envCondition.sql);
      baseParams.push(...envCondition.params);
    }

    // Response status filter
    const responseCondition = this._buildResponseStatusCondition(responseStatusFilter);
    if (responseCondition.sql) {
      baseConditions.push(responseCondition.sql);
      baseParams.push(...responseCondition.params);
    }

    // Execute matching with fallback strategies
    // Strategy: Try exact match first for all dimensions, then apply fallback logic

    // Define dimension matching strategies
    const strategies = this._buildMatchingStrategies(searchParams, config);

    // Try each strategy in order
    for (const strategy of strategies) {
      const result = await this._tryMatchingStrategy(baseConditions, baseParams, strategy, searchParams, queryCondition, config);
      if (result) {
        return result;
      }
    }

    return null;
  }

  /**
   * Build query params matching condition
   *
   * Rules:
   * - If config has match_query_params array, do JavaScript filtering (partial match)
   * - If no config or empty, do exact match using normalized query params (sorted keys, lowercase)
   *
   * @private
   */
  _buildQueryParamsCondition(queryParams, config) {
    // If config has match_query_params array, return info for JavaScript filtering
    if (config?.match_query_params) {
      try {
        const matchParams = JSON.parse(config.match_query_params);
        if (Array.isArray(matchParams) && matchParams.length > 0) {
          // Return marker for JavaScript filtering - don't filter by SQL
          // We'll fetch all records and filter in _filterByQueryParams
          return { sql: null, params: [], matchQueryParams: matchParams, incomingQueryParams: queryParams };
        }
      } catch (e) {
        logger.warn("[MatchingEngine] Invalid match_query_params JSON", { error: e.message });
      }
    }

    // Default: exact match all query params using normalized comparison
    // NOTE: Database stores ORIGINAL query_params (preserving case), so we can't use simple SQL comparison
    // Instead, we return info for JavaScript filtering to compare normalized versions
    const { compareQueryParams } = require("../../utils/jsonUtils");
    return {
      sql: null,
      params: [],
      useNormalizedComparison: true,
      incomingQueryParams: queryParams,
    };
  }

  /**
   * Build environment matching condition
   * @private
   */
  _buildEnvironmentCondition(appEnvironment, config) {
    const matchEnvironment = config?.match_environment || "exact";

    if (matchEnvironment === "exact") {
      // Exact match (case-insensitive)
      if (appEnvironment) {
        return { sql: "LOWER(ar.app_environment) = LOWER(?)", params: [appEnvironment] };
      }
      return { sql: null, params: [] };
    }

    // Force match specific environment (ignore incoming request's environment)
    // match_environment = "sit" / "stage" / "dev" / "prod"
    return { sql: "LOWER(ar.app_environment) = LOWER(?)", params: [matchEnvironment] };
  }

  /**
   * Build response status condition
   * @private
   */
  _buildResponseStatusCondition(matchResponseStatus) {
    if (!matchResponseStatus || matchResponseStatus === "2xx") {
      return { sql: "ars.response_status >= 200 AND ars.response_status < 300", params: [] };
    }

    if (matchResponseStatus === "error") {
      return { sql: "ars.response_status >= 400", params: [] };
    }

    // Specific status code (e.g., "404", "500", "200")
    const statusCode = parseInt(matchResponseStatus, 10);
    if (!isNaN(statusCode)) {
      return { sql: "ars.response_status = ?", params: [statusCode] };
    }

    // Default to 2xx
    return { sql: "ars.response_status >= 200 AND ars.response_status < 300", params: [] };
  }

  /**
   * Build matching strategies based on config
   * @private
   */
  _buildMatchingStrategies(searchParams, config) {
    const { appVersion, appLanguage, appPlatform } = searchParams;
    const strategies = [];

    // Determine matching modes from config (default to exact match when no config)
    const versionMode = config ? config.match_version : 1; // 1 = exact, 0 = fallback
    const languageMode = config ? config.match_language : 1; // 1 = exact, 0 = fallback
    const platformMode = config ? config.match_platform : 1; // 1 = exact, 0 = fallback

    // Strategy 1: All exact matches (always try first)
    strategies.push({
      name: "exact",
      version: appVersion,
      versionMode: "exact",
      language: appLanguage,
      languageMode: "exact",
      platform: appPlatform,
      platformMode: "exact",
    });

    // Add fallback strategies based on config
    // Only add fallbacks if config allows (mode = 0)

    // Strategy 2: Version closest only (if allowed)
    if (versionMode === 0) {
      strategies.push({
        name: "version_closest",
        version: appVersion,
        versionMode: "closest",
        language: appLanguage,
        languageMode: "exact",
        platform: appPlatform,
        platformMode: "exact",
      });
    }

    // Strategy 3: Language fallback to "en" (if allowed and not already "en")
    if (languageMode === 0 && appLanguage && appLanguage.toLowerCase() !== "en") {
      strategies.push({
        name: "language_en",
        version: appVersion,
        versionMode: versionMode === 0 ? "closest" : "exact",
        language: "en",
        languageMode: "exact",
        platform: appPlatform,
        platformMode: "exact",
      });
    }

    // Strategy 4: Language fallback to any (if allowed)
    if (languageMode === 0) {
      strategies.push({
        name: "language_any",
        version: appVersion,
        versionMode: versionMode === 0 ? "closest" : "exact",
        language: null, // any language
        languageMode: "any",
        platform: appPlatform,
        platformMode: "exact",
      });
    }

    // Strategy 5: Platform fallback to any (if allowed)
    if (platformMode === 0) {
      strategies.push({
        name: "platform_any",
        version: appVersion,
        versionMode: versionMode === 0 ? "closest" : "exact",
        language: appLanguage,
        languageMode: languageMode === 0 ? "any" : "exact",
        platform: null, // any platform
        platformMode: "any",
      });
    }

    // Strategy 6: All fallbacks combined (if any fallback is allowed)
    if (versionMode === 0 || languageMode === 0 || platformMode === 0) {
      const allFallback = {
        name: "all_fallback",
        version: appVersion,
        versionMode: versionMode === 0 ? "closest" : "exact",
        language: null,
        languageMode: languageMode === 0 ? "any" : "exact",
        platform: null,
        platformMode: platformMode === 0 ? "any" : "exact",
      };

      // Avoid duplicate if this is same as a previous strategy
      const isDuplicate = strategies.some(
        (s) =>
          s.versionMode === allFallback.versionMode &&
          s.languageMode === allFallback.languageMode &&
          s.platformMode === allFallback.platformMode
      );

      if (!isDuplicate) {
        strategies.push(allFallback);
      }
    }

    return strategies;
  }

  /**
   * Try a specific matching strategy
   * @private
   */
  async _tryMatchingStrategy(baseConditions, baseParams, strategy, searchParams, queryCondition, config) {
    const conditions = [...baseConditions];
    const params = [...baseParams];

    // Add query params condition to SQL (if not doing JavaScript filtering)
    if (queryCondition.sql) {
      conditions.push(queryCondition.sql);
      params.push(...queryCondition.params);
    }

    // Add version condition
    if (strategy.versionMode === "exact" && strategy.version) {
      conditions.push("LOWER(ar.app_version) = LOWER(?)");
      params.push(strategy.version);
    }
    // If "closest", we don't add version condition in SQL, we'll sort and pick in JS

    // Add language condition
    if (strategy.languageMode === "exact" && strategy.language) {
      conditions.push("LOWER(ar.app_language) = LOWER(?)");
      params.push(strategy.language);
    }
    // If "any", we don't add language condition

    // Add platform condition
    if (strategy.platformMode === "exact" && strategy.platform) {
      conditions.push("LOWER(ar.app_platform) = LOWER(?)");
      params.push(strategy.platform);
    }
    // If "any", we don't add platform condition

    // Build and execute query
    const sql = `
      SELECT ar.*, ars.id as response_id, ars.response_status, ars.response_headers, 
             ars.response_body, ars.response_source, ars.latency_ms,
             ars.created_at as response_created_at, ars.updated_at as response_updated_at
      FROM api_requests ar
      INNER JOIN api_responses ars ON ar.id = ars.api_request_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY ar.updated_at DESC
    `;

    logger.debug("[MatchingEngine] Trying strategy", {
      strategy: strategy.name,
      sql: sql.replace(/\s+/g, " ").substring(0, 200),
      paramsCount: params.length,
    });

    const results = await this.db.all(sql, params);

    if (results.length === 0) {
      logger.debug("[MatchingEngine] No results for strategy", { strategy: strategy.name });
      return null;
    }

    logger.debug("[MatchingEngine] Found candidates", { strategy: strategy.name, count: results.length });

    // Apply additional filters in JavaScript
    let candidates = results;

    // Filter by query params (JavaScript filtering for case-insensitive comparison)
    if (queryCondition.useNormalizedComparison) {
      // Database stores ORIGINAL query_params, so we need to compare using normalized version
      const { compareQueryParams } = require("../../utils/jsonUtils");
      candidates = candidates.filter((candidate) => {
        const candidateParams = candidate.query_params ? JSON.parse(candidate.query_params) : null;
        return compareQueryParams(queryCondition.incomingQueryParams, candidateParams);
      });
      if (candidates.length === 0) {
        logger.error("[MatchingEngine] No candidates after normalized query params filter");
        return null;
      }
    } else if (queryCondition.matchQueryParams) {
      // Filter by specific match_query_params if specified (JavaScript filtering)
      candidates = this._filterByQueryParams(candidates, queryCondition.incomingQueryParams, queryCondition.matchQueryParams);
      if (candidates.length === 0) {
        logger.debug("[MatchingEngine] No candidates after query params filter");
        return null;
      }
    }

    // Filter by match_headers if specified
    if (config?.match_headers) {
      candidates = this._filterByHeaders(candidates, searchParams.requestHeaders, config);
      if (candidates.length === 0) {
        logger.debug("[MatchingEngine] No candidates after headers filter");
        return null;
      }
    }

    // Filter and sort by match_body if specified
    // This is for REPLAY mode - priority-based optional matching
    if (config?.match_body) {
      candidates = this._filterAndSortByBodyFields(candidates, searchParams.requestBody, config);
      // Note: We don't return null if no candidates match body fields
      // because match_body is optional for REPLAY mode - we just prefer matches
    }

    // For version closest mode, sort by version proximity
    if (strategy.versionMode === "closest" && strategy.version) {
      candidates = this._sortByVersionProximity(candidates, strategy.version);
    }

    // Return the best match
    const best = candidates[0];
    return this._buildMatchResult(best, strategy, config);
  }

  /**
   * Filter and sort candidates by body field matching
   * Used in REPLAY mode for priority-based optional body field matching
   *
   * Rules (from IMPORTANT_REQUEST_MATCHING_RULES_CN.md):
   * - match_body fields are optional, dProxy tries to match as many as possible
   * - Field order in match_body array defines priority (first = highest)
   * - Prefer candidates that match higher priority fields
   * - Among equal priority matches, prefer more matched fields
   *
   * @private
   */
  _filterAndSortByBodyFields(candidates, incomingBody, config) {
    if (!config?.match_body) {
      return candidates;
    }

    let matchBodyFields = null;
    try {
      matchBodyFields = JSON.parse(config.match_body);
      if (!Array.isArray(matchBodyFields) || matchBodyFields.length === 0) {
        return candidates;
      }
    } catch (e) {
      logger.warn("[MatchingEngine] Invalid match_body JSON", { error: e.message });
      return candidates;
    }

    // Score each candidate
    const scoredCandidates = candidates.map((candidate) => {
      const candidateBody = candidate.request_body;
      const score = scoreBodyFieldMatch(incomingBody, candidateBody, matchBodyFields);
      return { candidate, score };
    });

    // Sort by body match score
    scoredCandidates.sort((a, b) => {
      const comparison = compareBodyMatchScores(a.score, b.score);
      if (comparison !== 0) {
        return comparison;
      }
      // Same body match score, prefer newer record
      return new Date(b.candidate.updated_at) - new Date(a.candidate.updated_at);
    });

    logger.debug("[MatchingEngine] Sorted candidates by body field match", {
      totalCandidates: candidates.length,
      topScore: scoredCandidates[0]?.score,
    });

    // Return candidates in sorted order
    return scoredCandidates.map((sc) => sc.candidate);
  }

  /**
   * Build match result object
   * @private
   */
  _buildMatchResult(record, strategy, config) {
    return {
      request: {
        id: record.id,
        user_id: record.user_id,
        method: record.method,
        endpoint_path: record.endpoint_path,
        query_params: record.query_params,
        app_version: record.app_version,
        app_language: record.app_language,
        app_platform: record.app_platform,
        app_environment: record.app_environment,
        request_headers: record.request_headers,
        request_body: record.request_body,
        endpoint_type: record.endpoint_type,
        created_at: record.created_at,
        updated_at: record.updated_at,
      },
      response: {
        id: record.response_id,
        api_request_id: record.id,
        response_status: record.response_status,
        response_headers: record.response_headers,
        response_body: record.response_body,
        response_source: record.response_source,
        latency_ms: record.latency_ms,
        created_at: record.response_created_at,
        updated_at: record.response_updated_at,
      },
      score: 100,
      matchDetails: {
        strategy: strategy.name,
        configId: config?.id,
        configPattern: config?.endpoint_pattern,
      },
    };
  }

  /**
   * Filter candidates by query params (partial match based on config)
   *
   * Rules (from IMPORTANT_REQUEST_MATCHING_RULES_CN.md):
   * - If match_query_params is specified, only match those params (case-insensitive for both key and value)
   * - If incoming request has additional optional params, prefer records that also have those params
   * - Example: match_query_params = ["userId"], incoming: ?userId=123&deviceId=abc
   *   - Record 1: ?userid=123 (matches required param)
   *   - Record 2: ?userid=123&deviceId=789 (matches required + has optional)
   *   - Should prefer Record 2 if it also matches deviceId value
   * - If no match_query_params config, use exact match (normalized comparison)
   *
   * @private
   */
  _filterByQueryParams(candidates, incomingParams, matchParamNames) {
    if (!matchParamNames || matchParamNames.length === 0) {
      return candidates;
    }

    // Convert match param names to lowercase for case-insensitive key matching
    const lowerMatchParamNames = matchParamNames.map((p) => p.toLowerCase());

    // Get incoming param keys that are not in required match list (optional params)
    const incomingParamKeys = incomingParams ? Object.keys(incomingParams).map((k) => k.toLowerCase()) : [];
    const optionalParamKeys = incomingParamKeys.filter((k) => !lowerMatchParamNames.includes(k));

    // Helper: get param value case-insensitively
    const getParamValue = (params, keyName) => {
      if (!params) return null;
      const lowerKey = keyName.toLowerCase();
      for (const [key, value] of Object.entries(params)) {
        if (key.toLowerCase() === lowerKey) {
          return value;
        }
      }
      return null;
    };

    // First filter: only keep candidates that match all required params
    const matchingCandidates = candidates.filter((candidate) => {
      try {
        const candidateParams = candidate.query_params ? JSON.parse(candidate.query_params) : {};

        // Check all required params match (case-insensitive key and value)
        for (const paramName of matchParamNames) {
          const incomingValue = getParamValue(incomingParams, paramName);
          const candidateValue = getParamValue(candidateParams, paramName);

          // Case-insensitive value comparison
          const incomingStr = incomingValue != null ? String(incomingValue).toLowerCase() : "";
          const candidateStr = candidateValue != null ? String(candidateValue).toLowerCase() : "";

          if (incomingStr !== candidateStr) {
            return false;
          }
        }
        return true;
      } catch (e) {
        logger.warn("[MatchingEngine] Error parsing query params", { error: e.message });
        return false;
      }
    });

    if (matchingCandidates.length === 0) {
      return [];
    }

    // If no optional params in incoming request, return all matching candidates
    if (optionalParamKeys.length === 0) {
      return matchingCandidates;
    }

    // Second pass: score candidates by how many optional params they match
    // Prefer candidates that have matching optional params
    const scoredCandidates = matchingCandidates.map((candidate) => {
      try {
        const candidateParams = candidate.query_params ? JSON.parse(candidate.query_params) : {};
        let matchScore = 0;

        for (const optionalKey of optionalParamKeys) {
          const incomingValue = getParamValue(incomingParams, optionalKey);
          const candidateValue = getParamValue(candidateParams, optionalKey);

          if (candidateValue !== null && candidateValue !== undefined) {
            // Candidate has this optional param
            const incomingStr = incomingValue != null ? String(incomingValue).toLowerCase() : "";
            const candidateStr = String(candidateValue).toLowerCase();

            if (incomingStr === candidateStr) {
              matchScore += 2; // Full match (key + value)
            } else {
              matchScore += 1; // Has the key but different value
            }
          }
        }

        return { candidate, matchScore };
      } catch (e) {
        return { candidate, matchScore: 0 };
      }
    });

    // Sort by match score (higher first), then by updated_at (newer first)
    scoredCandidates.sort((a, b) => {
      if (b.matchScore !== a.matchScore) {
        return b.matchScore - a.matchScore;
      }
      // Same score, prefer newer record
      return new Date(b.candidate.updated_at) - new Date(a.candidate.updated_at);
    });

    // Return candidates in sorted order
    return scoredCandidates.map((sc) => sc.candidate);
  }

  /**
   * Filter candidates by headers
   * @private
   */
  _filterByHeaders(candidates, requestHeaders, config) {
    if (!config?.match_headers) {
      return candidates;
    }

    try {
      const matchHeaders = JSON.parse(config.match_headers);
      if (!Array.isArray(matchHeaders) || matchHeaders.length === 0) {
        return candidates;
      }

      return candidates.filter((candidate) => {
        try {
          const candidateHeaders = candidate.request_headers ? JSON.parse(candidate.request_headers) : {};

          for (const headerName of matchHeaders) {
            const lowerHeaderName = headerName.toLowerCase();

            // Find header in incoming request (headers are case-insensitive)
            const incomingValue = this._findHeader(requestHeaders, headerName);
            const candidateValue = this._findHeader(candidateHeaders, headerName);

            if (String(incomingValue || "").toLowerCase() !== String(candidateValue || "").toLowerCase()) {
              return false;
            }
          }
          return true;
        } catch (e) {
          logger.warn("[MatchingEngine] Error parsing headers", { error: e.message });
          return false;
        }
      });
    } catch (e) {
      logger.warn("[MatchingEngine] Error parsing match_headers config", { error: e.message });
      return candidates;
    }
  }

  /**
   * Find header value (case-insensitive)
   * @private
   */
  _findHeader(headers, headerName) {
    if (!headers) return null;
    const lowerName = headerName.toLowerCase();
    for (const [key, value] of Object.entries(headers)) {
      if (key.toLowerCase() === lowerName) {
        return value;
      }
    }
    return null;
  }

  /**
   * Sort candidates by version proximity
   * @private
   */
  _sortByVersionProximity(candidates, targetVersion) {
    const parseVersion = (v) => {
      if (!v) return [0, 0, 0];
      const parts = String(v)
        .split(".")
        .map((p) => parseInt(p, 10) || 0);
      return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
    };

    const target = parseVersion(targetVersion);

    const calculateDistance = (v) => {
      const parts = parseVersion(v);
      // Weight major > minor > patch
      return Math.abs(target[0] - parts[0]) * 10000 + Math.abs(target[1] - parts[1]) * 100 + Math.abs(target[2] - parts[2]);
    };

    return candidates.sort((a, b) => {
      const distA = calculateDistance(a.app_version);
      const distB = calculateDistance(b.app_version);
      if (distA !== distB) {
        return distA - distB; // Closer version first
      }
      // If same distance, prefer the one updated more recently
      return new Date(b.updated_at) - new Date(a.updated_at);
    });
  }

  /**
   * Find all possible matches with scores (for debugging)
   * @param {RequestContext} requestContext - Request context
   * @returns {Promise<Array>} Array of matches with scores
   */
  async findAllMatches(requestContext) {
    const match = await this.findMatch(requestContext);
    return match ? [match] : [];
  }

  /**
   * Check if request has matching response
   * @param {RequestContext} requestContext - Request context
   * @returns {Promise<boolean>} True if match exists
   */
  async hasMatch(requestContext) {
    const match = await this.findMatch(requestContext);
    return match !== null;
  }

  /**
   * Get match statistics
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Match statistics
   */
  async getMatchStats(userId) {
    const endpoints = await this.apiRequestRepo.getUniqueEndpoints(userId);

    const stats = {
      totalEndpoints: endpoints.length,
      totalRequests: 0,
      matchableRequests: 0,
      unmatchableRequests: 0,
    };

    for (const endpoint of endpoints) {
      stats.totalRequests += endpoint.request_count;

      const config = await this.endpointConfigRepo.findMatchingConfig(endpoint.request_method, endpoint.request_path);

      if (config && config.enabled) {
        stats.matchableRequests += endpoint.request_count;
      } else {
        stats.unmatchableRequests += endpoint.request_count;
      }
    }

    return stats;
  }
}

module.exports = MatchingEngine;
