/**
 * RequestContext - Encapsulates incoming HTTP request data and modifications
 *
 * Purpose:
 * - Store original request details (method, URL, headers, body)
 * - Track modifications made by interceptors
 * - Provide immutable access to original data
 * - Enable rollback and modification history
 *
 * Usage:
 * const context = new RequestContext(req);
 * context.setHeader('X-Custom', 'value');
 * context.setBody({ modified: true });
 * const modified = context.hasModifications();
 */

class RequestContext {
  /**
   * @param {Object} req - Express request object
   */
  constructor(req) {
    // Store the original Express request object for streaming operations
    this.expressRequest = req;

    // Store raw body Buffer for exact byte forwarding (signature verification)
    this.rawBody = req.rawBody || null;

    // Debug logging: confirm rawBody was received
    const logger = require("../../utils/logger");
    if (req.path && (req.path.includes("/transmit") || req.method === "POST")) {
      logger.info("[RequestContext] Constructor", {
        path: req.path,
        method: req.method,
        hasReqRawBody: !!req.rawBody,
        reqRawBodyLength: req.rawBody ? req.rawBody.length : 0,
        hasContextRawBody: !!this.rawBody,
        contextRawBodyLength: this.rawBody ? this.rawBody.length : 0,
      });
    }

    // Original immutable request data
    this.original = {
      method: req.method,
      url: req.url,
      originalUrl: req.originalUrl, // Include originalUrl with query params
      path: req.path,
      query: { ...req.query },
      headers: { ...req.headers },
      body: this._deepClone(req.body),
      params: { ...req.params },
      ip: req.ip,
      protocol: req.protocol,
      hostname: req.hostname,
      secure: req.secure, // Express secure flag (true for HTTPS)
      timestamp: Date.now(),
    };

    // Current mutable state
    this.current = {
      method: this.original.method,
      url: this.original.url,
      originalUrl: this.original.originalUrl,
      path: this.original.path,
      query: { ...this.original.query },
      headers: { ...this.original.headers },
      body: this._deepClone(this.original.body),
      params: { ...this.original.params },
    };

    // Modification history
    this.modifications = [];

    // Metadata
    this.metadata = {
      userId: null,
      sessionId: null,
      mode: null,
      matched: false,
      matchedResponseId: null,
    };
  }

  /**
   * Get original request data (immutable)
   */
  getOriginal() {
    return this.original;
  }

  /**
   * Get current request state (mutable)
   */
  getCurrent() {
    return this.current;
  }

  /**
   * Set HTTP method
   * @param {string} method - HTTP method (GET, POST, etc.)
   */
  setMethod(method) {
    this._recordModification("method", this.current.method, method);
    this.current.method = method.toUpperCase();
  }

  /**
   * Set request URL
   * @param {string} url - Full URL
   */
  setUrl(url) {
    this._recordModification("url", this.current.url, url);
    this.current.url = url;
  }

  /**
   * Set request path
   * @param {string} path - URL path
   */
  setPath(path) {
    this._recordModification("path", this.current.path, path);
    this.current.path = path;
  }

  /**
   * Set single header
   * @param {string} name - Header name
   * @param {string|string[]} value - Header value
   */
  setHeader(name, value) {
    const lowerName = name.toLowerCase();
    this._recordModification(`header.${lowerName}`, this.current.headers[lowerName], value);
    this.current.headers[lowerName] = value;
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
   * Remove header
   * @param {string} name - Header name
   */
  removeHeader(name) {
    const lowerName = name.toLowerCase();
    if (this.current.headers[lowerName]) {
      this._recordModification(`header.${lowerName}`, this.current.headers[lowerName], undefined);
      delete this.current.headers[lowerName];
    }
  }

  /**
   * Set request body
   * @param {*} body - Request body (object, string, buffer)
   */
  setBody(body) {
    this._recordModification("body", this.current.body, body);
    this.current.body = this._deepClone(body);
  }

  /**
   * Set query parameter
   * @param {string} key - Query parameter key
   * @param {string} value - Query parameter value
   */
  setQuery(key, value) {
    this._recordModification(`query.${key}`, this.current.query[key], value);
    this.current.query[key] = value;
  }

  /**
   * Set multiple query parameters
   * @param {Object} query - Query parameters object
   */
  setQueryParams(query) {
    Object.entries(query).forEach(([key, value]) => {
      this.setQuery(key, value);
    });
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
   * Convenience getter for HTTP method
   * @returns {string} HTTP method
   */
  getMethod() {
    return this.current.method;
  }

  /**
   * Convenience getter for request path
   * @returns {string} Request path
   */
  getPath() {
    return this.current.path;
  }

  /**
   * Get actual request path for proxy mode
   * In proxy mode, Express sets path to "/" for absolute URLs
   * This method extracts the real path from originalUrl/url
   * @returns {string} Actual request path
   */
  getActualPath() {
    // If path is "/" or empty, try to extract from full URL
    if (!this.current.path || this.current.path === "/") {
      const fullUrl = this.current.originalUrl || this.current.url;
      if (fullUrl && (fullUrl.startsWith("http://") || fullUrl.startsWith("https://"))) {
        try {
          const urlObj = new URL(fullUrl);
          return urlObj.pathname;
        } catch (e) {
          // URL parsing failed, return original path
        }
      }
    }
    return this.current.path;
  }

  /**
   * Convenience getter for request URL
   * @returns {string} Request URL
   */
  getUrl() {
    return this.current.url;
  }

  /**
   * Get original Express request object for streaming operations
   * Used for piping request body to preserve exact bytes
   * @returns {Object} Express request object
   */
  getOriginalRequest() {
    return this.expressRequest;
  }

  /**
   * Get raw request body Buffer for exact byte forwarding
   * Used for signature verification on transmit endpoints
   * @returns {Buffer|null} Raw body buffer
   */
  getRawBody() {
    return this.rawBody;
  }

  /**
   * Convenience getter for specific header
   * @param {string} name - Header name
   * @returns {string|undefined} Header value
   */
  getHeader(name) {
    return this.current.headers[name.toLowerCase()];
  }

  /**
   * Convenience getter for all headers
   * @returns {Object} Headers object
   */
  getHeaders() {
    return { ...this.current.headers };
  }

  /**
   * Convenience getter for request body
   * @returns {*} Request body
   */
  getBody() {
    return this._deepClone(this.current.body);
  }

  /**
   * Convenience getter for query parameter
   * @param {string} key - Query parameter key
   * @returns {string|undefined} Query parameter value
   */
  getQueryParam(key) {
    return this.current.query[key];
  }

  /**
   * Convenience getter for all query parameters
   * @returns {Object} Query parameters object
   */
  getQueryParams() {
    return { ...this.current.query };
  }

  /**
   * Check if request has been modified
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
    this.current = {
      method: this.original.method,
      url: this.original.url,
      path: this.original.path,
      query: { ...this.original.query },
      headers: { ...this.original.headers },
      body: this._deepClone(this.original.body),
      params: { ...this.original.params },
    };
    this.modifications = [];
  }

  /**
   * Export context to JSON
   * @returns {Object} JSON representation
   */
  toJSON() {
    return {
      original: this.original,
      current: this.current,
      modifications: this.modifications,
      metadata: this.metadata,
      hasModifications: this.hasModifications(),
    };
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

module.exports = RequestContext;
