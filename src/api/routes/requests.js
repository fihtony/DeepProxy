/**
 * requests.js
 *
 * API routes for request management
 *
 * Endpoints:
 * - GET    /api/requests          - Get all requests (with pagination)
 * - GET    /api/requests/:id      - Get request by ID
 * - POST   /api/requests/search   - Search requests
 * - GET    /api/requests/endpoints - Get unique endpoints
 * - GET    /api/requests/stats    - Get request statistics
 */

const express = require("express");
const RequestService = require("../../services/RequestService");
const logger = require("../../utils/logger");

const router = express.Router();

/**
 * Initialize routes with database connection
 */
function initializeRoutes(db) {
  const requestService = new RequestService(db);

  /**
   * GET /api/requests
   * Get all requests with pagination
   */
  router.get("/", async (req, res) => {
    try {
      const { page = 1, pageSize = 20, sortBy = "created_at", sortOrder = "DESC" } = req.query;

      const result = await requestService.searchRequests(
        {},
        {
          page: parseInt(page),
          pageSize: parseInt(pageSize),
          sortBy,
          sortOrder,
        }
      );

      res.json(result);
    } catch (error) {
      logger.error("Failed to get requests", { error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/requests/:id
   * Get request by ID
   */
  router.get("/:id", async (req, res) => {
    try {
      const requestId = parseInt(req.params.id);
      const request = await requestService.getRequestById(requestId);

      if (!request) {
        return res.status(404).json({ error: "Request not found" });
      }

      res.json(request);
    } catch (error) {
      logger.error("Failed to get request by ID", { error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/requests/search
   * Search requests with filters
   *
   * Body: {
   *   filters: {
   *     user_id, method, path, app_version, app_language,
   *     app_platform, app_environment, created_after, created_before
   *   },
   *   options: {
   *     page, pageSize, sortBy, sortOrder
   *   }
   * }
   */
  router.post("/search", async (req, res) => {
    try {
      const { filters = {}, options = {} } = req.body;

      const result = await requestService.searchRequests(filters, options);

      res.json(result);
    } catch (error) {
      logger.error("Failed to search requests", { error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/requests/endpoints
   * Get unique endpoints
   */
  router.get("/meta/endpoints", async (req, res) => {
    try {
      const endpoints = await requestService.getUniqueEndpoints();
      res.json({ endpoints, count: endpoints.length });
    } catch (error) {
      logger.error("Failed to get unique endpoints", { error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/requests/stats
   * Get request statistics
   * Query params: dimension (app_version, app_language, app_platform, app_environment)
   */
  router.get("/meta/stats", async (req, res) => {
    try {
      const { dimension } = req.query;

      if (!dimension) {
        // Get general statistics
        const stats = await requestService.getServiceStats();
        return res.json(stats);
      }

      // Get statistics by dimension
      const stats = await requestService.getStatsByDimension(dimension);
      res.json({ dimension, stats });
    } catch (error) {
      logger.error("Failed to get request stats", { error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/requests/stats/endpoints
   * Get endpoint statistics
   */
  router.get("/meta/stats/endpoints", async (req, res) => {
    try {
      const filters = {};

      // Extract filters from query params
      if (req.query.app_version) filters.app_version = req.query.app_version;
      if (req.query.app_language) filters.app_language = req.query.app_language;
      if (req.query.app_platform) filters.app_platform = req.query.app_platform;
      if (req.query.app_environment) filters.app_environment = req.query.app_environment;

      const stats = await requestService.getEndpointStats(filters);
      res.json({ stats, count: stats.length });
    } catch (error) {
      logger.error("Failed to get endpoint stats", { error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}

module.exports = initializeRoutes;
