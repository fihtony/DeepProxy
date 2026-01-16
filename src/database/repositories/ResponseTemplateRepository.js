/**
 * ResponseTemplateRepository - Repository for dproxy_response_templates table
 *
 * Purpose:
 * - Manage response templates
 * - Provide predefined templates by status code
 * - Support custom template creation
 * - Enable template-based response generation
 */

const BaseRepository = require("./BaseRepository");
const { getLocalISOString } = require("../../utils/datetimeUtils");

class ResponseTemplateRepository extends BaseRepository {
  constructor(db) {
    super(db, "dproxy_response_templates");
  }

  /**
   * Find template by status code
   * @param {number} status - HTTP status code
   * @returns {Promise<Object|null>} Template or null
   */
  async findByStatus(status) {
    return await this.findOne({ response_status: status });
  }

  /**
   * Find all system templates
   * @returns {Promise<Array>} Array of system templates
   */
  async findAllSystemTemplates() {
    return await this.findBy(
      { is_system_template: 1 },
      {
        orderBy: "response_status",
        orderDir: "ASC",
      }
    );
  }

  /**
   * Find all custom templates
   * @returns {Promise<Array>} Array of custom templates
   */
  async findAllCustomTemplates() {
    return await this.findBy(
      { is_system_template: 0 },
      {
        orderBy: "response_status",
        orderDir: "ASC",
      }
    );
  }

  /**
   * Find all templates
   * @returns {Promise<Array>} Array of all templates
   */
  async findAllTemplates() {
    return await this.findAll({
      orderBy: "response_status",
      orderDir: "ASC",
    });
  }

  /**
   * Create custom template
   * @param {Object} templateData - Template data
   * @returns {Promise<number>} Created template ID
   */
  async createTemplate(templateData) {
    const data = {
      response_status: templateData.status,
      template_name: templateData.name,
      description: templateData.description || null,
      default_headers: JSON.stringify(templateData.headers || { "content-type": "application/json" }),
      default_body: templateData.body ? JSON.stringify(templateData.body) : null,
      is_system_template: 0, // Custom templates are not system templates
    };

    return await this.create(data);
  }

  /**
   * Update template
   * @param {number} templateId - Template ID
   * @param {Object} updates - Updated data
   * @returns {Promise<number>} Number of affected rows
   */
  async updateTemplate(templateId, updates) {
    const data = {};

    if (updates.name !== undefined) {
      data.template_name = updates.name;
    }
    if (updates.description !== undefined) {
      data.description = updates.description;
    }
    if (updates.headers !== undefined) {
      data.default_headers = JSON.stringify(updates.headers);
    }
    if (updates.body !== undefined) {
      data.default_body = JSON.stringify(updates.body);
    }

    // Always update the updated_at timestamp when modifying a template
    data.updated_at = getLocalISOString();

    return await this.update(templateId, data);
  }

  /**
   * Delete custom template
   * @param {number} templateId - Template ID
   * @returns {Promise<number>} Number of deleted rows
   */
  async deleteTemplate(templateId) {
    // Only allow deletion of custom templates
    const template = await this.findById(templateId);

    if (!template) {
      throw new Error(`Template ${templateId} not found`);
    }

    if (template.is_system_template === 1) {
      throw new Error("Cannot delete system template");
    }

    return await this.delete(templateId);
  }

  /**
   * Check if status code has template
   * @param {number} status - HTTP status code
   * @returns {Promise<boolean>} True if template exists
   */
  async hasTemplateForStatus(status) {
    return await this.exists({ response_status: status });
  }

  /**
   * Get template for status or default
   * @param {number} status - HTTP status code
   * @returns {Promise<Object>} Template (exact or closest match)
   */
  async getTemplateForStatus(status) {
    // Try exact match first
    let template = await this.findByStatus(status);

    if (template) {
      return template;
    }

    // If not found, try to get closest match based on status category
    const statusCategory = Math.floor(status / 100);

    const categoryDefaults = {
      2: 200, // Success -> 200 OK
      3: 302, // Redirect -> 302 Found
      4: 400, // Client error -> 400 Bad Request
      5: 500, // Server error -> 500 Internal Server Error
    };

    const defaultStatus = categoryDefaults[statusCategory] || 500;
    template = await this.findByStatus(defaultStatus);

    return template || null;
  }

