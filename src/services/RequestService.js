/**
 * RequestService.js
 *
 * Service layer for managing API requests.
 * Provides business logic for request operations, including:
 * - Request creation and retrieval
 * - Request filtering and search
 * - Request statistics and analytics
 * - Request matching and correlation
 */

const ApiRequestRepository = require("../database/repositories/ApiRequestRepository");
const logger = require("../utils/logger");

class RequestService {
  constructor(db) {
    if (!db) {
      throw new Error("RequestService requires a database connection");
    }
    this.requestRepo = new ApiRequestRepository(db);
  }

  /**
   * Create a new API request record
   * @param {Object} requestData Request data from RequestContext
   * @returns {Promise<Object>} Created request record
   */
  async createRequest(requestData) {
    try {
      logger.debug("Creating request record", {
        method: requestData.method,
        path: requestData.path,
      });

      // Validate required fields
      this._validateRequestData(requestData);

      // Extract dimension fields
      const record = {
        user_id: requestData.user_id || null,
        method: requestData.method,
        path: requestData.path,
        query_params: requestData.query_params ? JSON.stringify(requestData.query_params) : null,
        headers: requestData.headers ? JSON.stringify(requestData.headers) : null,
        body: requestData.body ? JSON.stringify(requestData.body) : null,
        app_version: requestData.app_version || null,
        app_language: requestData.app_language || null,
        app_platform: requestData.app_platform || null,
        app_environment: requestData.app_environment || null,
      };

      const created = await this.requestRepo.create(record);
      logger.info("Request record created", { request_id: created.id });

      return created;
    } catch (error) {
      logger.error("Failed to create request record", { error: error.message });
      throw error;
    }
  }

  /**
   * Get request by ID
   * @param {number} requestId Request ID
   * @returns {Promise<Object|null>} Request record or null
   */
  async getRequestById(requestId) {
    try {
      return await this.requestRepo.findById(requestId);
    } catch (error) {
      logger.error("Failed to get request by ID", { requestId, error: error.message });
      throw error;
    }
  }

  /**
   * Search requests with filters
   * @param {Object} filters Search filters
   * @param {Object} options Pagination and sorting options
   * @returns {Promise<Object>} { data: Array, total: number, page: number, pageSize: number }
   */
  async searchRequests(filters = {}, options = {}) {
    try {
      const { page = 1, pageSize = 20, sortBy = "created_at", sortOrder = "DESC" } = options;

      // Build where clause from filters
      const whereClause = this._buildWhereClause(filters);

      // Get total count
      const total = await this.requestRepo.count(whereClause);

      // Get paginated data
      const offset = (page - 1) * pageSize;
      const data = await this.requestRepo.findAll({
        where: whereClause,
        orderBy: `${sortBy} ${sortOrder}`,
        limit: pageSize,
        offset,
      });

      return {
        data,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      };
    } catch (error) {
      logger.error("Failed to search requests", { filters, error: error.message });
      throw error;
    }
  }

  /**
   * Find requests by dimension values
   * @param {Object} dimensions Dimension filters
   * @returns {Promise<Array>} Matching requests
   */
  async findByDimensions(dimensions) {
    try {
      return await this.requestRepo.findByDimensions(dimensions);
    } catch (error) {
      logger.error("Failed to find requests by dimensions", { dimensions, error: error.message });
      throw error;
    }
  }

  /**
   * Find matching request for replay mode
   * @param {Object} incomingRequest Incoming request data
   * @param {Object} matchingConfig Matching configuration
   * @returns {Promise<Object|null>} Best matching request or null
   */
  async findMatchingRequest(incomingRequest, matchingConfig) {
    try {
      logger.debug("Finding matching request", {
        method: incomingRequest.method,
        path: incomingRequest.path,
      });

      const criteria = {
        user_id: incomingRequest.user_id,
        method: incomingRequest.method,
        path: incomingRequest.path,
      };

      // Add dimension filters if specified in config
      if (matchingConfig.match_app_version && incomingRequest.app_version) {
        criteria.app_version = incomingRequest.app_version;
      }
      if (matchingConfig.match_app_language && incomingRequest.app_language) {
        criteria.app_language = incomingRequest.app_language;
      }
      if (matchingConfig.match_app_platform && incomingRequest.app_platform) {
        criteria.app_platform = incomingRequest.app_platform;
      }
      if (matchingConfig.match_app_environment && incomingRequest.app_environment) {
        criteria.app_environment = incomingRequest.app_environment;
      }

      return await this.requestRepo.findMatchingRequest(criteria);
    } catch (error) {
      logger.error("Failed to find matching request", { error: error.message });
      throw error;
    }
  }

