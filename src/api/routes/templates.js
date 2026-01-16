/**
 * templates.js
 *
 * API routes for response template management
 *
 * Endpoints:
 * - GET    /api/templates                  - Get all templates
 * - GET    /api/templates/:id              - Get template by ID
 * - POST   /api/templates                  - Create new template
 * - PUT    /api/templates/:id              - Update template
 * - DELETE /api/templates/:id              - Delete template
 * - POST   /api/templates/:id/activate     - Activate template
 * - POST   /api/templates/:id/deactivate   - Deactivate template
 * - GET    /api/templates/status/:code     - Get templates by status code
 * - POST   /api/templates/:id/clone        - Clone system template
 * - POST   /api/templates/seed             - Seed system templates
 * - POST   /api/templates/apply            - Apply template variables
 * - GET    /api/templates/stats            - Get template statistics
 */

const express = require("express");
const TemplateService = require("../../services/TemplateService");
const logger = require("../../utils/logger");

const router = express.Router();

/**
 * Initialize routes with database connection
 */
function initializeRoutes(db) {
  const templateService = new TemplateService(db);

  /**
   * GET /api/templates
   * Get all templates
   */
  router.get("/", async (req, res) => {
    try {
      const filters = {};

      if (req.query.is_active !== undefined) {
        filters.is_active = req.query.is_active === "true";
      }
      if (req.query.is_system !== undefined) {
        filters.is_system = req.query.is_system === "true";
      }
      if (req.query.status_code) {
        filters.status_code = parseInt(req.query.status_code);
      }

      const templates = await templateService.getAllTemplates(filters);
      res.json({ templates, count: templates.length });
    } catch (error) {
      logger.error("Failed to get templates", { error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/templates/:id
   * Get template by ID
   */
  router.get("/:id", async (req, res) => {
    try {
      const templateId = parseInt(req.params.id);
      const template = await templateService.getTemplateById(templateId);

      if (!template) {
        return res.status(404).json({ error: "Template not found" });
      }

      res.json(template);
    } catch (error) {
      logger.error("Failed to get template by ID", { error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/templates
   * Create new template
   *
   * Body: {
   *   name: string,
   *   description: string,
   *   status_code: number,
   *   headers: object,
   *   body_template: object,
   *   is_active: boolean
   * }
   */
  router.post("/", async (req, res) => {
    try {
      const templateData = req.body;

      const created = await templateService.createTemplate(templateData);

      res.status(201).json({
        message: "Template created successfully",
        template: created,
      });
    } catch (error) {
      logger.error("Failed to create template", { error: error.message });
      res.status(400).json({ error: error.message });
    }
  });

  /**
   * PUT /api/templates/:id
   * Update template
   *
   * Body: Same fields as POST
   */
  router.put("/:id", async (req, res) => {
    try {
      const templateId = parseInt(req.params.id);
      const updates = req.body;

      const updated = await templateService.updateTemplate(templateId, updates);

      res.json({
        message: "Template updated successfully",
        template: updated,
      });
    } catch (error) {
      logger.error("Failed to update template", { error: error.message });
      res.status(400).json({ error: error.message });
    }
  });

  /**
   * DELETE /api/templates/:id
   * Delete template
   */
  router.delete("/:id", async (req, res) => {
    try {
      const templateId = parseInt(req.params.id);

      const deleted = await templateService.deleteTemplate(templateId);

      if (!deleted) {
        return res.status(404).json({ error: "Template not found" });
      }

      res.json({ message: "Template deleted successfully", templateId });
    } catch (error) {
      logger.error("Failed to delete template", { error: error.message });
      res.status(400).json({ error: error.message });
    }
  });

  /**
   * POST /api/templates/:id/activate
   * Activate template
   */
  router.post("/:id/activate", async (req, res) => {
    try {
      const templateId = parseInt(req.params.id);

      const updated = await templateService.activateTemplate(templateId);

      res.json({
        message: "Template activated successfully",
        template: updated,
      });
    } catch (error) {
      logger.error("Failed to activate template", { error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/templates/:id/deactivate
   * Deactivate template
   */
  router.post("/:id/deactivate", async (req, res) => {
    try {
      const templateId = parseInt(req.params.id);

      const updated = await templateService.deactivateTemplate(templateId);

      res.json({
        message: "Template deactivated successfully",
        template: updated,
      });
    } catch (error) {
      logger.error("Failed to deactivate template", { error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/templates/status/:code
   * Get templates by status code
   */
  router.get("/status/:code", async (req, res) => {
    try {
      const statusCode = parseInt(req.params.code);

      if (isNaN(statusCode) || statusCode < 100 || statusCode > 599) {
        return res.status(400).json({ error: "Invalid status code" });
      }

      const templates = await templateService.getTemplatesByStatus(statusCode);
      res.json({ templates, count: templates.length, statusCode });
    } catch (error) {
      logger.error("Failed to get templates by status", { error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/templates/status/:code/best
   * Get best template for a status code
   */
  router.get("/status/:code/best", async (req, res) => {
    try {
      const statusCode = parseInt(req.params.code);

      if (isNaN(statusCode) || statusCode < 100 || statusCode > 599) {
        return res.status(400).json({ error: "Invalid status code" });
      }

      const template = await templateService.getTemplateForStatus(statusCode);

      if (!template) {
        return res.status(404).json({
          error: "No template found for status code",
          statusCode,
        });
      }

      res.json(template);
    } catch (error) {
      logger.error("Failed to get template for status", { error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/templates/:id/clone
   * Clone system template for customization
   *
   * Body: {
   *   name: string
   * }
   */
  router.post("/:id/clone", async (req, res) => {
    try {
      const systemTemplateId = parseInt(req.params.id);
      const { name } = req.body;

      if (!name) {
        return res.status(400).json({ error: "name is required" });
      }

      const cloned = await templateService.cloneSystemTemplate(systemTemplateId, name);

      res.status(201).json({
        message: "Template cloned successfully",
        template: cloned,
      });
    } catch (error) {
      logger.error("Failed to clone template", { error: error.message });
      res.status(400).json({ error: error.message });
    }
  });

  /**
   * POST /api/templates/seed
   * Seed system templates
   */
  router.post("/seed", async (req, res) => {
    try {
      const count = await templateService.seedSystemTemplates();

      res.json({
        message: "System templates seeded successfully",
        count,
      });
    } catch (error) {
      logger.error("Failed to seed templates", { error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/templates/apply
   * Apply template variables to body
   *
   * Body: {
   *   templateId: number,
   *   variables: object
   * }
   */
  router.post("/apply", async (req, res) => {
    try {
      const { templateId, variables = {} } = req.body;

      if (!templateId) {
        return res.status(400).json({ error: "templateId is required" });
      }

      const template = await templateService.getTemplateById(templateId);
      if (!template) {
        return res.status(404).json({ error: "Template not found" });
      }

      const result = templateService.applyTemplateVariables(template, variables);

      res.json(result);
    } catch (error) {
      logger.error("Failed to apply template variables", { error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/templates/stats
   * Get template statistics
   */
  router.get("/meta/stats", async (req, res) => {
    try {
      const stats = await templateService.getServiceStats();
      res.json(stats);
    } catch (error) {
      logger.error("Failed to get template stats", { error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}

module.exports = initializeRoutes;
