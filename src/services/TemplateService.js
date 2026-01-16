/**
 * TemplateService.js
 *
 * Service layer for managing response templates.
 * Provides business logic for:
 * - Template creation and retrieval
 * - Template management and versioning
 * - System template operations
 */

const ResponseTemplateRepository = require("../database/repositories/ResponseTemplateRepository");
const logger = require("../utils/logger");

class TemplateService {
  constructor(db) {
    if (!db) {
      throw new Error("TemplateService requires a database connection");
    }
    this.templateRepo = new ResponseTemplateRepository(db);
  }

  /**
   * Create a new response template
   * @param {Object} templateData Template data
   * @returns {Promise<Object>} Created template record
   */
  async createTemplate(templateData) {
    try {
      logger.debug("Creating response template", {
        name: templateData.name,
        status_code: templateData.status_code,
      });

      // Validate required fields
      this._validateTemplateData(templateData);

      const record = {
        name: templateData.name,
        description: templateData.description || null,
        status_code: templateData.status_code,
        headers: templateData.headers ? JSON.stringify(templateData.headers) : null,
        body_template: templateData.body_template ? JSON.stringify(templateData.body_template) : null,
        is_system: false, // User-created templates are not system templates
        is_active: templateData.is_active !== false, // default true
      };

      const created = await this.templateRepo.create(record);
      logger.info("Response template created", { template_id: created.id });

      return created;
    } catch (error) {
      logger.error("Failed to create template", { error: error.message });
      throw error;
    }
  }

  /**
   * Get template by ID
   * @param {number} templateId Template ID
   * @returns {Promise<Object|null>} Template record or null
   */
  async getTemplateById(templateId) {
    try {
      return await this.templateRepo.findById(templateId);
    } catch (error) {
      logger.error("Failed to get template by ID", { templateId, error: error.message });
      throw error;
    }
  }

  /**
   * Get all templates
   * @param {Object} filters Optional filters
   * @returns {Promise<Array>} List of templates
   */
  async getAllTemplates(filters = {}) {
    try {
      const where = {};

      if (filters.is_active !== undefined) {
        where.is_active = filters.is_active ? 1 : 0;
      }
      if (filters.is_system !== undefined) {
        where.is_system = filters.is_system ? 1 : 0;
      }
      if (filters.status_code) {
        where.status_code = filters.status_code;
      }

      return await this.templateRepo.findAll({ where });
    } catch (error) {
      logger.error("Failed to get all templates", { error: error.message });
      throw error;
    }
  }

  /**
   * Get templates by status code
   * @param {number} statusCode HTTP status code
   * @returns {Promise<Array>} List of templates
   */
  async getTemplatesByStatus(statusCode) {
    try {
      return await this.templateRepo.findByStatus(statusCode);
    } catch (error) {
      logger.error("Failed to get templates by status", { statusCode, error: error.message });
      throw error;
    }
  }

  /**
   * Get template for a specific status code (prefers active, non-system first)
   * @param {number} statusCode HTTP status code
   * @returns {Promise<Object|null>} Template or null
   */
  async getTemplateForStatus(statusCode) {
    try {
      return await this.templateRepo.getTemplateForStatus(statusCode);
    } catch (error) {
      logger.error("Failed to get template for status", { statusCode, error: error.message });
      throw error;
    }
  }

  /**
   * Update template
   * @param {number} templateId Template ID
   * @param {Object} updates Update data
   * @returns {Promise<Object>} Updated template record
   */
  async updateTemplate(templateId, updates) {
    try {
      logger.debug("Updating template", { templateId });

      // Check if template exists and is not a system template
      const existing = await this.getTemplateById(templateId);
      if (!existing) {
        throw new Error(`Template ${templateId} not found`);
      }
      if (existing.is_system) {
        throw new Error("Cannot modify system templates");
      }

      const allowedFields = ["name", "description", "status_code", "headers", "body_template", "is_active"];

      const updateData = {};
      for (const [key, value] of Object.entries(updates)) {
        if (allowedFields.includes(key)) {
          if (key === "headers" || key === "body_template") {
            updateData[key] = JSON.stringify(value);
          } else {
            updateData[key] = value;
          }
        }
      }

      if (Object.keys(updateData).length === 0) {
        throw new Error("No valid fields to update");
      }

      const updated = await this.templateRepo.update(templateId, updateData);
      logger.info("Template updated", { templateId });

      return updated;
    } catch (error) {
      logger.error("Failed to update template", { templateId, error: error.message });
      throw error;
    }
  }

  /**
   * Delete template
   * @param {number} templateId Template ID
   * @returns {Promise<boolean>} True if deleted
   */
  async deleteTemplate(templateId) {
    try {
      // Check if template exists and is not a system template
      const existing = await this.getTemplateById(templateId);
      if (!existing) {
        throw new Error(`Template ${templateId} not found`);
      }
      if (existing.is_system) {
        throw new Error("Cannot delete system templates");
      }

      const deleted = await this.templateRepo.delete(templateId);
      logger.info("Template deleted", { templateId });
      return deleted;
    } catch (error) {
      logger.error("Failed to delete template", { templateId, error: error.message });
      throw error;
    }
  }

