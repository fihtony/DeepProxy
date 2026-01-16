/**
 * modes.js
 *
 * API routes for proxy mode management
 *
 * Endpoints:
 * - GET    /api/modes              - Get current mode and available modes
 * - POST   /api/modes/set          - Set proxy mode
 * - GET    /api/modes/stats        - Get mode statistics
 * - POST   /api/modes/replay/fallback - Configure replay fallback
 * - POST   /api/modes/replay/test-match - Test if request has match
 * - POST   /api/modes/replay/matches - Get all matches for request
 * - GET    /api/modes/health       - Get system health status
 */

const express = require("express");
const logger = require("../../utils/logger");

const router = express.Router();

/**
 * Initialize routes with ModeService instance
 * @param {ModeService} modeService - The ModeService instance (already initialized from database)
 */
function initializeRoutes(modeService) {
  /**
   * GET /api/modes or /admin/mode
   * Get current mode and available modes information
   */
  router.get("/", (req, res) => {
    try {
      const info = modeService.getModesInfo();
      res.json(info);
    } catch (error) {
      logger.error("Failed to get modes info", { error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /admin/mode (for Web UI compatibility)
   * Get current proxy mode
   */
  router.get("/mode", (req, res) => {
    try {
      const mode = modeService.getCurrentMode();
      res.json({
        success: true,
        data: {
          mode,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      logger.error("Failed to get current mode", { error: error.message });
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * POST /api/modes/set or /admin/mode
   * Set proxy mode
   *
   * Body: {
   *   mode: string (passthrough, recording, replay)
   * }
   */
  router.post("/set", async (req, res) => {
    try {
      const { mode } = req.body;

      if (!mode) {
        return res.status(400).json({ error: "mode is required" });
      }

      const result = await modeService.setMode(mode);

      res.json({
        message: "Mode changed successfully",
        ...result,
      });
    } catch (error) {
      logger.error("Failed to set mode", { error: error.message });
      res.status(400).json({ error: error.message });
    }
  });

  /**
   * POST /admin/mode (for Web UI compatibility)
   * Set proxy mode
   */
  router.post("/mode", async (req, res) => {
    try {
      const { mode } = req.body;

      if (!mode) {
        return res.status(400).json({ success: false, error: "mode is required" });
      }

      const result = await modeService.setMode(mode);

      res.json({
        success: true,
        message: "Mode changed successfully",
        data: result,
      });
    } catch (error) {
      logger.error("Failed to set mode", { error: error.message });
      res.status(400).json({ success: false, error: error.message });
    }
  });

  /**
   * GET /api/modes/current
   * Get current proxy mode
   */
  router.get("/current", (req, res) => {
    try {
      const mode = modeService.getCurrentMode();
      res.json({
        mode,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error("Failed to get current mode", { error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/modes/stats
   * Get mode statistics
   * Query params: mode (optional, defaults to current mode)
   */
  router.get("/stats", (req, res) => {
    try {
      const { mode } = req.query;

      if (mode && !["passthrough", "recording", "replay"].includes(mode)) {
        return res.status(400).json({ error: "Invalid mode parameter" });
      }

      const stats = mode ? modeService.getStats(mode) : modeService.getAllStats();

      res.json(stats);
    } catch (error) {
      logger.error("Failed to get mode stats", { error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/modes/replay/fallback
   * Configure replay mode fallback behavior
   *
   * Body: {
   *   behavior: string (error, passthrough, template),
   *   options: object (optional, e.g. { statusCode: 404 })
   * }
   */
  router.post("/replay/fallback", (req, res) => {
    try {
      const { behavior, options = {} } = req.body;

      if (!behavior) {
        return res.status(400).json({ error: "behavior is required" });
      }

      const validBehaviors = ["error", "passthrough", "template"];
      if (!validBehaviors.includes(behavior)) {
        return res.status(400).json({
          error: `Invalid behavior. Valid values: ${validBehaviors.join(", ")}`,
        });
      }

      modeService.configureReplayFallback(behavior, options);

      res.json({
        message: "Replay fallback configured successfully",
        behavior,
        options,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error("Failed to configure replay fallback", { error: error.message });
      res.status(400).json({ error: error.message });
    }
  });

  /**
   * POST /api/modes/replay/test-match
   * Test if request has a match in replay mode
   *
   * Body: {
   *   method: string,
   *   path: string,
   *   headers: object (optional),
   *   body: object (optional)
   * }
   */
  router.post("/replay/test-match", async (req, res) => {
    try {
      const requestData = req.body;

      if (!requestData.method || !requestData.path) {
        return res.status(400).json({ error: "method and path are required" });
      }

      // Create a minimal RequestContext-like object
      const mockContext = {
        getMethod: () => requestData.method,
        getPath: () => requestData.path,
        getHeader: (name) => {
          if (!requestData.headers) return null;
          return requestData.headers[name.toLowerCase()] || null;
        },
      };

      const hasMatch = await modeService.testMatch(mockContext);

      res.json({
        hasMatch,
        method: requestData.method,
        path: requestData.path,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error("Failed to test match", { error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/modes/replay/matches
   * Get all matching requests for a request
   *
   * Body: {
   *   method: string,
   *   path: string,
   *   headers: object (optional),
   *   body: object (optional),
   *   limit: number (optional, default 10)
   * }
   */
  router.post("/replay/matches", async (req, res) => {
    try {
      const requestData = req.body;
      const { limit = 10 } = requestData;

      if (!requestData.method || !requestData.path) {
        return res.status(400).json({ error: "method and path are required" });
      }

      // Create a minimal RequestContext-like object
      const mockContext = {
        getMethod: () => requestData.method,
        getPath: () => requestData.path,
        getHeader: (name) => {
          if (!requestData.headers) return null;
          return requestData.headers[name.toLowerCase()] || null;
        },
      };

      const matches = await modeService.getAllMatches(mockContext, limit);

      res.json({
        matches,
        count: matches.length,
        limit,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error("Failed to get all matches", { error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/modes/certs/clear
   * Clear certificate cache to force regeneration of host certificates
   */
  router.post("/certs/clear", async (req, res) => {
    try {
      const CertManager = require("../../core/forwarder/CertManager");
      const certManager = CertManager.getInstance();

      certManager.clearCache();
      const stats = certManager.getCacheStats();

      res.json({
        success: true,
        message: "Certificate cache cleared successfully",
        cacheStats: stats,
      });
    } catch (error) {
      logger.error("Failed to clear certificate cache", { error: error.message });
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * GET /api/modes/health
   * Get system health status
   */
  router.get("/health", async (req, res) => {
    try {
      const health = await modeService.getHealthStatus();

      const statusCode = health.status === "healthy" ? 200 : 503;
      res.status(statusCode).json(health);
    } catch (error) {
      logger.error("Failed to get health status", { error: error.message });
      res.status(503).json({
        status: "unhealthy",
        error: error.message,
        timestamp: new Date().toISOString(),
      });
    }
  });

  return router;
}

module.exports = initializeRoutes;
