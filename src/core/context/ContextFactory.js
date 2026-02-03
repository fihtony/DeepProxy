/**
 * ContextFactory - Factory for creating Request and Response contexts
 *
 * Purpose:
 * - Centralize context creation logic
 * - Provide consistent context initialization
 * - Support different creation scenarios (from Express, from database, from template)
 * - Enable context cloning and transformation
 *
 * Usage:
 * const reqContext = ContextFactory.createRequestContext(req);
 * const resContext = ContextFactory.createResponseContext();
 * const cloned = ContextFactory.cloneRequestContext(reqContext);
 */

const RequestContext = require("./RequestContext");
const ResponseContext = require("./ResponseContext");
const { decompressResponseBody } = require("../../utils/bodySerializer");

class ContextFactory {
  /**
   * Create RequestContext from Express request object
   * @param {Object} req - Express request object
   * @param {Object} options - Additional options
   * @returns {RequestContext} Request context instance
   */
  static createRequestContext(req, options = {}) {
    const context = new RequestContext(req);

    // Set metadata from options
    if (options.userId) {
      context.setMetadata("userId", options.userId);
    }
    if (options.sessionId) {
      context.setMetadata("sessionId", options.sessionId);
    }
    if (options.mode) {
      context.setMetadata("mode", options.mode);
    }

    // Add any additional metadata
    if (options.metadata) {
      Object.entries(options.metadata).forEach(([key, value]) => {
        context.setMetadata(key, value);
      });
    }

    return context;
  }

  /**
   * Create ResponseContext
   * @param {Object} options - Response options
   * @returns {ResponseContext} Response context instance
   */
  static createResponseContext(options = {}) {
    return new ResponseContext(options);
  }

  /**
   * Create ResponseContext from backend HTTP response
   * Decompresses gzip/deflate/br body so stored response is plain JSON/text for DB and display.
   * @param {Object} response - HTTP response object (status, headers, data)
   * @returns {ResponseContext} Response context instance
   */
  static createResponseContextFromHttp(response) {
    let body = response.data;
    let headers = response.headers ? { ...response.headers } : {};

    const contentEncoding = headers["content-encoding"];
    if (Buffer.isBuffer(body) && body.length > 0 && contentEncoding) {
      const decompressed = decompressResponseBody(body, contentEncoding);
      if (decompressed) {
        body = decompressed;
        delete headers["content-encoding"];
        headers["content-length"] = String(decompressed.length);
      }
    }

    return new ResponseContext({
      status: response.status,
      statusText: response.statusText,
      headers,
      body,
      source: "backend",
    });
  }

  /**
   * Create ResponseContext from database record
   * @param {Object} record - Database response record
   * @returns {ResponseContext} Response context instance
   */
  static createResponseContextFromDatabase(record) {
    return ResponseContext.fromDatabase(record);
  }

  /**
   * Create ResponseContext from template
   * @param {Object} template - Response template record
   * @returns {ResponseContext} Response context instance
   */
  static createResponseContextFromTemplate(template) {
    return ResponseContext.fromTemplate(template);
  }

  /**
   * Clone RequestContext
   * @param {RequestContext} context - Source context
   * @returns {RequestContext} Cloned context
   */
  static cloneRequestContext(context) {
    const cloned = Object.assign(Object.create(Object.getPrototypeOf(context)), JSON.parse(JSON.stringify(context)));
    return cloned;
  }

  /**
   * Clone ResponseContext
   * @param {ResponseContext} context - Source context
   * @returns {ResponseContext} Cloned context
   */
  static cloneResponseContext(context) {
    const cloned = Object.assign(Object.create(Object.getPrototypeOf(context)), JSON.parse(JSON.stringify(context)));
    return cloned;
  }

  /**
   * Create error response context
   * @param {number} status - HTTP status code
   * @param {string} message - Error message
   * @param {Object} options - Additional options
   * @returns {ResponseContext} Error response context
   */
  static createErrorResponse(status, message, options = {}) {
    const context = new ResponseContext({
      status,
      headers: {
        "content-type": "application/json",
        ...(options.headers || {}),
      },
      body: {
        error: true,
        message,
        status,
        timestamp: new Date().toISOString(),
        ...(options.details || {}),
      },
      source: options.source || "dproxy",
    });

    if (options.error) {
      context.setError(options.error);
    }

    return context;
  }

  /**
   * Create success response context
   * @param {*} data - Response data
   * @param {Object} options - Additional options
   * @returns {ResponseContext} Success response context
   */
  static createSuccessResponse(data, options = {}) {
    return new ResponseContext({
      status: options.status || 200,
      headers: {
        "content-type": "application/json",
        ...(options.headers || {}),
      },
      body: data,
      source: options.source || "backend",
    });
  }
}

module.exports = ContextFactory;
