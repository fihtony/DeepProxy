/**
 * ResponseContext - Encapsulates HTTP response data and modifications
 *
 * Purpose:
 * - Store response details (status, headers, body, source)
 * - Track modifications made by interceptors
 * - Support multiple response sources (backend, dproxy, custom)
 * - Enable response transformation and validation
 *
 * Usage:
 * const context = new ResponseContext();
 * context.setStatus(200);
 * context.setHeader('Content-Type', 'application/json');
 * context.setBody({ data: 'result' });
 * context.setSource('backend');
 */

class ResponseContext {
  /**
   * @param {Object} options - Initial response options
   */
  constructor(options = {}) {
    // Current response state
    this.status = options.status || 200;
    this.statusText = options.statusText || "";
    this.headers = options.headers ? { ...options.headers } : {};
    this.body = options.body !== undefined ? this._deepClone(options.body) : null;

    // Response metadata
    this.metadata = {
      source: options.source || null, // 'backend', 'dproxy', 'custom'
      templateId: options.templateId || null,
      apiResponseId: options.apiResponseId || null,
      timestamp: Date.now(),
      latency: null,
      error: null,
    };

    // Modification history
    this.modifications = [];

    // Original snapshot (for rollback)
    this.original = {
      status: this.status,
      statusText: this.statusText,
      headers: { ...this.headers },
      body: this._deepClone(this.body),
    };
  }

  /**
   * Set HTTP status code
   * @param {number} status - HTTP status code
   * @param {string} statusText - Optional status text
   */
  setStatus(status, statusText = "") {
    this._recordModification("status", this.status, status);
    this.status = status;
    if (statusText) {
      this.statusText = statusText;
    }
  }

  /**
   * Get HTTP status code
   * @returns {number} Status code
   */
  getStatus() {
    return this.status;
  }

  /**
   * Set single header
   * @param {string} name - Header name
   * @param {string|string[]} value - Header value
   */
  setHeader(name, value) {
    const lowerName = name.toLowerCase();
    this._recordModification(`header.${lowerName}`, this.headers[lowerName], value);
    this.headers[lowerName] = value;
  }

  /**
   * Set multiple headers
   * @param {Object} headers - Headers object
   */
  setHeaders(headers) {
    Object.entries(headers).forEach(([name, value]) => {
      this.setHeader(name, value);
    });
  }

  /**
   * Get header value
   * @param {string} name - Header name
   * @returns {string|string[]|undefined} Header value
   */
  getHeader(name) {
    return this.headers[name.toLowerCase()];
  }

  /**
   * Get all headers
   * @returns {Object} Headers object
   */
  getHeaders() {
    return { ...this.headers };
  }

  /**
   * Remove header
   * @param {string} name - Header name
   */
  removeHeader(name) {
    const lowerName = name.toLowerCase();
    if (this.headers[lowerName]) {
      this._recordModification(`header.${lowerName}`, this.headers[lowerName], undefined);
      delete this.headers[lowerName];
    }
  }

  /**
   * Set response body
   * @param {*} body - Response body (object, string, buffer)
   */
  setBody(body) {
    this._recordModification("body", this.body, body);
    this.body = this._deepClone(body);
  }

  /**
   * Get response body
   * @returns {*} Response body
   */
  getBody() {
    return this.body;
  }

  /**
   * Set response source
   * @param {string} source - 'backend', 'dproxy', or 'custom'
   */
  setSource(source) {
    const validSources = ["backend", "dproxy", "custom"];
    if (!validSources.includes(source)) {
      throw new Error(`Invalid source: ${source}. Must be one of: ${validSources.join(", ")}`);
    }
    this.metadata.source = source;
  }

  /**
   * Get response source
   * @returns {string|null} Response source
   */
  getSource() {
    return this.metadata.source;
  }

  /**
   * Set template ID (for dproxy responses)
   * @param {number} templateId - Template ID
   */
  setTemplateId(templateId) {
    this.metadata.templateId = templateId;
  }

  /**
   * Set API response ID (for recorded responses)
   * @param {number} responseId - Response ID from database
   */
  setApiResponseId(responseId) {
    this.metadata.apiResponseId = responseId;
  }

