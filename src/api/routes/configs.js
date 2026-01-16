/**
 * configs.js
 *
 * API routes for endpoint matching configuration
 * Manages endpoint_matching_config table for REPLAY mode matching rules
 */

const express = require("express");
const router = express.Router();
const logger = require("../../utils/logger");
const dbConnection = require("../../database/connection");
const { getLocalISOString } = require("../../utils/datetimeUtils");

/**
 * Initialize routes with database connection
 */
function initializeRoutes(db) {
  /**
   * GET /api/configs
   * Get all endpoint matching configurations from endpoint_matching_config table
   */
  router.get("/", (req, res) => {
    try {
      const database = dbConnection.getDatabase();

      const sql = `
        SELECT
          id,
          endpoint_pattern,
          http_method,
          match_version,
          match_language,
          match_platform,
          match_environment,
          match_headers,
          match_query_params,
          match_body,
          match_response_status,
          priority,
          enabled,
          type,
          created_at,
          updated_at
        FROM endpoint_matching_config
        ORDER BY priority ASC, endpoint_pattern ASC
      `;

      const stmt = database.prepare(sql);
      const configs = stmt.all();

      res.json({
        success: true,
        data: configs,
        count: configs.length,
      });
    } catch (error) {
      logger.error("Failed to get all configs", { error: error.message });
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * GET /api/configs/available-endpoints
   * Get unique endpoints from api_requests table with their HTTP methods
   * UI can extract both endpoints and methods from this single response
   */
  router.get("/available-endpoints", (req, res) => {
    try {
      const database = dbConnection.getDatabase();

      const sql = `
        SELECT DISTINCT endpoint_path, method
        FROM api_requests
        ORDER BY endpoint_path ASC, method ASC
      `;

      const stmt = database.prepare(sql);
      const endpoints = stmt.all();

      res.json({
        success: true,
        data: endpoints,
        count: endpoints.length,
      });
    } catch (error) {
      logger.error("Failed to get available endpoints", { error: error.message });
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * GET /api/configs/:id
   * Get configuration details for specific endpoint
   */
  router.get("/:id", (req, res) => {
    try {
      const { id } = req.params;
      const database = dbConnection.getDatabase();

      const sql = `
        SELECT
          id,
          endpoint_pattern,
          http_method,
          match_version,
          match_language,
          match_platform,
          match_environment,
          match_headers,
          match_query_params,
          match_body,
          match_response_status,
          priority,
          enabled,
          type,
          created_at,
          updated_at
        FROM endpoint_matching_config
        WHERE id = ?
        LIMIT 1
      `;

      const stmt = database.prepare(sql);
      const config = stmt.get(id);

      if (!config) {
        return res.status(404).json({
          success: false,
          error: "Configuration not found",
        });
      }

      // Parse JSON fields for response
      if (config.match_headers) {
        try {
          config.match_headers = JSON.parse(config.match_headers);
        } catch (e) {
          // Keep as string if parsing fails
        }
      }
      if (config.match_query_params) {
        try {
          config.match_query_params = JSON.parse(config.match_query_params);
        } catch (e) {
          // Keep as string if parsing fails
        }
      }
      if (config.match_body) {
        try {
          config.match_body = JSON.parse(config.match_body);
        } catch (e) {
          // Keep as string if parsing fails
        }
      }

      res.json({
        success: true,
        data: config,
      });
    } catch (error) {
      logger.error("Failed to get config details", { error: error.message });
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * POST /api/configs
   * Create new endpoint matching configuration
   */
  router.post("/", (req, res) => {
    try {
      const {
        endpoint_pattern,
        http_method,
        match_version,
        match_language,
        match_platform,
        match_environment,
        match_headers,
        match_query_params,
        match_body,
        match_response_status,
        priority,
        enabled,
        type,
      } = req.body;

      if (!endpoint_pattern || !http_method) {
        return res.status(400).json({
          success: false,
          error: "endpoint_pattern and http_method are required",
        });
      }

      const database = dbConnection.getDatabase();

      // Check if config already exists for this endpoint, method, and type combination
      const checkSql = `
        SELECT id FROM endpoint_matching_config
        WHERE endpoint_pattern = ? AND http_method = ? AND type = ?
        LIMIT 1
      `;
      const checkStmt = database.prepare(checkSql);
      const existing = checkStmt.get(endpoint_pattern, http_method, type || "replay");

      if (existing) {
        return res.status(409).json({
          success: false,
          error: `Configuration already exists for this endpoint, method, and type`,
        });
      }

      const sql = `
        INSERT INTO endpoint_matching_config (
          endpoint_pattern,
          http_method,
          match_version,
          match_language,
          match_platform,
          match_environment,
          match_headers,
          match_query_params,
          match_body,
          match_response_status,
          priority,
          enabled,
          type,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      const stmt = database.prepare(sql);

      // Serialize array fields to JSON strings for storage
      const matchHeadersStr = Array.isArray(match_headers) ? JSON.stringify(match_headers) : match_headers || null;
      const matchQueryParamsStr = Array.isArray(match_query_params) ? JSON.stringify(match_query_params) : match_query_params || null;
      const matchBodyStr = Array.isArray(match_body) ? JSON.stringify(match_body) : match_body || null;

      const result = stmt.run(
        endpoint_pattern,
        http_method,
        match_version ? 1 : 0,
        match_language ? 1 : 0,
        match_platform ? 1 : 0,
        match_environment || "exact",
        matchHeadersStr,
        matchQueryParamsStr,
        matchBodyStr,
        match_response_status || "2xx",
        priority !== undefined && priority !== null ? priority : 10,
        enabled !== false ? 1 : 0,
        type || "replay",
        getLocalISOString(),
        getLocalISOString()
      );

      // Fetch the created config to return complete object
      const selectSql = `
        SELECT
          id,
          endpoint_pattern,
          http_method,
          match_version,
          match_language,
          match_platform,
          match_environment,
          match_headers,
          match_query_params,
          match_body,
          match_response_status,
          priority,
          enabled,
          type,
          created_at,
          updated_at
        FROM endpoint_matching_config
        WHERE id = ?
      `;
      const selectStmt = database.prepare(selectSql);
      const createdConfig = selectStmt.get(result.lastInsertRowid);

      res.status(201).json({
        success: true,
        message: "Configuration created",
        data: createdConfig,
      });
    } catch (error) {
      logger.error("Failed to create config", { error: error.message });
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * PUT /api/configs/:id
   * Update endpoint configuration
   */
  router.put("/:id", (req, res) => {
    try {
      const { id } = req.params;
      const {
        endpoint_pattern,
        http_method,
        match_version,
        match_language,
        match_platform,
        match_environment,
        match_headers,
        match_query_params,
        match_body,
        match_response_status,
        priority,
        enabled,
        type,
      } = req.body;

      const database = dbConnection.getDatabase();

      // Verify the configuration exists
      const checkSql = `
        SELECT id FROM endpoint_matching_config WHERE id = ? LIMIT 1
      `;
      const checkStmt = database.prepare(checkSql);
      const existing = checkStmt.get(id);

      if (!existing) {
        return res.status(404).json({
          success: false,
          error: "Configuration not found",
        });
      }

      const sql = `
        UPDATE endpoint_matching_config
        SET
          endpoint_pattern = ?,
          http_method = ?,
          match_version = ?,
          match_language = ?,
          match_platform = ?,
          match_environment = ?,
          match_headers = ?,
          match_query_params = ?,
          match_body = ?,
          match_response_status = ?,
          priority = ?,
          enabled = ?,
          type = ?,
          updated_at = ?
        WHERE id = ?
      `;

      const stmt = database.prepare(sql);

      // Serialize array fields to JSON strings for storage
      const matchHeadersStr = Array.isArray(match_headers) ? JSON.stringify(match_headers) : match_headers || null;
      const matchQueryParamsStr = Array.isArray(match_query_params) ? JSON.stringify(match_query_params) : match_query_params || null;
      const matchBodyStr = Array.isArray(match_body) ? JSON.stringify(match_body) : match_body || null;

      stmt.run(
        endpoint_pattern,
        http_method,
        match_version ? 1 : 0,
        match_language ? 1 : 0,
        match_platform ? 1 : 0,
        match_environment || "exact",
        matchHeadersStr,
        matchQueryParamsStr,
        matchBodyStr,
        match_response_status || "2xx",
        priority !== undefined && priority !== null ? priority : 10,
        enabled ? 1 : 0,
        type || "replay",
        getLocalISOString(),
        id
      );

      // Fetch the updated config to return complete object
      const selectSql = `
        SELECT
          id,
          endpoint_pattern,
          http_method,
          match_version,
          match_language,
          match_platform,
          match_environment,
          match_headers,
          match_query_params,
          match_body,
          match_response_status,
          priority,
          enabled,
          type,
          created_at,
          updated_at
        FROM endpoint_matching_config
        WHERE id = ?
      `;
      const selectStmt = database.prepare(selectSql);
      const updatedConfig = selectStmt.get(id);

      res.json({
        success: true,
        message: "Configuration updated",
        data: updatedConfig,
      });
    } catch (error) {
      logger.error("Failed to update config", { error: error.message });
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * PATCH /api/configs/:id/toggle
   * Toggle enabled status of configuration
   */
  router.patch("/:id/toggle", (req, res) => {
    try {
      const { id } = req.params;
      const { enabled } = req.body;

      const database = dbConnection.getDatabase();

      // Verify the configuration exists
      const checkSql = `
        SELECT id, enabled FROM endpoint_matching_config WHERE id = ? LIMIT 1
      `;
      const checkStmt = database.prepare(checkSql);
      const existing = checkStmt.get(id);

      if (!existing) {
        return res.status(404).json({
          success: false,
          error: "Configuration not found",
        });
      }

      const newEnabled = enabled !== undefined ? (enabled ? 1 : 0) : existing.enabled ? 0 : 1;

      const sql = `
        UPDATE endpoint_matching_config
        SET enabled = ?, updated_at = ?
        WHERE id = ?
      `;

      const stmt = database.prepare(sql);
      stmt.run(newEnabled, getLocalISOString(), id);

      // Fetch the updated config to return complete object
      const selectSql = `
        SELECT
          id,
          endpoint_pattern,
          http_method,
          match_version,
          match_language,
          match_platform,
          match_environment,
          match_headers,
          match_query_params,
          match_body,
          match_response_status,
          priority,
          enabled,
          type,
          created_at,
          updated_at
        FROM endpoint_matching_config
        WHERE id = ?
      `;
      const selectStmt = database.prepare(selectSql);
      const updatedConfig = selectStmt.get(id);

      res.json({
        success: true,
        message: `Configuration ${newEnabled ? "enabled" : "disabled"}`,
        data: updatedConfig,
      });
    } catch (error) {
      logger.error("Failed to toggle config", { error: error.message });
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * DELETE /api/configs/:id
   * Delete endpoint configuration
   */
  router.delete("/:id", (req, res) => {
    try {
      const { id } = req.params;
      const database = dbConnection.getDatabase();

      // Verify configuration exists
      const checkSql = `
        SELECT id FROM endpoint_matching_config WHERE id = ? LIMIT 1
      `;
      const checkStmt = database.prepare(checkSql);
      const existing = checkStmt.get(id);

      if (!existing) {
        return res.status(404).json({
          success: false,
          error: "Configuration not found",
        });
      }

      const sql = `DELETE FROM endpoint_matching_config WHERE id = ?`;
      const stmt = database.prepare(sql);
      stmt.run(id);

      res.json({
        success: true,
        message: "Configuration deleted",
        id,
      });
    } catch (error) {
      logger.error("Failed to delete config", { error: error.message });
      res.status(500).json({ success: false, error: error.message });
    }
  });

  return router;
}

module.exports = initializeRoutes;
