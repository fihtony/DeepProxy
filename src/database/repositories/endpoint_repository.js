/**
 * Endpoint Repository
 *
 * Manages endpoint metadata and configuration.
 * Tracks which endpoints have processors configured.
 */

const db = require("../connection");
const logger = require("../../utils/logger");
const { getLocalISOString } = require("../../utils/datetimeUtils");

class EndpointRepository {
  /**
   * Create or update endpoint metadata
   * @param {string} endpointPath - Full endpoint path
   * @param {string} endpointName - Friendly endpoint name
   * @param {boolean} isSecure - Whether endpoint requires authentication
   * @param {string} serviceCategory - Service category
   * @param {string} description - Endpoint description
   * @returns {Object} Created/updated endpoint
   */
  createOrUpdateEndpoint(endpointPath, endpointName, isSecure, serviceCategory = null, description = null) {
    try {
      const now = getLocalISOString();
      const stmt = db.prepare(`
        INSERT INTO endpoints (
          endpoint_path, endpoint_name, is_secure, service_category, description, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(endpoint_path) DO UPDATE SET
          endpoint_name = excluded.endpoint_name,
          is_secure = excluded.is_secure,
          service_category = excluded.service_category,
          description = excluded.description,
          updated_at = ?
        RETURNING *
      `);

      const result = stmt.get(endpointPath, endpointName, isSecure ? 1 : 0, serviceCategory, description, now, now, now);

      logger.debug(`Endpoint created/updated: ${endpointName}`);
      return result;
    } catch (error) {
      logger.error("Failed to create/update endpoint:", error);
      throw error;
    }
  }

  /**
   * Get endpoint by path
   * @param {string} endpointPath - Endpoint path
   * @returns {Object|null} Endpoint or null
   */
  getEndpointByPath(endpointPath) {
    try {
      const stmt = db.prepare("SELECT * FROM endpoints WHERE endpoint_path = ?");
      return stmt.get(endpointPath) || null;
    } catch (error) {
      logger.error("Failed to get endpoint by path:", error);
      throw error;
    }
  }

  /**
   * Get endpoint by name
   * @param {string} endpointName - Endpoint name
   * @returns {Object|null} Endpoint or null
   */
  getEndpointByName(endpointName) {
    try {
      const stmt = db.prepare("SELECT * FROM endpoints WHERE endpoint_name = ?");
      return stmt.get(endpointName) || null;
    } catch (error) {
      logger.error("Failed to get endpoint by name:", error);
      throw error;
    }
  }

  /**
   * Get all endpoints
   * @param {Object} filters - Optional filters
   * @returns {Array} List of endpoints
   */
  getAllEndpoints(filters = {}) {
    try {
      let sql = "SELECT * FROM endpoints WHERE 1=1";
      const params = [];

      if (filters.isSecure !== undefined) {
        sql += " AND is_secure = ?";
        params.push(filters.isSecure ? 1 : 0);
      }

      if (filters.serviceCategory) {
        sql += " AND service_category = ?";
        params.push(filters.serviceCategory);
      }

      if (filters.hasPostProcessor !== undefined) {
        sql += " AND has_post_processor = ?";
        params.push(filters.hasPostProcessor ? 1 : 0);
      }

      if (filters.hasPreProcessor !== undefined) {
        sql += " AND has_pre_processor = ?";
        params.push(filters.hasPreProcessor ? 1 : 0);
      }

      sql += " ORDER BY endpoint_name";

      const stmt = db.prepare(sql);
      return stmt.all(...params);
    } catch (error) {
      logger.error("Failed to get all endpoints:", error);
      throw error;
    }
  }

  /**
   * Update endpoint processor flags
   * @param {number} endpointId - Endpoint ID
   * @param {boolean} hasPostProcessor - Has post-processor
   * @param {boolean} hasPreProcessor - Has pre-processor
   * @returns {boolean} Success
   */
  updateProcessorFlags(endpointId, hasPostProcessor, hasPreProcessor) {
    try {
      const now = getLocalISOString();
      const stmt = db.prepare(`
        UPDATE endpoints
        SET has_post_processor = ?,
            has_pre_processor = ?,
            updated_at = ?
        WHERE id = ?
      `);

      stmt.run(hasPostProcessor ? 1 : 0, hasPreProcessor ? 1 : 0, now, endpointId);

      logger.debug(`Processor flags updated for endpoint ID: ${endpointId}`);
      return true;
    } catch (error) {
      logger.error("Failed to update processor flags:", error);
      throw error;
    }
  }

  /**
   * Update endpoint metadata
   * @param {number} endpointId - Endpoint ID
   * @param {Object} updates - Fields to update
   * @returns {boolean} Success
   */
  updateEndpoint(endpointId, updates) {
    try {
      const allowedFields = ["endpoint_name", "service_category", "description"];
      const setClause = [];
      const params = [];

      Object.keys(updates).forEach((key) => {
        if (allowedFields.includes(key)) {
          setClause.push(`${key} = ?`);
          params.push(updates[key]);
        }
      });

      if (setClause.length === 0) {
        return false;
      }

      setClause.push("updated_at = ?");
      params.push(getLocalISOString());
      params.push(endpointId);

      const sql = `UPDATE endpoints SET ${setClause.join(", ")} WHERE id = ?`;
      const stmt = db.prepare(sql);
      stmt.run(...params);

      logger.debug(`Endpoint updated: ID ${endpointId}`);
      return true;
    } catch (error) {
      logger.error("Failed to update endpoint:", error);
      throw error;
    }
  }

  /**
   * Delete endpoint
   * @param {number} endpointId - Endpoint ID
   * @returns {boolean} Success
   */
  deleteEndpoint(endpointId) {
    try {
      const stmt = db.prepare("DELETE FROM endpoints WHERE id = ?");
      stmt.run(endpointId);

      logger.info(`Endpoint deleted: ID ${endpointId}`);
      return true;
    } catch (error) {
      logger.error("Failed to delete endpoint:", error);
      throw error;
    }
  }

  /**
   * Get endpoints with processor information
   * @returns {Array} Endpoints with processors
   */
  getEndpointsWithProcessors() {
    try {
      const sql = `
        SELECT 
          e.*,
          (SELECT COUNT(*) FROM processors WHERE endpoint_id = e.id AND processor_type = 'post') as post_processor_count,
          (SELECT COUNT(*) FROM processors WHERE endpoint_id = e.id AND processor_type = 'pre') as pre_processor_count
        FROM endpoints e
        ORDER BY e.endpoint_name
      `;

      const stmt = db.prepare(sql);
      return stmt.all();
    } catch (error) {
      logger.error("Failed to get endpoints with processors:", error);
      throw error;
    }
  }
}

module.exports = new EndpointRepository();
