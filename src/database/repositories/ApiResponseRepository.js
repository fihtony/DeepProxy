/**
 * ApiResponseRepository - Repository for api_responses table
 *
 * Purpose:
 * - Manage HTTP response records
 * - Link responses to requests
 * - Support template-based responses
 * - Provide response analytics
 */

const BaseRepository = require("./BaseRepository");

class ApiResponseRepository extends BaseRepository {
  constructor(db) {
    super(db, "api_responses");
  }

  /**
   * Create API response record
   * @param {Object} responseData - Response data
   * @returns {Promise<number>} Created response ID
   */
  async createResponse(responseData) {
    const data = {
      api_request_id: responseData.apiRequestId,
      response_status: responseData.status,
      response_headers: JSON.stringify(responseData.headers || {}),
      response_body: responseData.body ? JSON.stringify(responseData.body) : null,
      response_source: responseData.source || "backend",
      template_id: responseData.templateId || null,
      latency_ms: responseData.latency || null,
    };

    return await this.create(data);
  }

  /**
   * Find response by request ID
   * @param {number} requestId - Request ID
   * @returns {Promise<Object|null>} Response or null
   */
  async findByRequestId(requestId) {
    return await this.findOne({ api_request_id: requestId });
  }

  /**
   * Find all responses for a request ID
   * @param {number} requestId - Request ID
   * @returns {Promise<Array>} Array of responses
   */
  async findAllByRequestId(requestId) {
    return await this.findBy(
      { api_request_id: requestId },
      {
        orderBy: "created_at",
        orderDir: "DESC",
      }
    );
  }

  /**
   * Find responses by source
   * @param {string} source - Response source ('backend', 'dproxy', 'custom')
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Array of responses
   */
  async findBySource(source, options = {}) {
    return await this.findBy(
      { response_source: source },
      {
        orderBy: "created_at",
        orderDir: "DESC",
        ...options,
      }
    );
  }

  /**
   * Find responses by template ID
   * @param {number} templateId - Template ID
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Array of responses
   */
  async findByTemplateId(templateId, options = {}) {
    return await this.findBy(
      { template_id: templateId },
      {
        orderBy: "created_at",
        orderDir: "DESC",
        ...options,
      }
    );
  }

  /**
   * Find responses by status code
   * @param {number} status - HTTP status code
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Array of responses
   */
  async findByStatus(status, options = {}) {
    return await this.findBy(
      { response_status: status },
      {
        orderBy: "created_at",
        orderDir: "DESC",
        ...options,
      }
    );
  }

  /**
   * Get response with request details (JOIN query)
   * @param {number} responseId - Response ID
   * @returns {Promise<Object|null>} Combined response and request data
   */
  async findWithRequest(responseId) {
    const sql = `
      SELECT 
        r.*,
        req.user_id,
        req.method,
        req.request_path,
        req.app_version,
        req.app_language,
        req.app_platform,
        req.app_environment
      FROM ${this.tableName} r
      INNER JOIN api_requests req ON r.api_request_id = req.id
      WHERE r.id = ?
    `;

    return await this.db.get(sql, [responseId]);
  }

  /**
   * Get responses with request details by criteria
   * @param {Object} criteria - Search criteria
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Array of combined data
   */
  async findWithRequests(criteria = {}, options = {}) {
    let sql = `
      SELECT 
        r.*,
        req.user_id,
        req.method,
        req.request_path,
        req.request_headers,
        req.request_body,
        req.app_version,
        req.app_language,
        req.app_platform,
        req.app_environment,
        req.created_at as request_created_at
      FROM ${this.tableName} r
      INNER JOIN api_requests req ON r.api_request_id = req.id
    `;

    const params = [];

    // Add WHERE clause
    if (Object.keys(criteria).length > 0) {
      const conditions = [];
      for (const [key, value] of Object.entries(criteria)) {
        conditions.push(`r.${key} = ?`);
        params.push(value);
      }
      sql += ` WHERE ${conditions.join(" AND ")}`;
    }

    // Add ORDER BY
    sql += ` ORDER BY r.created_at DESC`;

    // Add LIMIT
    if (options.limit) {
      sql += ` LIMIT ?`;
      params.push(options.limit);
    }

    return await this.db.all(sql, params);
  }

