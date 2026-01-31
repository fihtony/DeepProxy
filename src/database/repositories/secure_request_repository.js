/**
 * Secure Request Repository
 *
 * Handles caching and retrieval of secure endpoint requests/responses.
 * Maintains retention limit: keeps only the latest 3 DIFFERENT responses per user/endpoint.
 *
 * Secure endpoints are user-specific and IGNORE app_version for matching.
 * Uses response body hash comparison to avoid storing duplicate responses.
 *
 * @module repositories/secure_request_repository
 */

const dbConnection = require("../connection");
const crypto = require("../../utils/crypto");
const logger = require("../../utils/logger");
const { getLocalISOString } = require("../../utils/datetimeUtils");
const { getEndpointName, isSecureEndpoint, getEndpointType } = require("../../utils/endpoint_utils");
const { serializeBody } = require("../../utils/bodySerializer");
const { normalizeQueryParams, compareQueryParams, compareQueryParamsPartial, compareBodyFields } = require("../../utils/jsonUtils");

/**
 * Get recording config for endpoint matching (type='recording')
 * @param {Object} db - Database connection
 * @param {string} method - HTTP method
 * @param {string} endpointPath - Endpoint path
 * @returns {Object|null} Matching config or null
 */
function getRecordingConfig(db, method, endpointPath) {
  try {
    // Get all enabled recording configs ordered by priority ASC (lower = higher priority)
    const configs = db
      .prepare(
        `
      SELECT * FROM endpoint_matching_config
      WHERE enabled = 1 AND type = 'recording'
      ORDER BY priority ASC
    `,
      )
      .all();

    // Find first matching config
    for (const config of configs) {
      if (config.http_method === method || config.http_method === "*") {
        if (matchesPattern(endpointPath, config.endpoint_pattern)) {
          return config;
        }
      }
    }
    return null;
  } catch (e) {
    // Table might not exist or other error - return null
    return null;
  }
}

/**
 * Check if path matches pattern
 * @param {string} path - Request path
 * @param {string} pattern - Endpoint pattern (may contain :id or *)
 * @returns {boolean} True if matches
 */