  /**
   * Get unique endpoints
   * @returns {Promise<Array>} List of unique endpoints { method, path, count }
   */
  async getUniqueEndpoints() {
    try {
      return await this.requestRepo.getUniqueEndpoints();
    } catch (error) {
      logger.error("Failed to get unique endpoints", { error: error.message });
      throw error;
    }
  }

  /**
   * Get request statistics by dimension
   * @param {string} dimension Dimension name (app_version, app_language, app_platform, app_environment)
   * @returns {Promise<Array>} Statistics grouped by dimension
   */
  async getStatsByDimension(dimension) {
    try {
      const validDimensions = ["app_version", "app_language", "app_platform", "app_environment"];
      if (!validDimensions.includes(dimension)) {
        throw new Error(`Invalid dimension: ${dimension}`);
      }

      return await this.requestRepo.getStatsByDimension(dimension);
    } catch (error) {
      logger.error("Failed to get stats by dimension", { dimension, error: error.message });
      throw error;
    }
  }

  /**
   * Get request count grouped by endpoint
   * @param {Object} filters Optional filters
   * @returns {Promise<Array>} Endpoint statistics
   */
  async getEndpointStats(filters = {}) {
    try {
      const whereClause = this._buildWhereClause(filters);

      const query = `
        SELECT 
          method,
          path,
          COUNT(*) as count,
          COUNT(DISTINCT user_id) as unique_users,
          MIN(created_at) as first_seen,
          MAX(created_at) as last_seen
        FROM api_requests
        ${whereClause ? "WHERE " + whereClause : ""}
        GROUP BY method, path
        ORDER BY count DESC
      `;

      return await this.requestRepo.db.all(query);
    } catch (error) {
      logger.error("Failed to get endpoint stats", { error: error.message });
      throw error;
    }
  }

  /**
   * Validate request data
   * @param {Object} requestData Request data to validate
   * @throws {Error} If validation fails
   * @private
   */
  _validateRequestData(requestData) {
    if (!requestData.method) {
      throw new Error("Request method is required");
    }
    if (!requestData.path) {
      throw new Error("Request path is required");
    }

    const validMethods = ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"];
    if (!validMethods.includes(requestData.method)) {
      throw new Error(`Invalid HTTP method: ${requestData.method}`);
    }
  }

  /**
   * Build SQL WHERE clause from filters
   * @param {Object} filters Filter object
   * @returns {string} WHERE clause (without 'WHERE' keyword)
   * @private
   */
  _buildWhereClause(filters) {
    const conditions = [];

    if (filters.user_id) {
      conditions.push(`user_id = '${filters.user_id}'`);
    }
    if (filters.method) {
      conditions.push(`method = '${filters.method}'`);
    }
    if (filters.path) {
      conditions.push(`path LIKE '%${filters.path}%'`);
    }
    if (filters.app_version) {
      conditions.push(`app_version = '${filters.app_version}'`);
    }
    if (filters.app_language) {
      conditions.push(`app_language = '${filters.app_language}'`);
    }
    if (filters.app_platform) {
      conditions.push(`app_platform = '${filters.app_platform}'`);
    }
    if (filters.app_environment) {
      conditions.push(`app_environment = '${filters.app_environment}'`);
    }
    if (filters.created_after) {
      conditions.push(`created_at >= '${filters.created_after}'`);
    }
    if (filters.created_before) {
      conditions.push(`created_at <= '${filters.created_before}'`);
    }

    return conditions.join(" AND ");
  }

  /**
   * Get service statistics
   * @returns {Promise<Object>} Service statistics
   */
  async getServiceStats() {
    try {
      const totalRequests = await this.requestRepo.count();
      const uniqueUsers = await this.requestRepo.db.get(
        "SELECT COUNT(DISTINCT user_id) as count FROM api_requests WHERE user_id IS NOT NULL"
      );
      const uniqueEndpoints = await this.getUniqueEndpoints();

      return {
        totalRequests,
        uniqueUsers: uniqueUsers.count,
        uniqueEndpoints: uniqueEndpoints.length,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      logger.error("Failed to get service stats", { error: error.message });
      throw error;
    }
  }
}

module.exports = RequestService;
