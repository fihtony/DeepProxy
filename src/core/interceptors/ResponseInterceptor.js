/**
 * ResponseInterceptor - Base class for response interception and modification
 *
 * Purpose:
 * - Define standard interface for response interceptors
 * - Support async response processing
 * - Enable response transformation, validation, and logging
 * - Provide hooks for before/after operations
 *
 * Lifecycle:
 * 1. beforeIntercept() - Setup/validation
 * 2. intercept() - Main processing logic
 * 3. afterIntercept() - Cleanup/logging
 *
 * Usage:
 * class MyInterceptor extends ResponseInterceptor {
 *   async intercept(context) {
 *     context.setHeader('X-Custom', 'value');
 *     return context;
 *   }
 * }
 */

class ResponseInterceptor {
  /**
   * @param {Object} options - Interceptor options
   */
  constructor(options = {}) {
    this.name = options.name || this.constructor.name;
    this.enabled = options.enabled !== false;
    this.priority = options.priority || 0; // Higher priority runs first
    this.config = options.config || {};
  }

  /**
   * Execute interceptor (template method pattern)
   * @param {ResponseContext} context - Response context
   * @param {RequestContext} requestContext - Associated request context
   * @returns {Promise<ResponseContext>} Modified context
   */
  async execute(context, requestContext = null) {
    if (!this.enabled) {
      return context;
    }

    try {
      await this.beforeIntercept(context, requestContext);
      const result = await this.intercept(context, requestContext);
      await this.afterIntercept(result, requestContext);
      return result;
    } catch (error) {
      await this.onError(error, context, requestContext);
      throw error;
    }
  }

  /**
   * Pre-interception hook (override in subclass)
   * @param {ResponseContext} context - Response context
   * @param {RequestContext} requestContext - Request context
   * @returns {Promise<void>}
   */
  async beforeIntercept(context, requestContext) {
    // Override in subclass for setup logic
  }

  /**
   * Main interception logic (must override in subclass)
   * @param {ResponseContext} context - Response context
   * @param {RequestContext} requestContext - Request context
   * @returns {Promise<ResponseContext>} Modified context
   */
  async intercept(context, requestContext) {
    throw new Error(`${this.name}.intercept() must be implemented`);
  }

  /**
   * Post-interception hook (override in subclass)
   * @param {ResponseContext} context - Modified context
   * @param {RequestContext} requestContext - Request context
   * @returns {Promise<void>}
   */
  async afterIntercept(context, requestContext) {
    // Override in subclass for cleanup/logging
  }

  /**
   * Error handler (override in subclass)
   * @param {Error} error - Error object
   * @param {ResponseContext} context - Response context
   * @param {RequestContext} requestContext - Request context
   * @returns {Promise<void>}
   */
  async onError(error, context, requestContext) {
    console.error(`[${this.name}] Interceptor error:`, error);
  }

  /**
   * Enable interceptor
   */
  enable() {
    this.enabled = true;
  }

  /**
   * Disable interceptor
   */
  disable() {
    this.enabled = false;
  }

  /**
   * Check if interceptor is enabled
   * @returns {boolean}
   */
  isEnabled() {
    return this.enabled;
  }

  /**
   * Get interceptor name
   * @returns {string}
   */
  getName() {
    return this.name;
  }

  /**
   * Get interceptor priority
   * @returns {number}
   */
  getPriority() {
    return this.priority;
  }

  /**
   * Set configuration
   * @param {Object} config - Configuration object
   */
  setConfig(config) {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get configuration
   * @returns {Object}
   */
  getConfig() {
    return { ...this.config };
  }
}

/**
 * ResponseLoggingInterceptor - Log response details
 */
class ResponseLoggingInterceptor extends ResponseInterceptor {
  constructor(options = {}) {
    super({ name: "ResponseLogging", priority: 10, ...options });
    this.logger = options.logger || console;
  }

  async intercept(context, requestContext) {
    const metadata = context.getAllMetadata();
    const request = requestContext ? requestContext.getCurrent() : {};
    const status = context.getStatus();
    const latency = metadata.latency || 0;
    const timestamp = new Date().toISOString();

    // INFO level: concise summary only (status, method, path, latency)
    const userId = requestContext ? requestContext.getMetadata("userId") : null;
    this.logger.info(
      `[RESPONSE] ${status} ${request.method || "-"} ${request.path || "-"} (${latency}ms)${userId ? ` [user: ${userId}]` : ""}`
    );

    // DEBUG level: detailed response information
    if (this.logger.debug) {
      this.logger.debug(`[RESPONSE_DETAIL] ${status} ${request.method} ${request.path}`, {
        status: status,
        source: context.getSource(),
        latency: latency,
        userId: userId,
        timestamp: timestamp,
      });
    }

    return context;
  }
}

/**
 * ResponseTransformInterceptor - Transform response data
 */
class ResponseTransformInterceptor extends ResponseInterceptor {
  constructor(options = {}) {
    super({ name: "ResponseTransform", priority: 50, ...options });
    this.transformer = options.transformer || ((ctx) => ctx);
  }

