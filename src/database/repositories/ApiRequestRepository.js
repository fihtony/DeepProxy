/**
 * ApiRequestRepository - Repository for api_requests table
 *
 * Purpose:
 * - Manage HTTP request records
 * - Support complex queries by dimensions
 * - Handle request matching logic
 * - Provide statistics and analytics
 */

const BaseRepository = require("./BaseRepository");

class ApiRequestRepository extends BaseRepository {
  constructor(db) {
    super(db, "api_requests");
  }

  /**
   * Create API request record
   * @param {Object} requestData - Request data
   * @returns {Promise<number>} Created request ID
   */
  async createRequest(requestData) {
    const data = {
      user_id: requestData.userId,
      request_method: requestData.method,
      request_path: requestData.path,
      request_headers: JSON.stringify(requestData.headers || {}),
      request_body: requestData.body ? JSON.stringify(requestData.body) : null,
      app_version: requestData.appVersion ?? "", // Use empty string to avoid null in DB
      app_language: requestData.appLanguage ?? "", // Use empty string to avoid null in DB
      app_platform: requestData.appPlatform ?? "", // Use empty string to avoid null in DB
      app_environment: requestData.appEnvironment ?? "", // Use empty string to avoid null in DB
    };

    return await this.create(data);
  }

  /**
   * Find requests by user ID
   * @param {string} userId - User ID
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Array of requests
   */
  async findByUserId(userId, options = {}) {
    return await this.findBy(
      { user_id: userId },
      {
        orderBy: "created_at",
        orderDir: "DESC",
        ...options,
      }
    );
  }

  /**
   * Find requests by method and path
   * @param {string} method - HTTP method
   * @param {string} path - Request path
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Array of requests
   */
  async findByMethodAndPath(method, path, options = {}) {
    return await this.findBy({ request_method: method, request_path: path }, { orderBy: "created_at", orderDir: "DESC", ...options });
  }

  /**
   * Find requests matching specific dimensions
   * @param {Object} dimensions - Dimension criteria
   * @returns {Promise<Array>} Array of matching requests
   */
  async findByDimensions(dimensions) {
    const conditions = [];
    const params = [];

    // Basic criteria
    if (dimensions.userId !== undefined) {
      if (dimensions.userId === null) {
        conditions.push("user_id IS NULL");
      } else {
        conditions.push("user_id = ?");
        params.push(dimensions.userId);
      }
    }
    if (dimensions.method) {
      conditions.push("method = ?");
      params.push(dimensions.method);
    }
    if (dimensions.path) {
      conditions.push("endpoint_path = ?");
      params.push(dimensions.path);
    }

    // Query params matching
    if (dimensions.queryParams !== undefined) {
      if (dimensions.queryParams === null) {
        conditions.push("query_params IS NULL");
      } else {
        // Must match exact query params (JSON string comparison)
        const queryParamsJson = JSON.stringify(dimensions.queryParams);
        conditions.push("query_params = ?");
        params.push(queryParamsJson);
      }
    }

    // Dimension matching (mobile headers) - use LOWER() for case-insensitive comparison
    if (dimensions.appVersion) {
      conditions.push("app_version = ?");
      params.push(dimensions.appVersion);
    }
    if (dimensions.appLanguage) {
      conditions.push("LOWER(app_language) = LOWER(?)");
      params.push(dimensions.appLanguage);
    }
    if (dimensions.appPlatform) {
      conditions.push("LOWER(app_platform) = LOWER(?)");
      params.push(dimensions.appPlatform);
    }
    if (dimensions.appEnvironment) {
      conditions.push("LOWER(app_environment) = LOWER(?)");
      params.push(dimensions.appEnvironment);
    }

    const sql = `
      SELECT * FROM api_requests
      WHERE ${conditions.join(" AND ")}
      ORDER BY created_at DESC
    `;

    return await this.db.all(sql, params);
  }