  /**
   * Get templates by status range
   * @param {number} minStatus - Minimum status code
   * @param {number} maxStatus - Maximum status code
   * @returns {Promise<Array>} Array of templates
   */
  async findByStatusRange(minStatus, maxStatus) {
    const sql = `
      SELECT * FROM ${this.tableName}
      WHERE response_status >= ? AND response_status <= ?
      ORDER BY response_status ASC
    `;

    return await this.db.all(sql, [minStatus, maxStatus]);
  }

  /**
   * Get success templates (2xx)
   * @returns {Promise<Array>} Array of success templates
   */
  async getSuccessTemplates() {
    return await this.findByStatusRange(200, 299);
  }

  /**
   * Get error templates (4xx, 5xx)
   * @returns {Promise<Array>} Array of error templates
   */
  async getErrorTemplates() {
    return await this.findByStatusRange(400, 599);
  }

  /**
   * Count templates by type
   * @returns {Promise<Object>} Count by type
   */
  async countByType() {
    const sql = `
      SELECT 
        is_system_template,
        COUNT(*) as count
      FROM ${this.tableName}
      GROUP BY is_system_template
    `;

    const rows = await this.db.all(sql);

    const result = { system: 0, custom: 0 };
    rows.forEach((row) => {
      if (row.is_system_template === 1) {
        result.system = row.count;
      } else {
        result.custom = row.count;
      }
    });

    return result;
  }

  /**
   * Get template statistics
   * @returns {Promise<Object>} Statistics object
   */
  async getStats() {
    const sql = `
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN is_system_template = 1 THEN 1 ELSE 0 END) as system_count,
        SUM(CASE WHEN is_system_template = 0 THEN 1 ELSE 0 END) as custom_count,
        MIN(response_status) as min_status,
        MAX(response_status) as max_status
      FROM ${this.tableName}
    `;

    return await this.db.get(sql);
  }

  /**
   * Clone system template to create custom template
   * @param {number} status - Status code to clone
   * @param {Object} overrides - Override properties
   * @returns {Promise<number>} Created template ID
   */
  async cloneSystemTemplate(status, overrides = {}) {
    const systemTemplate = await this.findByStatus(status);

    if (!systemTemplate) {
      throw new Error(`System template for status ${status} not found`);
    }

    const templateData = {
      status: overrides.status || systemTemplate.response_status,
      name: overrides.name || `${systemTemplate.template_name} (Custom)`,
      description: overrides.description || systemTemplate.description,
      headers: overrides.headers || JSON.parse(systemTemplate.default_headers),
      body: overrides.body || (systemTemplate.default_body ? JSON.parse(systemTemplate.default_body) : null),
    };

    return await this.createTemplate(templateData);
  }

  /**
   * Seed system templates (for initial setup)
   * @returns {Promise<void>}
   */
  async seedSystemTemplates() {
    const systemTemplates = [
      {
        status: 200,
        name: "OK",
        description: "Standard successful response",
        headers: { "content-type": "application/json" },
        body: { success: true, message: "Request successful", data: null },
      },
      {
        status: 201,
        name: "Created",
        description: "Resource successfully created",
        headers: { "content-type": "application/json" },
        body: { success: true, message: "Resource created", data: { id: null } },
      },
      {
        status: 400,
        name: "Bad Request",
        description: "Client request error",
        headers: { "content-type": "application/json" },
        body: { error: true, status: 400, message: "Bad Request", details: null },
      },
      {
        status: 401,
        name: "Unauthorized",
        description: "Authentication required",
        headers: { "content-type": "application/json", "www-authenticate": "Bearer" },
        body: { error: true, status: 401, message: "Unauthorized - Authentication required" },
      },
      {
        status: 404,
        name: "Not Found",
        description: "Resource not found",
        headers: { "content-type": "application/json" },
        body: { error: true, status: 404, message: "Not Found - The requested resource does not exist" },
      },
      {
        status: 500,
        name: "Internal Server Error",
        description: "Server error",
        headers: { "content-type": "application/json" },
        body: { error: true, status: 500, message: "Internal Server Error - Something went wrong" },
      },
    ];

    for (const template of systemTemplates) {
      // Check if template already exists
      const existing = await this.findByStatus(template.status);
      if (!existing) {
        await this.create({
          response_status: template.status,
          template_name: template.name,
          description: template.description,
          default_headers: JSON.stringify(template.headers),
          default_body: JSON.stringify(template.body),
          is_system_template: 1,
        });
      }
    }
  }
}

module.exports = ResponseTemplateRepository;