  async intercept(context, requestContext) {
    return await this.transformer(context, requestContext);
  }
}

/**
 * CorsHeadersInterceptor - Add CORS headers to response
 */
class CorsHeadersInterceptor extends ResponseInterceptor {
  constructor(options = {}) {
    super({ name: "CorsHeaders", priority: 90, ...options });
    this.allowOrigin = options.allowOrigin || "*";
    this.allowMethods = options.allowMethods || "GET, POST, PUT, DELETE, PATCH, OPTIONS";
    this.allowHeaders = options.allowHeaders || "Content-Type, Authorization, X-User-ID";
  }

  async intercept(context, requestContext) {
    context.setHeader("Access-Control-Allow-Origin", this.allowOrigin);
    context.setHeader("Access-Control-Allow-Methods", this.allowMethods);
    context.setHeader("Access-Control-Allow-Headers", this.allowHeaders);
    context.setHeader("Access-Control-Max-Age", "86400");

    return context;
  }
}

/**
 * SecurityHeadersInterceptor - Add security headers
 */
class SecurityHeadersInterceptor extends ResponseInterceptor {
  constructor(options = {}) {
    super({ name: "SecurityHeaders", priority: 80, ...options });
  }

  async intercept(context, requestContext) {
    context.setHeader("X-Content-Type-Options", "nosniff");
    context.setHeader("X-Frame-Options", "DENY");
    context.setHeader("X-XSS-Protection", "1; mode=block");
    context.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");

    return context;
  }
}

/**
 * CacheControlInterceptor - Add cache control headers
 */
class CacheControlInterceptor extends ResponseInterceptor {
  constructor(options = {}) {
    super({ name: "CacheControl", priority: 70, ...options });
    this.defaultMaxAge = options.maxAge || 0;
  }

  async intercept(context, requestContext) {
    const status = context.getStatus();

    // Don't cache errors
    if (status >= 400) {
      context.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      context.setHeader("Pragma", "no-cache");
      context.setHeader("Expires", "0");
      return context;
    }

    // Cache successful responses based on configuration
    if (this.defaultMaxAge > 0) {
      context.setHeader("Cache-Control", `max-age=${this.defaultMaxAge}, public`);
    } else {
      context.setHeader("Cache-Control", "no-cache");
    }

    return context;
  }
}

/**
 * JsonResponseInterceptor - Ensure JSON response format
 */
class JsonResponseInterceptor extends ResponseInterceptor {
  constructor(options = {}) {
    super({ name: "JsonResponse", priority: 60, ...options });
  }

  async intercept(context, requestContext) {
    const body = context.getBody();

    // If body is object but not string, ensure JSON content-type
    if (body && typeof body === "object" && !Buffer.isBuffer(body)) {
      const contentType = context.getHeader("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        context.setHeader("Content-Type", "application/json; charset=utf-8");
      }
    }

    return context;
  }
}

/**
 * ErrorFormatInterceptor - Format error responses
 */
class ErrorFormatInterceptor extends ResponseInterceptor {
  constructor(options = {}) {
    super({ name: "ErrorFormat", priority: 100, ...options });
  }

  async intercept(context, requestContext) {
    const status = context.getStatus();

    // Format error responses (4xx, 5xx)
    if (status >= 400) {
      const body = context.getBody();

      // If body is not already formatted as error
      if (!body || !body.error) {
        const formatted = {
          error: true,
          status,
          message: this._getDefaultMessage(status),
          timestamp: new Date().toISOString(),
        };

        // Preserve original message if exists
        if (body && body.message) {
          formatted.message = body.message;
        }
        if (body && typeof body === "string") {
          formatted.message = body;
        }

        context.setBody(formatted);
        context.setHeader("Content-Type", "application/json; charset=utf-8");
      }
    }

    return context;
  }

  _getDefaultMessage(status) {
    const messages = {
      400: "Bad Request",
      401: "Unauthorized",
      403: "Forbidden",
      404: "Not Found",
      405: "Method Not Allowed",
      408: "Request Timeout",
      429: "Too Many Requests",
      500: "Internal Server Error",
      502: "Bad Gateway",
      503: "Service Unavailable",
      504: "Gateway Timeout",
    };
    return messages[status] || "Unknown Error";
  }
}

module.exports = ResponseInterceptor;
module.exports.ResponseLoggingInterceptor = ResponseLoggingInterceptor;
module.exports.ResponseTransformInterceptor = ResponseTransformInterceptor;
module.exports.CorsHeadersInterceptor = CorsHeadersInterceptor;
module.exports.SecurityHeadersInterceptor = SecurityHeadersInterceptor;
module.exports.CacheControlInterceptor = CacheControlInterceptor;
module.exports.JsonResponseInterceptor = JsonResponseInterceptor;
module.exports.ErrorFormatInterceptor = ErrorFormatInterceptor;