function matchesPattern(path, pattern) {
  const regexPattern = pattern
    .replace(/:[^/]+/g, "[^/]+")
    .replace(/\*/g, ".*")
    .replace(/\//g, "\\/");

  const regex = new RegExp(`^${regexPattern}$`, "i");
  return regex.test(path);
}

/**
 * Find existing secure request by matching criteria
 * Matches: user_id, endpoint_path, method, query_params (based on config or full match),
 * request_body (based on match_body config), app_platform, app_version,
 * app_environment, app_language, is_secure=1
 *
 * If recording config exists with match_query_params, only those params are compared.
 * Otherwise, full query_params comparison is used.
 *
 * If recording config exists with match_body, the specified body fields are compared.
 * All specified fields must match for the request to be considered the same.
 *
 * @param {Object} db - Database connection
 * @param {number} userId - User ID
 * @param {string} endpointPath - Endpoint path
 * @param {string} method - HTTP method
 * @param {string|null} normalizedQueryParamsJson - Normalized query parameters JSON string (or null)
 * @param {Object} mobileHeaders - Mobile headers
 * @param {Object|null} incomingQueryParams - Original incoming query params object (for partial matching)
 * @param {Object|null} incomingBody - Incoming request body (for body field matching)
 * @returns {Object|null} Existing request or null
 */
function findExistingSecureRequest(
  db,
  userId,
  endpointPath,
  method,
  normalizedQueryParamsJson,
  mobileHeaders,
  incomingQueryParams = null,
  incomingBody = null,
) {
  // Check for recording config with match_query_params and match_body
  const recordingConfig = getRecordingConfig(db, method, endpointPath);
  let matchQueryParams = null;
  let matchBodyFields = null;

  if (recordingConfig) {
    // Parse match_query_params
    if (recordingConfig.match_query_params) {
      try {
        matchQueryParams = JSON.parse(recordingConfig.match_query_params);
        if (!Array.isArray(matchQueryParams) || matchQueryParams.length === 0) {
          matchQueryParams = null;
        }
      } catch (e) {
        matchQueryParams = null;
      }
    }

    // Parse match_body
    if (recordingConfig.match_body) {
      try {
        matchBodyFields = JSON.parse(recordingConfig.match_body);
        if (!Array.isArray(matchBodyFields) || matchBodyFields.length === 0) {
          matchBodyFields = null;
        }
      } catch (e) {
        matchBodyFields = null;
      }
    }
  }

  // Get candidates with matching basic criteria
  // Include request_body for body field matching
  // NOTE: Handle user_id=null case properly - NULL comparisons need IS NULL in SQL
  const candidates = db.prepare(`
    SELECT id, query_params, request_body FROM api_requests
    WHERE (user_id = ? OR (? IS NULL AND user_id IS NULL))
      AND endpoint_path = ?
      AND method = ?
      AND app_platform = ?
      AND app_version = ?
      AND app_environment = ?
      AND app_language = ?
      AND endpoint_type = 'secure'
  `);

  const candidateResults = candidates.all(
    userId,
    userId, // Used for NULL check in OR clause
    endpointPath,
    method,
    mobileHeaders.mobilePlatform || "", // Use empty string if not found
    mobileHeaders.mobileVersion || "", // Use empty string if not found
    mobileHeaders.mobileEnvironment || "", // Use empty string if not found
    mobileHeaders.acceptLanguage || "en", // Default to "en" if not found
  );

  // Filter by query params first
  let filteredCandidates = [];

  if (matchQueryParams && matchQueryParams.length > 0) {
    // Partial matching mode for query params
    for (const candidate of candidateResults) {
      if (compareQueryParamsPartial(incomingQueryParams || normalizedQueryParamsJson, candidate.query_params, matchQueryParams)) {
        filteredCandidates.push(candidate);
      }
    }
  } else {
    // Full matching mode for query params
    for (const candidate of candidateResults) {
      if (compareQueryParams(candidate.query_params, normalizedQueryParamsJson)) {
        filteredCandidates.push(candidate);
      }
    }
  }

  if (filteredCandidates.length === 0) {
    return null;
  }

  // Filter by body fields if match_body is configured
  if (matchBodyFields && matchBodyFields.length > 0) {
    filteredCandidates = filteredCandidates.filter((candidate) => {
      return compareBodyFields(incomingBody, candidate.request_body, matchBodyFields);
    });
  }

  if (filteredCandidates.length === 0) {
    return null;
  }

  // If multiple matches, prefer the one with most query params (most specific match)
  let bestMatch = filteredCandidates[0];
  let bestMatchParamCount = 0;

  try {
    const params = bestMatch.query_params ? JSON.parse(bestMatch.query_params) : {};
    bestMatchParamCount = Object.keys(params).length;
  } catch (e) {
    bestMatchParamCount = 0;
  }

  for (let i = 1; i < filteredCandidates.length; i++) {
    const candidate = filteredCandidates[i];
    let candidateParamCount = 0;
    try {
      const params = candidate.query_params ? JSON.parse(candidate.query_params) : {};
      candidateParamCount = Object.keys(params).length;
    } catch (e) {
      candidateParamCount = 0;
    }

    if (candidateParamCount > bestMatchParamCount) {
      bestMatch = candidate;
      bestMatchParamCount = candidateParamCount;
    }
  }

  return bestMatch;
}

/**
 * Save a secure endpoint request/response
 * Automatically cleans up old user requests after insertion to maintain 3-response limit
 *
 * Note: query_params are normalized (sorted keys, lowercase) before storage for consistent matching
 *
 * @param {number} userId - User ID
 * @param {string} endpoint - Endpoint path or name
 * @param {string} method - HTTP method (GET, POST, etc.)
 * @param {Object} queryParams - Query parameters
 * @param {Object} headers - Request headers
 * @param {Object} body - Request body
 * @param {Object} response - Response object
 * @param {number} response.status - HTTP status code
 * @param {Object} response.headers - Response headers
 * @param {Object} response.body - Response body
 * @param {Object} mobileHeaders - Mobile app headers
 * @param {string} mobileHeaders.platform - android/ios
 * @param {string} mobileHeaders.version - App version (ignored in matching)
 * @param {string} mobileHeaders.environment - sit/stage/dev/prod
 * @param {string} mobileHeaders.language - en/fr
 * @param {number} duration - Request duration in milliseconds
 * @param {string} correlationId - x-correlation-id for tracing
 * @param {string} traceabilityId - x-traceability-id for tracing
 * @param {string} endpointType - 'transmit', 'secure', or 'public' (default: 'secure')
 * @returns {Object} Created request object
 * @throws {Error} If save fails
 */
async function saveSecureRequest(
  userId,
  endpoint,
  method,
  queryParams = null,
  headers = {},
  body = null,
  response = {},
  mobileHeaders = {},
  duration = null,
  correlationId = null,
  traceabilityId = null,
  endpointType = "secure",
  host = null,
) {
  try {
    const db = dbConnection.getDatabaseSync();

    // Store original query params for database (preserves original case)
    // For matching, we'll use normalized version in findExistingSecureRequest
    const originalQueryParamsJson = queryParams ? JSON.stringify(queryParams) : null;

    // Create normalized version for matching/comparison
    const normalizedQueryParamsJson = normalizeQueryParams(queryParams);

    const headersJson = JSON.stringify(headers);
    const bodyJson = serializeBody(body);
    const responseHeadersJson = response && response.headers ? JSON.stringify(response.headers) : null;
    const responseBodyJson = serializeBody(response && response.body);

    // Calculate response body hash for deduplication
    const responseBodyHash = response && response.body ? crypto.hashResponseBody(response.body) : null;

    // Determine endpoint name and path - handle null endpoint
    // Note: getEndpointName is imported from endpoint_utils to ensure consistency with request_classifier
    const endpointName = endpoint ? getEndpointName(endpoint) : "unknown";
    const endpointPath = endpoint || "unknown";

    // Check if response is successful (2xx status)
    const isSuccessful = response && response.status >= 200 && response.status < 300;

    // Use ISO 8601 timestamp with timezone
    const createdAt = getLocalISOString();

    // Check if a matching request already exists (using normalized query params for comparison)
    // Pass original queryParams for partial matching when recording config exists
    // Pass body for body field matching when recording config has match_body
    const existingRequest = findExistingSecureRequest(
      db,
      userId,
      endpointPath,
      method,
      normalizedQueryParamsJson,
      mobileHeaders,
      queryParams,
      body,
    );

    let requestId;

    if (existingRequest) {
      // Update existing request
      requestId = existingRequest.id;

      const updateStmt = db.prepare(`
        UPDATE api_requests
        SET
          query_params = ?,
          request_body = ?,
          request_headers = ?,
          correlation_id = ?,
          traceability_id = ?,
          updated_at = ?
        WHERE id = ?
      `);

      updateStmt.run(originalQueryParamsJson, bodyJson, headersJson, correlationId, traceabilityId, createdAt, requestId);

      logger.info(`Secure request updated: ${endpointName} (ID: ${requestId})`);
    } else {
      // Insert new request with original query params
      const stmt = db.prepare(`
        INSERT INTO api_requests (
          user_id,
          host,
          endpoint_path,
          endpoint_name,
          method,
          query_params,
          request_headers,
          request_body,
          app_platform,
          app_version,
          app_environment,
          app_language,
          endpoint_type,
          correlation_id,
          traceability_id,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const result = stmt.run(
        userId,
        host || null,
        endpointPath,
        endpointName,
        method,
        originalQueryParamsJson,
        headersJson,
        bodyJson,
        mobileHeaders.mobilePlatform || "", // Use empty string for unknown values
        mobileHeaders.mobileVersion || "", // Use empty string for unknown values
        mobileHeaders.mobileEnvironment || "", // Use empty string for unknown values
        mobileHeaders.acceptLanguage || "en", // Default to "en" for unknown values
        "secure", // endpoint_type
        correlationId,
        traceabilityId,
        createdAt,
        createdAt,
      );

      requestId = result.lastInsertRowid;

      logger.info(`Secure request inserted for user ${userId}: ${endpointName} (ID: ${requestId})`);
    }

    // Handle response - check if response with same status already exists
    if (response && response.status) {
      const existingResponse = db
        .prepare(
          `
        SELECT id, latency_ms, count FROM api_responses
        WHERE api_request_id = ? AND response_status = ?
        LIMIT 1
      `,
        )
        .get(requestId, response.status);

      if (existingResponse) {
        // Update existing response with weighted average latency calculation
        // Formula: new_latency = (old_latency * old_count + current_latency) / (old_count + 1)
        const oldLatency = existingResponse.latency_ms || 0;
        const oldCount = existingResponse.count || 1;
        const newCount = oldCount + 1;
        const newLatency = Math.round((oldLatency * oldCount + (duration || 0)) / newCount);

        const updateResStmt = db.prepare(`
          UPDATE api_responses
          SET
            response_body = ?,
            response_headers = ?,
            response_body_hash = ?,
            response_source = ?,
            latency_ms = ?,
            count = ?,
            updated_at = ?
          WHERE id = ?
        `);

        updateResStmt.run(
          responseBodyJson,
          responseHeadersJson,
          responseBodyHash,
          "backend",
          newLatency,
          newCount,
          createdAt,
          existingResponse.id,
        );

        logger.info(
          `Secure response updated with weighted average latency: ${endpointName} status ${response.status} (Response ID: ${existingResponse.id})`,
          {
            oldLatency,
            oldCount,
            currentLatency: duration,
            newLatency,
            newCount,
          },
        );
      } else {
        // Insert new response
        const resStmt = db.prepare(`
          INSERT INTO api_responses (
            api_request_id,
            response_status,
            response_headers,
            response_body,
            response_body_hash,
            response_source,
            is_successful,
            count,
            latency_ms,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        resStmt.run(
          requestId,
          response.status,
          responseHeadersJson,
          responseBodyJson,
          responseBodyHash,
          "backend",
          isSuccessful ? 1 : 0,
          1,
          duration,
          createdAt,
          createdAt,
        );

        logger.info(`Secure response inserted: ${endpointName} status ${response.status}`);
      }
    }
    // TODO: Fix cleanupOldUserRequests to work with new api_requests/api_responses split
    // Cleanup old requests after insert
    // cleanupOldUserRequests(userId, endpointName, mobileHeaders);

    return getRequestById(requestId);
  } catch (error) {
    logger.error("Failed to save secure request:", error);
    throw new Error(`Failed to save secure request: ${error.message}`);
  }
}

/**
 * Get request by ID
 *
 * @param {number} requestId - Request ID
 * @returns {Object|null} Request object or null
 */
function getRequestById(requestId) {
  try {
    const db = dbConnection.getDatabaseSync();

    const stmt = db.prepare(`
      SELECT 
        r.id,
        r.user_id,
        r.endpoint_path,
        r.endpoint_name,
        r.method,
        r.query_params,
        r.request_headers,
        r.request_body,
        r.app_platform,
        r.app_version,
        r.app_environment,
        r.app_language,
        r.correlation_id,
        r.created_at,
        r.updated_at,
        resp.response_status,
        resp.response_headers,
        resp.response_body,
        resp.response_body_hash,
        resp.is_successful,
        resp.latency_ms as duration_ms
      FROM api_requests r
      LEFT JOIN api_responses resp ON r.id = resp.api_request_id
      WHERE r.id = ? AND r.endpoint_type = 'secure'
    `);

    const request = stmt.get(requestId);

    if (!request) {
      return null;
    }

    return parseRequestObject(request);
  } catch (error) {
    logger.error(`Failed to get request by ID ${requestId}:`, error);
    throw new Error(`Failed to get request: ${error.message}`);
  }
}

/**
 * Update response body for a request
 * Useful for manual data corrections or testing
 *
 * @param {number} requestId - Request ID
 * @param {Object} newResponseBody - New response body
 * @returns {Object} Updated request object
 */
function updateResponseBody(requestId, newResponseBody) {
  try {
    const db = dbConnection.getDatabaseSync();

    const responseBodyJson = JSON.stringify(newResponseBody);
    const responseBodyHash = crypto.hashResponseBody(newResponseBody);
    const updatedAt = getLocalISOString();

    // Update response in api_responses table
    const stmt = db.prepare(`
      UPDATE api_responses
      SET 
        response_body = ?,
        response_body_hash = ?,
        updated_at = ?
      WHERE api_request_id = ?
    `);

    const result = stmt.run(responseBodyJson, responseBodyHash, updatedAt, requestId);

    if (result.changes === 0) {
      throw new Error(`Secure request ${requestId} not found`);
    }

    logger.info(`Updated response body for secure request ${requestId}`);

    return getRequestById(requestId);
  } catch (error) {
    logger.error(`Failed to update response body for request ${requestId}:`, error);
    throw new Error(`Failed to update response body: ${error.message}`);
  }
}

/**
 * Helper: Parse request object, safely handling non-JSON content
 * If a field cannot be parsed as JSON, keep the original string value
 *
 * @param {Object} request - Request object from database
 * @returns {Object} Parsed request object with parsed JSON fields where possible
 */
function parseRequestObject(request) {
  // Helper to safely parse JSON field
  const safeJsonParse = (field, defaultValue = null) => {
    if (!field) return defaultValue;
    try {
      return JSON.parse(field);
    } catch (e) {
      // Return as-is if not valid JSON (could be plain text, HTML, etc.)
      // This handles cases where response body might be HTML or plain text
      return field;
    }
  };

  try {
    return {
      ...request,
      query_params: safeJsonParse(request.query_params, null),
      request_headers: safeJsonParse(request.request_headers, {}),
      request_body: safeJsonParse(request.request_body, null),
      response_headers: safeJsonParse(request.response_headers, {}),
      response_body: safeJsonParse(request.response_body, null),
    };
  } catch (error) {
    // Fallback: if even the safe parsing fails, return original object
    // and log a warning (not an error) since this is expected behavior
    // for some responses like HTML error pages
    logger.error(`Failed to parse request object ${request?.id}:`, error.message);
    return request;
  }
}

module.exports = {
  saveSecureRequest,
  getRequestById,
  updateResponseBody,
};