  /**
   * Update response status
   * @param {number} responseId - Response ID
   * @param {number} status - New status code
   * @returns {Promise<number>} Number of affected rows
   */
  async updateStatus(responseId, status) {
    return await this.update(responseId, { response_status: status });
  }

  /**
   * Update response body
   * @param {number} responseId - Response ID
   * @param {*} body - New response body
   * @returns {Promise<number>} Number of affected rows
   */
  async updateBody(responseId, body) {
    return await this.update(responseId, {
      response_body: JSON.stringify(body),
      response_source: "custom",
    });
  }

  /**
   * Update entire response
   * @param {number} responseId - Response ID
   * @param {Object} responseData - Updated response data
   * @returns {Promise<number>} Number of affected rows
   */
  async updateResponse(responseId, responseData) {
    const data = {};

    if (responseData.status !== undefined) {
      data.response_status = responseData.status;
    }
    if (responseData.headers !== undefined) {
      data.response_headers = JSON.stringify(responseData.headers);
    }
    if (responseData.body !== undefined) {
      data.response_body = JSON.stringify(responseData.body);
    }
    if (responseData.source !== undefined) {
      data.response_source = responseData.source;
    }

    return await this.update(responseId, data);
  }

  /**
   * Get statistics by status code
   * @param {string} userId - User ID (optional via JOIN)
   * @returns {Promise<Array>} Statistics array
   */
  async getStatsByStatus(userId = null) {
    let sql = `
      SELECT 
        r.response_status as status,
        COUNT(*) as count,
        AVG(r.latency_ms) as avg_latency,
        MIN(r.latency_ms) as min_latency,
        MAX(r.latency_ms) as max_latency
      FROM ${this.tableName} r
    `;
    const params = [];

    if (userId) {
      sql += " INNER JOIN api_requests req ON r.api_request_id = req.id WHERE req.user_id = ?";
      params.push(userId);
    }

    sql += " GROUP BY r.response_status ORDER BY count DESC";

    return await this.db.all(sql, params);
  }

  /**
   * Get statistics by source
   * @param {string} userId - User ID (optional via JOIN)
   * @returns {Promise<Array>} Statistics array
   */
  async getStatsBySource(userId = null) {
    let sql = `
      SELECT 
        r.response_source as source,
        COUNT(*) as count,
        AVG(r.latency_ms) as avg_latency
      FROM ${this.tableName} r
    `;
    const params = [];

    if (userId) {
      sql += " INNER JOIN api_requests req ON r.api_request_id = req.id WHERE req.user_id = ?";
      params.push(userId);
    }

    sql += " GROUP BY r.response_source ORDER BY count DESC";

    return await this.db.all(sql, params);
  }

  /**
   * Get average latency
   * @param {Object} criteria - Filter criteria (optional)
   * @returns {Promise<number>} Average latency in ms
   */
  async getAverageLatency(criteria = {}) {
    let sql = `SELECT AVG(latency_ms) as avg_latency FROM ${this.tableName}`;
    const params = [];

    if (Object.keys(criteria).length > 0) {
      const { clause, values } = this._buildWhereClause(criteria);
      sql += ` WHERE ${clause}`;
      params.push(...values);
    }

    const result = await this.db.get(sql, params);
    return result.avg_latency || 0;
  }

  /**
   * Delete responses by request ID
   * @param {number} requestId - Request ID
   * @returns {Promise<number>} Number of deleted records
   */
  async deleteByRequestId(requestId) {
    return await this.deleteBy({ api_request_id: requestId });
  }

  /**
   * Count responses by source
   * @returns {Promise<Object>} Count by source
   */
  async countBySource() {
    const sql = `
      SELECT response_source, COUNT(*) as count
      FROM ${this.tableName}
      GROUP BY response_source
    `;
    const rows = await this.db.all(sql);

    const result = { backend: 0, dproxy: 0, custom: 0 };
    rows.forEach((row) => {
      result[row.response_source] = row.count;
    });

    return result;
  }
}

module.exports = ApiResponseRepository;
