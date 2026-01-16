/**
 * ResponseService.js
 *
 * Service layer for managing API responses.
 * Provides business logic for response operations, including:
 * - Response creation and retrieval
 * - Response filtering and search
 * - Response statistics and analytics
 * - Response-request correlation
 */

const ApiResponseRepository = require("../database/repositories/ApiResponseRepository");
const ResponseTemplateRepository = require("../database/repositories/ResponseTemplateRepository");
const logger = require("../utils/logger");

class ResponseService {
  constructor(db) {
    if (!db) {
      throw new Error("ResponseService requires a database connection");
    }
    this.responseRepo = new ApiResponseRepository(db);
    this.templateRepo = new ResponseTemplateRepository(db);
  }

  /**
   * Create a new API response record
   * @param {number} requestId Associated request ID
   * @param {Object} responseData Response data from ResponseContext
   * @returns {Promise<Object>} Created response record
   */
  async createResponse(requestId, responseData) {
    try {
      logger.debug("Creating response record", {
        requestId,
        status: responseData.status,
      });

      // Validate required fields
      this._validateResponseData(responseData);

      const record = {
        request_id: requestId,
        status_code: responseData.status,
        headers: responseData.headers ? JSON.stringify(responseData.headers) : null,
        body: responseData.body ? JSON.stringify(responseData.body) : null,
        response_source: responseData.source || "backend",
        template_id: responseData.template_id || null,
        latency_ms: responseData.latency || null,
      };

      const created = await this.responseRepo.create(record);
      logger.info("Response record created", {
        response_id: created.id,
        request_id: requestId,
      });

      return created;
    } catch (error) {
      logger.error("Failed to create response record", { error: error.message });
      throw error;
    }
  }

  /**
   * Get response by ID
   * @param {number} responseId Response ID
   * @returns {Promise<Object|null>} Response record or null
   */
  async getResponseById(responseId) {
    try {
      return await this.responseRepo.findById(responseId);
    } catch (error) {
      logger.error("Failed to get response by ID", { responseId, error: error.message });
      throw error;
    }
  }

  /**
   * Get response with associated request data
   * @param {number} responseId Response ID
   * @returns {Promise<Object|null>} Response with request data
   */
  async getResponseWithRequest(responseId) {
    try {
      const result = await this.responseRepo.findWithRequest({ id: responseId });
      return result.length > 0 ? result[0] : null;
    } catch (error) {
      logger.error("Failed to get response with request", { responseId, error: error.message });
      throw error;
    }
  }

  /**
   * Get all responses for a request
   * @param {number} requestId Request ID
   * @returns {Promise<Array>} List of responses
   */
  async getResponsesByRequestId(requestId) {
    try {
      return await this.responseRepo.findAll({ request_id: requestId });
    } catch (error) {
      logger.error("Failed to get responses by request ID", { requestId, error: error.message });
      throw error;
    }
  }

  /**
   * Search responses with filters
   * @param {Object} filters Search filters
   * @param {Object} options Pagination and sorting options
   * @returns {Promise<Object>} { data: Array, total: number, page: number, pageSize: number }
   */
  async searchResponses(filters = {}, options = {}) {
    try {
      const { page = 1, pageSize = 20, sortBy = "created_at", sortOrder = "DESC" } = options;

      // Build where clause from filters
      const whereClause = this._buildWhereClause(filters);

      // Get total count
      const total = await this.responseRepo.count(whereClause);

      // Get paginated data with request info
      const offset = (page - 1) * pageSize;

      let data;
      if (Object.keys(whereClause).length === 0) {
        // If no filters, use simple findAll
        data = await this.responseRepo.findAll({
          orderBy: `${sortBy} ${sortOrder}`,
          limit: pageSize,
          offset,
        });
      } else {
        // If filters exist, use findWithRequest for JOIN query
        data = await this.responseRepo.findWithRequest({
          ...whereClause,
          orderBy: `r.${sortBy} ${sortOrder}`,
          limit: pageSize,
          offset,
        });
      }

      return {
        data,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      };
    } catch (error) {
      logger.error("Failed to search responses", { filters, error: error.message });
      throw error;
    }
  }

  /**
   * Update response record
   * @param {number} responseId Response ID
   * @param {Object} updates Update data
   * @returns {Promise<Object>} Updated response record
   */
  async updateResponse(responseId, updates) {
    try {
      logger.debug("Updating response record", { responseId });

      const allowedFields = ["status_code", "headers", "body", "response_source", "template_id"];
      const updateData = {};

      for (const [key, value] of Object.entries(updates)) {
        if (allowedFields.includes(key)) {
          updateData[key] = value;
        }
      }

      if (Object.keys(updateData).length === 0) {
        throw new Error("No valid fields to update");
      }

      const updated = await this.responseRepo.update(responseId, updateData);
      logger.info("Response record updated", { responseId });

      return updated;
    } catch (error) {
      logger.error("Failed to update response record", { responseId, error: error.message });
      throw error;
    }
  }

  /**
   * Get response statistics by status code
   * @param {Object} filters Optional filters
   * @returns {Promise<Array>} Statistics grouped by status code
   */
  async getStatsByStatus(filters = {}) {
    try {
      return await this.responseRepo.getStatsByStatus(filters);
    } catch (error) {
      logger.error("Failed to get stats by status", { error: error.message });
      throw error;
    }
  }