  /**
   * Search for matching request (for replay mode)
   * @param {Object} searchCriteria - Search criteria with matching rules
   * @returns {Promise<Object|null>} Matching request or null
   */
  async findMatchingRequest(searchCriteria) {
    const {
      userId,
      method,
      path,
      appVersion,
      appLanguage,
      appPlatform,
      appEnvironment,
      matchVersion,
      matchLanguage,
      matchPlatform,
      matchEnvironment,
    } = searchCriteria;

    // Build WHERE conditions dynamically
    const conditions = ["user_id = ?", "method = ?", "endpoint_path = ?"];
    const params = [userId, method, path];

    if (matchVersion && appVersion) {
      conditions.push("app_version = ?");
      params.push(appVersion);
    }
    if (matchLanguage && appLanguage) {
      conditions.push("app_language = ?");
      params.push(appLanguage);
    }
    if (matchPlatform && appPlatform) {
      conditions.push("app_platform = ?");
      params.push(appPlatform);
    }
    if (matchEnvironment && appEnvironment) {
      conditions.push("app_environment = ?");
      params.push(appEnvironment);
    }

    const sql = `
      SELECT * FROM ${this.tableName}
      WHERE ${conditions.join(" AND ")}
      ORDER BY created_at DESC
      LIMIT 1
    `;

    return await this.db.get(sql, params);
  }

  /**
   * Get unique endpoints (method + path combinations)
   * @param {string} userId - User ID (optional)
   * @returns {Promise<Array>} Array of unique endpoints
   */
  async getUniqueEndpoints(userId = null) {
    let sql = `
      SELECT DISTINCT method, endpoint_path, 
             COUNT(*) as request_count,
             MAX(created_at) as last_request_at
      FROM ${this.tableName}
    `;
    const params = [];

    if (userId) {
      sql += " WHERE user_id = ?";
      params.push(userId);
    }

    sql += " GROUP BY method, endpoint_path ORDER BY request_count DESC";

    return await this.db.all(sql, params);
  }

  /**
   * Get statistics by dimension
   * @param {string} dimension - Dimension field (app_version, app_language, etc.)
   * @param {string} userId - User ID (optional)
   * @returns {Promise<Array>} Statistics array
   */
  async getStatsByDimension(dimension, userId = null) {
    const allowedDimensions = ["app_version", "app_language", "app_platform", "app_environment"];

    if (!allowedDimensions.includes(dimension)) {
      throw new Error(`Invalid dimension: ${dimension}`);
    }

    let sql = `
      SELECT ${dimension} as value,
             COUNT(*) as count,
             MAX(created_at) as last_seen
      FROM ${this.tableName}
      WHERE ${dimension} IS NOT NULL
    `;
    const params = [];

    if (userId) {
      sql += " AND user_id = ?";
      params.push(userId);
    }

    sql += ` GROUP BY ${dimension} ORDER BY count DESC`;

    return await this.db.all(sql, params);
  }

  /**
   * Get recent requests
   * @param {number} limit - Number of records
   * @param {string} userId - User ID (optional)
   * @returns {Promise<Array>} Array of recent requests
   */
  async getRecentRequests(limit = 50, userId = null) {
    const criteria = userId ? { user_id: userId } : null;
    return await this.findAll({
      where: criteria,
      orderBy: "created_at",
      orderDir: "DESC",
      limit,
    });
  }

  /**
   * Count requests by time period
   * @param {Date} startDate - Start date
   * @param {Date} endDate - End date
   * @param {string} userId - User ID (optional)
   * @returns {Promise<number>} Request count
   */
  async countByPeriod(startDate, endDate, userId = null) {
    let sql = `
      SELECT COUNT(*) as count FROM ${this.tableName}
      WHERE created_at >= ? AND created_at <= ?
    `;
    const params = [startDate.toISOString(), endDate.toISOString()];

    if (userId) {
      sql += " AND user_id = ?";
      params.push(userId);
    }

    const result = await this.db.get(sql, params);
    return result.count;
  }

  /**
   * Delete old requests
   * @param {Date} olderThan - Delete requests older than this date
   * @returns {Promise<number>} Number of deleted records
   */
  async deleteOldRequests(olderThan) {
    const sql = `DELETE FROM ${this.tableName} WHERE created_at < ?`;
    const result = await this.db.run(sql, [olderThan.toISOString()]);
    return result.changes;
  }
}

module.exports = ApiRequestRepository;