  /**
   * Activate template
   * @param {number} templateId Template ID
   * @returns {Promise<Object>} Updated template
   */
  async activateTemplate(templateId) {
    try {
      return await this.templateRepo.activate(templateId);
    } catch (error) {
      logger.error("Failed to activate template", { templateId, error: error.message });
      throw error;
    }
  }

  /**
   * Deactivate template
   * @param {number} templateId Template ID
   * @returns {Promise<Object>} Updated template
   */
  async deactivateTemplate(templateId) {
    try {
      return await this.templateRepo.deactivate(templateId);
    } catch (error) {
      logger.error("Failed to deactivate template", { templateId, error: error.message });
      throw error;
    }
  }

  /**
   * Clone a system template for customization
   * @param {number} systemTemplateId System template ID
   * @param {string} newName Name for the cloned template
   * @returns {Promise<Object>} Created custom template
   */
  async cloneSystemTemplate(systemTemplateId, newName) {
    try {
      logger.debug("Cloning system template", { systemTemplateId, newName });

      // Verify it's a system template
      const systemTemplate = await this.getTemplateById(systemTemplateId);
      if (!systemTemplate) {
        throw new Error(`Template ${systemTemplateId} not found`);
      }
      if (!systemTemplate.is_system) {
        throw new Error("Can only clone system templates");
      }

      return await this.templateRepo.cloneSystemTemplate(systemTemplateId, newName);
    } catch (error) {
      logger.error("Failed to clone system template", { systemTemplateId, error: error.message });
      throw error;
    }
  }

  /**
   * Seed system templates (initial setup)
   * @returns {Promise<number>} Number of templates seeded
   */
  async seedSystemTemplates() {
    try {
      logger.info("Seeding system templates");
      const count = await this.templateRepo.seedSystemTemplates();
      logger.info("System templates seeded", { count });
      return count;
    } catch (error) {
      logger.error("Failed to seed system templates", { error: error.message });
      throw error;
    }
  }

  /**
   * Apply template variables to body
   * @param {Object} template Template record
   * @param {Object} variables Variables to apply
   * @returns {Object} Response data with variables applied
   */
  applyTemplateVariables(template, variables = {}) {
    try {
      let body = template.body_template;

      // Parse body template
      let bodyObj = {};
      try {
        bodyObj = JSON.parse(body);
      } catch (e) {
        logger.warn("Template body is not JSON, returning as-is");
        return {
          status: template.status_code,
          headers: JSON.parse(template.headers || "{}"),
          body,
        };
      }

      // Apply variables
      const appliedBody = this._applyVariablesToObject(bodyObj, variables);

      // Parse headers
      let headers = {};
      try {
        headers = JSON.parse(template.headers || "{}");
      } catch (e) {
        logger.warn("Failed to parse template headers");
      }

      return {
        status: template.status_code,
        headers,
        body: appliedBody,
      };
    } catch (error) {
      logger.error("Failed to apply template variables", { error: error.message });
      throw error;
    }
  }

  /**
   * Validate template data
   * @param {Object} templateData Template data to validate
   * @throws {Error} If validation fails
   * @private
   */
  _validateTemplateData(templateData) {
    if (!templateData.name) {
      throw new Error("Template name is required");
    }
    if (!templateData.status_code) {
      throw new Error("Template status_code is required");
    }

    const status = parseInt(templateData.status_code);
    if (isNaN(status) || status < 100 || status > 599) {
      throw new Error(`Invalid HTTP status code: ${templateData.status_code}`);
    }

    // Validate headers if provided
    if (templateData.headers) {
      if (typeof templateData.headers !== "object") {
        throw new Error("Template headers must be an object");
      }
    }

    // Validate body_template if provided
    if (templateData.body_template) {
      if (typeof templateData.body_template !== "object" && typeof templateData.body_template !== "string") {
        throw new Error("Template body must be an object or string");
      }
    }
  }

  /**
   * Apply variables to object recursively
   * @param {Object} obj Object to apply variables to
   * @param {Object} variables Variables to apply
   * @returns {Object} Object with variables applied
   * @private
   */
  _applyVariablesToObject(obj, variables) {
    const result = Array.isArray(obj) ? [] : {};

    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === "string") {
        // Replace {{variable}} patterns
        result[key] = value.replace(/\{\{(\w+)\}\}/g, (match, varName) => {
          return variables[varName] !== undefined ? variables[varName] : match;
        });
      } else if (typeof value === "object" && value !== null) {
        // Recursively apply to nested objects
        result[key] = this._applyVariablesToObject(value, variables);
      } else {
        result[key] = value;
      }
    }

    return result;
  }

  /**
   * Get service statistics
   * @returns {Promise<Object>} Service statistics
   */
  async getServiceStats() {
    try {
      const totalTemplates = await this.templateRepo.count();
      const activeTemplates = await this.templateRepo.count({ is_active: 1 });
      const systemTemplates = await this.templateRepo.count({ is_system: 1 });
      const userTemplates = totalTemplates - systemTemplates;

      // Get templates by status code
      const allTemplates = await this.getAllTemplates();
      const byStatus = {};
      for (const template of allTemplates) {
        byStatus[template.status_code] = (byStatus[template.status_code] || 0) + 1;
      }

      return {
        totalTemplates,
        activeTemplates,
        systemTemplates,
        userTemplates,
        byStatus,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      logger.error("Failed to get service stats", { error: error.message });
      throw error;
    }
  }
}

module.exports = TemplateService;