  /**
   * Set response latency
   * @param {number} latency - Latency in milliseconds
   */
  setLatency(latency) {
    this.metadata.latency = latency;
  }

  /**
   * Set error information
   * @param {Error|string} error - Error object or message
   */
  setError(error) {
    this.metadata.error =
      error instanceof Error
        ? {
            message: error.message,
            stack: error.stack,
            code: error.code,
          }
        : error;
  }

  /**
   * Check if response has error
   * @returns {boolean} True if error exists
   */
  hasError() {
    return this.metadata.error !== null;
  }

  /**
   * Set metadata field
   * @param {string} key - Metadata key
   * @param {*} value - Metadata value
   */
  setMetadata(key, value) {
    this.metadata[key] = value;
  }

  /**
   * Get metadata field
   * @param {string} key - Metadata key
   * @returns {*} Metadata value
   */
  getMetadata(key) {
    return this.metadata[key];
  }

  /**
   * Get all metadata
   * @returns {Object} Metadata object
   */
  getAllMetadata() {
    return { ...this.metadata };
  }

  /**
   * Check if response has been modified
   * @returns {boolean} True if modifications exist
   */
  hasModifications() {
    return this.modifications.length > 0;
  }

  /**
   * Get all modifications
   * @returns {Array} Array of modification records
   */
  getModifications() {
    return [...this.modifications];
  }

  /**
   * Rollback to original state
   */
  rollback() {
    this.status = this.original.status;
    this.statusText = this.original.statusText;
    this.headers = { ...this.original.headers };
    this.body = this._deepClone(this.original.body);
    this.modifications = [];
  }

  /**
   * Export context to JSON
   * @returns {Object} JSON representation
   */
  toJSON() {
    return {
      status: this.status,
      statusText: this.statusText,
      headers: this.headers,
      body: this.body,
      metadata: this.metadata,
      modifications: this.modifications,
      hasModifications: this.hasModifications(),
    };
  }

  /**
   * Create response from database record
   * @param {Object} record - Database response record
   * @returns {ResponseContext} Response context instance
   */
  static fromDatabase(record) {
    const headers = typeof record.response_headers === "string" ? JSON.parse(record.response_headers) : record.response_headers;

    let body = typeof record.response_body === "string" ? JSON.parse(record.response_body) : record.response_body;

    // Convert Buffer representation back to Buffer
    if (body && typeof body === "object" && body.type === "Buffer" && Array.isArray(body.data)) {
      body = Buffer.from(body.data);
    }

    return new ResponseContext({
      status: record.response_status,
      headers,
      body,
      source: record.response_source,
      apiResponseId: record.id,
    });
  }

  /**
   * Create response from template
   * @param {Object} template - Response template record
   * @returns {ResponseContext} Response context instance
   */
  static fromTemplate(template) {
    const headers = typeof template.default_headers === "string" ? JSON.parse(template.default_headers) : template.default_headers;

    let body = typeof template.default_body === "string" ? JSON.parse(template.default_body) : template.default_body;

    // Convert Buffer representation back to Buffer
    if (body && typeof body === "object" && body.type === "Buffer" && Array.isArray(body.data)) {
      body = Buffer.from(body.data);
    }

    return new ResponseContext({
      status: template.response_status,
      headers,
      body,
      source: "dproxy",
      templateId: template.id,
    });
  }

  /**
   * Record modification for history
   * @private
   */
  _recordModification(field, oldValue, newValue) {
    this.modifications.push({
      field,
      oldValue: this._deepClone(oldValue),
      newValue: this._deepClone(newValue),
      timestamp: Date.now(),
    });
  }

  /**
   * Deep clone an object
   * @private
   */
  _deepClone(obj) {
    if (obj === null || typeof obj !== "object") {
      return obj;
    }
    if (obj instanceof Buffer) {
      return Buffer.from(obj);
    }
    if (obj instanceof Date) {
      return new Date(obj);
    }
    if (Array.isArray(obj)) {
      return obj.map((item) => this._deepClone(item));
    }
    const cloned = {};
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        cloned[key] = this._deepClone(obj[key]);
      }
    }
    return cloned;
  }
}

module.exports = ResponseContext;
