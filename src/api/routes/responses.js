/**
 * responses.js
 *
 * API routes for response management
 *
 * Endpoints:
 * - GET    /api/responses              - Get all responses (with pagination)
 * - GET    /api/responses/:id          - Get response by ID
 * - POST   /api/responses/search       - Search responses
 * - PUT    /api/responses/:id          - Update response
 * - GET    /api/responses/stats/status - Get stats by status code
 * - GET    /api/responses/stats/source - Get stats by source
 * - GET    /api/responses/stats/latency - Get latency statistics
 */

const express = require("express");
const ResponseService = require("../../services/ResponseService");
const logger = require("../../utils/logger");

const router = express.Router();

/**
 * Initialize routes with database connection
 */
function initializeRoutes(db) {
  const responseService = new ResponseService(db);

  /**
   * GET /api/responses
   * Get all responses with pagination
   */
  router.get("/", async (req, res) => {
    try {
      const { page = 1, pageSize = 20, sortBy = "created_at", sortOrder = "DESC" } = req.query;

      const result = await responseService.searchResponses(
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
      logger.error("Failed to get responses", { error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/responses/:id
   * Get response by ID (with request data)
   */
  router.get("/:id", async (req, res) => {
    try {
      const responseId = parseInt(req.params.id);
      const response = await responseService.getResponseWithRequest(responseId);

      if (!response) {
        return res.status(404).json({ error: "Response not found" });
      }

      res.json(response);
    } catch (error) {
      logger.error("Failed to get response by ID", { error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/responses/request/:requestId
   * Get all responses for a request
   */
  router.get("/request/:requestId", async (req, res) => {
    try {
      const requestId = parseInt(req.params.requestId);
      const responses = await responseService.getResponsesByRequestId(requestId);

      res.json({ responses, count: responses.length });
    } catch (error) {
      logger.error("Failed to get responses by request ID", { error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/responses/search
   * Search responses with filters
   *
   * Body: {
   *   filters: {
   *     request_id, status_code, response_source, template_id
   *   },
   *   options: {
   *     page, pageSize, sortBy, sortOrder
   *   }
   * }
   */
  router.post("/search", async (req, res) => {
    try {
      const { filters = {}, options = {} } = req.body;

      const result = await responseService.searchResponses(filters, options);

      res.json(result);
    } catch (error) {
      logger.error("Failed to search responses", { error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * PUT /api/responses/:id
   * Update response
   *
   * Body: {
   *   status_code, headers, body, response_source, template_id
   * }
   */
  router.put("/:id", async (req, res) => {
    try {
      const responseId = parseInt(req.params.id);
      const updates = req.body;

      const updated = await responseService.updateResponse(responseId, updates);

      res.json({ message: "Response updated successfully", response: updated });
    } catch (error) {
      logger.error("Failed to update response", { error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/responses/stats/status
   * Get response statistics by status code
   */
  router.get("/meta/stats/status", async (req, res) => {
    try {
      const filters = {};

      // Extract filters from query params
      if (req.query.created_after) filters.created_after = req.query.created_after;
      if (req.query.created_before) filters.created_before = req.query.created_before;

      const stats = await responseService.getStatsByStatus(filters);
      res.json({ stats });
    } catch (error) {
      logger.error("Failed to get stats by status", { error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/responses/stats/source
   * Get response statistics by source
   */
  router.get("/meta/stats/source", async (req, res) => {
    try {
      const filters = {};

      // Extract filters from query params
      if (req.query.created_after) filters.created_after = req.query.created_after;
      if (req.query.created_before) filters.created_before = req.query.created_before;

      const stats = await responseService.getStatsBySource(filters);
      res.json({ stats });
    } catch (error) {
      logger.error("Failed to get stats by source", { error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/responses/stats/latency
   * Get average latency statistics
   */
  router.get("/meta/stats/latency", async (req, res) => {
    try {
      const filters = {};

      // Extract filters from query params
      if (req.query.response_source) filters.response_source = req.query.response_source;

      const stats = await responseService.getAverageLatency(filters);
      res.json(stats);
    } catch (error) {
      logger.error("Failed to get latency stats", { error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/responses/stats
   * Get general response statistics
   */
  router.get("/meta/stats", async (req, res) => {
    try {
      const stats = await responseService.getServiceStats();
      res.json(stats);
    } catch (error) {
      logger.error("Failed to get response stats", { error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/responses/from-template
   * Create response from template
   *
   * Body: {
   *   requestId: number,
   *   statusCode: number,
   *   variables: object (optional)
   * }
   */
  router.post("/from-template", async (req, res) => {
    try {
      const { requestId, statusCode, variables = {} } = req.body;

      if (!requestId || !statusCode) {
        return res.status(400).json({ error: "requestId and statusCode are required" });
      }

      const response = await responseService.createResponseFromTemplate(requestId, statusCode, variables);

      res.status(201).json({
        message: "Response created from template",
        response,
      });
    } catch (error) {
      logger.error("Failed to create response from template", { error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}

module.exports = initializeRoutes;
