/**
 * Services Routes
 *
 * Provides API endpoints for listing public and secure API services
 * based on recorded requests in the database.
 */

const express = require("express");
const router = express.Router();
const logger = require("../../utils/logger");
const dbConnection = require("../../database/connection");

/**
 * Helper function to build full path from service data
 * Gracefully handles missing host column
 */
function buildFullPath(service) {
  if (!service) return "/";

  let fullPath = service.endpoint_path || "/";

  // Only add host if it exists
  if (service.host) {
    fullPath = service.host + fullPath;

    // Add query parameters if they exist
    if (service.query_params) {
      try {
        const queryObj = JSON.parse(service.query_params);
        const queryString = new URLSearchParams(queryObj).toString();
        if (queryString) {
          fullPath += "?" + queryString;
        }
      } catch (e) {
        logger.warn("Failed to parse query_params for service", { id: service.id, error: e.message });
      }
    }
  }

  return fullPath;
}

/**
 * Initialize routes
 * @returns {express.Router} Express router
 */
function initializeRoutes() {
  /**
   * GET /services/public
   * Get list of public API services
   *
   * Query Parameters:
   * - version: Filter by mobile version
   * - platform: Filter by mobile platform (android, ios)
   * - language: Filter by accept language
   * - environment: Filter by environment
   */
  router.get("/public", (req, res) => {
    try {
      const { version, platform, language, environment, user_id } = req.query;
      const database = dbConnection.getDatabase();

      // Build query to get unique public endpoints with their request/response data
      let sql = `
        SELECT DISTINCT
          ar.id,
          ar.user_id,
          u.user_id as user_identifier,
          ar.endpoint_name,
          ar.endpoint_path,
          ar.host,
          ar.query_params,
          ar.app_platform,
          ar.app_version,
          ar.app_language,
          ar.app_environment,
          ar.method,
          ar.created_at,
          resp.updated_at,
          ar.request_headers,
          ar.request_body,
          resp.id as response_id,
          resp.response_status,
          resp.response_headers,
          resp.response_body
        FROM api_requests ar
        LEFT JOIN api_responses resp ON ar.id = resp.api_request_id
        LEFT JOIN users u ON ar.user_id = u.id
        WHERE ar.endpoint_type = 'public'
      `;

      const params = [];

      if (user_id) {
        sql += " AND (u.user_id = ? OR ar.user_id = ?)";
        params.push(user_id, user_id);
      }

      if (version) {
        sql += " AND ar.app_version = ?";
        params.push(version);
      }

      if (platform) {
        sql += " AND ar.app_platform = ?";
        params.push(platform);
      }

      if (language) {
        sql += " AND ar.app_language = ?";
        params.push(language);
      }

      if (environment) {
        sql += " AND ar.app_environment = ?";
        params.push(environment);
      }

      sql += " ORDER BY ar.created_at DESC";

      const stmt = database.prepare(sql);
      const services = stmt.all(...params);

      // Assemble full paths on the server side
      const servicesWithFullPath = services.map((service) => ({
        ...service,
        full_path: buildFullPath(service),
      }));

      res.json({
        success: true,
        data: servicesWithFullPath,
        count: servicesWithFullPath.length,
      });
    } catch (error) {
      logger.error("Failed to get public services", {
        error: error.message,
        stack: error.stack,
      });
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * GET /services/public/:id
   * Get details of a specific public service
   * @param {number} id - Response ID (not request ID)
   */
  router.get("/public/:id", (req, res) => {
    try {
      const { id } = req.params;
      const database = dbConnection.getDatabase();

      const sql = `
        SELECT
          ar.id,
          ar.user_id,
          u.user_id as user_identifier,
          ar.endpoint_name,
          ar.endpoint_path,
          ar.host,
          ar.query_params,
          ar.app_platform,
          ar.app_version,
          ar.app_language,
          ar.app_environment,
          ar.method,
          ar.created_at,
          ar.updated_at,
          ar.request_headers,
          ar.request_body,
          resp.id as response_id,
          resp.response_status,
          resp.response_headers,
          resp.response_body,
          resp.created_at as response_at
        FROM api_responses resp
        INNER JOIN api_requests ar ON resp.api_request_id = ar.id
        LEFT JOIN users u ON ar.user_id = u.id
        WHERE resp.id = ? AND ar.endpoint_type = 'public'
      `;

      const stmt = database.prepare(sql);
      const service = stmt.get(id);

      if (!service) {
        return res.status(404).json({
          success: false,
          error: "Service not found",
        });
      }

      // Assemble full path on the server side
      const fullPath = buildFullPath(service);

      res.json({
        success: true,
        data: {
          ...service,
          full_path: fullPath,
        },
      });
    } catch (error) {
      logger.error("Failed to get public service details", {
        error: error.message,
        responseId: req.params.id,
      });
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * GET /services/secure
   * Get list of secure/authenticated API services
   *
   * Query Parameters:
   * - version: Filter by mobile version
   * - platform: Filter by mobile platform (android, ios)
   * - language: Filter by accept language
   * - environment: Filter by environment
   */
  router.get("/secure", (req, res) => {
    try {
      const { version, platform, language, environment, user_id } = req.query;
      const database = dbConnection.getDatabase();

      // Build query to get unique secure endpoints with their request/response data
      let sql = `
        SELECT DISTINCT
          ar.id,
          ar.user_id,
          u.user_id as user_identifier,
          ar.endpoint_name,
          ar.endpoint_path,
          ar.host,
          ar.query_params,
          ar.app_platform,
          ar.app_version,
          ar.app_language,
          ar.app_environment,
          ar.method,
          ar.created_at,
          resp.updated_at,
          ar.request_headers,
          ar.request_body,
          resp.id as response_id,
          resp.response_status,
          resp.response_headers,
          resp.response_body
        FROM api_requests ar
        LEFT JOIN api_responses resp ON ar.id = resp.api_request_id
        LEFT JOIN users u ON ar.user_id = u.id
        WHERE ar.endpoint_type = 'secure'
      `;

      const params = [];

      if (user_id) {
        sql += " AND (u.user_id = ? OR ar.user_id = ?)";
        params.push(user_id, user_id);
      }

      if (version) {
        sql += " AND ar.app_version = ?";
        params.push(version);
      }

      if (platform) {
        sql += " AND ar.app_platform = ?";
        params.push(platform);
      }

      if (language) {
        sql += " AND ar.app_language = ?";
        params.push(language);
      }

      if (environment) {
        sql += " AND ar.app_environment = ?";
        params.push(environment);
      }

      sql += " ORDER BY ar.created_at DESC";

      const stmt = database.prepare(sql);
      const services = stmt.all(...params);

      // Assemble full paths on the server side
      const servicesWithFullPath = services.map((service) => ({
        ...service,
        full_path: buildFullPath(service),
      }));

      res.json({
        success: true,
        data: servicesWithFullPath,
        count: servicesWithFullPath.length,
      });
    } catch (error) {
      logger.error("Failed to get secure services", {
        error: error.message,
        stack: error.stack,
      });
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * GET /services/secure/:id
   * Get details of a specific secure service
   * @param {number} id - Response ID (not request ID)
   */
  router.get("/secure/:id", (req, res) => {
    try {
      const { id } = req.params;
      const database = dbConnection.getDatabase();

      const sql = `
        SELECT
          ar.id,
          ar.user_id,
          u.user_id as user_identifier,
          ar.endpoint_name,
          ar.endpoint_path,
          ar.host,
          ar.query_params,
          ar.app_platform,
          ar.app_version,
          ar.app_language,
          ar.app_environment,
          ar.method,
          ar.created_at,
          ar.updated_at,
          ar.request_headers,
          ar.request_body,
          resp.id as response_id,
          resp.response_status,
          resp.response_headers,
          resp.response_body,
          resp.created_at as response_at
        FROM api_responses resp
        INNER JOIN api_requests ar ON resp.api_request_id = ar.id
        LEFT JOIN users u ON ar.user_id = u.id
        WHERE resp.id = ? AND ar.endpoint_type = 'secure'
      `;

      const stmt = database.prepare(sql);
      const service = stmt.get(id);

      if (!service) {
        return res.status(404).json({
          success: false,
          error: "Service not found",
        });
      }

      // Assemble full path on the server side
      // Assemble full path on the server side
      const fullPath = buildFullPath(service);

      res.json({
        success: true,
        data: {
          ...service,
          full_path: fullPath,
        },
      });
    } catch (error) {
      logger.error("Failed to get secure service details", {
        error: error.message,
        responseId: req.params.id,
      });
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  return router;
}

module.exports = initializeRoutes;