  /**
   * Get response statistics by source
   * @param {Object} filters Optional filters
   * @returns {Promise<Array>} Statistics grouped by response source
   */
  async getStatsBySource(filters = {}) {
    try {
      const query = `
        SELECT 
          response_source,
          COUNT(*) as count,
          AVG(latency_ms) as avg_latency
        FROM api_responses
        ${this._buildWhereClauseSQL(filters)}
        GROUP BY response_source
        ORDER BY count DESC
      `;

      return await this.responseRepo.db.all(query);
    } catch (error) {
      logger.error("Failed to get stats by source", { error: error.message });
      throw error;
    }
  }

  /**
   * Get average latency statistics
   * @param {Object} filters Optional filters
   * @returns {Promise<Object>} Average latency statistics
   */
  async getAverageLatency(filters = {}) {
    try {
      return await this.responseRepo.getAverageLatency(filters);
    } catch (error) {
      logger.error("Failed to get average latency", { error: error.message });
      throw error;
    }
  }

  /**
   * Create response from template
   * @param {number} requestId Associated request ID
   * @param {number} statusCode HTTP status code
   * @param {Object} variables Template variable overrides
   * @returns {Promise<Object>} Created response record
   */
  async createResponseFromTemplate(requestId, statusCode, variables = {}) {
    try {
      logger.debug("Creating response from template", { requestId, statusCode });

      // Get template for status code
      const template = await this.templateRepo.getTemplateForStatus(statusCode);
      if (!template) {
        throw new Error(`No template found for status code ${statusCode}`);
      }

      // Parse template body and apply variables
      let body = template.body_template;
      try {
        const bodyObj = JSON.parse(body);
        // Merge template variables with provided variables
        const mergedBody = this._mergeTemplateVariables(bodyObj, variables);
        body = JSON.stringify(mergedBody);
      } catch (e) {
        // If body is not JSON, just use as-is
        logger.debug("Template body is not JSON, using as-is");
      }

      // Parse headers
      let headers = {};
      try {
        headers = JSON.parse(template.headers || "{}");
      } catch (e) {
        logger.warn("Failed to parse template headers", { template_id: template.id });
      }

      // Create response record
      const responseData = {
        status: statusCode,
        headers,
        body,
        source: "dproxy",
        template_id: template.id,
      };

      return await this.createResponse(requestId, responseData);
    } catch (error) {
      logger.error("Failed to create response from template", { error: error.message });
      throw error;
    }
  }

  /**
   * Validate response data
   * @param {Object} responseData Response data to validate
   * @throws {Error} If validation fails
   * @private
   */
  _validateResponseData(responseData) {
    if (!responseData.status) {
      throw new Error("Response status is required");
    }

    const status = parseInt(responseData.status);
    if (isNaN(status) || status < 100 || status > 599) {
      throw new Error(`Invalid HTTP status code: ${responseData.status}`);
    }

    const validSources = ["backend", "dproxy", "custom"];
    if (responseData.source && !validSources.includes(responseData.source)) {
      throw new Error(`Invalid response source: ${responseData.source}`);
    }
  }

  /**
   * Build SQL WHERE clause from filters
   * @param {Object} filters Filter object
   * @returns {Object} WHERE clause object for BaseRepository
   * @private
   */
  _buildWhereClause(filters) {
    const where = {};

    if (filters.request_id) {
      where.request_id = filters.request_id;
    }
    if (filters.status_code) {
      where.status_code = filters.status_code;
    }
    if (filters.response_source) {
      where.response_source = filters.response_source;
    }
    if (filters.template_id) {
      where.template_id = filters.template_id;
    }

    return where;
  }

  /**
   * Build SQL WHERE clause string
   * @param {Object} filters Filter object
   * @returns {string} WHERE clause SQL string
   * @private
   */
  _buildWhereClauseSQL(filters) {
    const conditions = [];

    if (filters.request_id) {
      conditions.push(`request_id = ${filters.request_id}`);
    }
    if (filters.status_code) {
      conditions.push(`status_code = ${filters.status_code}`);
    }
    if (filters.response_source) {
      conditions.push(`response_source = '${filters.response_source}'`);
    }
    if (filters.created_after) {
      conditions.push(`created_at >= '${filters.created_after}'`);
    }
    if (filters.created_before) {
      conditions.push(`created_at <= '${filters.created_before}'`);
    }

    return conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";
  }

  /**
   * Merge template variables into body object
   * @param {Object} bodyObj Template body object
   * @param {Object} variables Variables to merge
   * @returns {Object} Merged body object
   * @private
   */
  _mergeTemplateVariables(bodyObj, variables) {
    const result = { ...bodyObj };

    for (const [key, value] of Object.entries(variables)) {
      result[key] = value;
    }

    return result;
  }

  /**
   * Get service statistics
   * @returns {Promise<Object>} Service statistics
   */
  async getServiceStats() {
    try {
      const totalResponses = await this.responseRepo.count();
      const byStatus = await this.getStatsByStatus();
      const bySource = await this.getStatsBySource();
      const avgLatency = await this.getAverageLatency();

      return {
        totalResponses,
        byStatus,
        bySource,
        avgLatency,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      logger.error("Failed to get service stats", { error: error.message });
      throw error;
    }
  }
}

module.exports = ResponseService;
