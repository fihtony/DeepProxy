/**
 * RequestInterceptor - Base class for request interception and modification
 *
 * Purpose:
 * - Define standard interface for request interceptors
 * - Support async request processing
 * - Enable request validation, transformation, and logging
 * - Provide hooks for before/after operations
 *
 * Lifecycle:
 * 1. beforeIntercept() - Setup/validation
 * 2. intercept() - Main processing logic
 * 3. afterIntercept() - Cleanup/logging
 *
 * Usage:
 * class MyInterceptor extends RequestInterceptor {
 *   async intercept(context) {
 *     context.setHeader('X-Custom', 'value');
 *     return context;
 *   }
 * }
 */

const { log } = require("winston");

class RequestInterceptor {
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
   * @param {RequestContext} context - Request context
   * @returns {Promise<RequestContext>} Modified context
   */
  async execute(context) {
    if (!this.enabled) {
      return context;
    }

    try {
      await this.beforeIntercept(context);
      const result = await this.intercept(context);
      await this.afterIntercept(result);
      return result;
    } catch (error) {
      await this.onError(error, context);
      throw error;
    }
  }

  /**
   * Pre-interception hook (override in subclass)
   * @param {RequestContext} context - Request context
   * @returns {Promise<void>}
   */
  async beforeIntercept(context) {
    // Override in subclass for setup logic
  }

  /**
   * Main interception logic (must override in subclass)
   * @param {RequestContext} context - Request context
   * @returns {Promise<RequestContext>} Modified context
   */
  async intercept(context) {
    throw new Error(`${this.name}.intercept() must be implemented`);
  }

  /**
   * Post-interception hook (override in subclass)
   * @param {RequestContext} context - Modified context
   * @returns {Promise<void>}
   */
  async afterIntercept(context) {
    // Override in subclass for cleanup/logging
  }

  /**
   * Error handler (override in subclass)
   * @param {Error} error - Error object
   * @param {RequestContext} context - Request context
   * @returns {Promise<void>}
   */
  async onError(error, context) {
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
 * UserIdExtractionInterceptor - Extract user ID from request
 */
class UserIdExtractionInterceptor extends RequestInterceptor {
  constructor(options = {}) {
    super({ name: "UserIdExtraction", priority: 100, ...options });
  }

  async intercept(context) {
    // Try to extract user ID from various sources
    let userId = null;

    // 1. From header
    userId = context.getCurrent().headers["x-user-id"];

    // 2. From session
    if (!userId && context.getMetadata("sessionId")) {
      // Will be populated by session manager
      userId = context.getMetadata("userId");
    }

    // 3. From JWT token
    if (!userId) {
      const authHeader = context.getCurrent().headers["authorization"];
      if (authHeader && authHeader.startsWith("Bearer ")) {
        // JWT parsing would go here
        // For now, just set metadata flag
        context.setMetadata("hasJwt", true);
      }
    }

    if (userId) {
      context.setMetadata("userId", userId);
    }

    return context;
  }
}

/**
 * MobileHeaderExtractionInterceptor - Extract mobile app headers
 * Uses configurable field mapping from TrafficConfigManager
 * Falls back to standard headers if config unavailable
 *
 * Extracts headers for replay mode matching:
 * - app_version (configurable source: header or query param)
 * - app_environment (configurable source: header or query param)
 * - app_platform (configurable source: header or query param)
 * - app_language (configurable source: header or query param)
 */
class MobileHeaderExtractionInterceptor extends RequestInterceptor {
  constructor(options = {}) {
    super({ name: "MobileHeaderExtraction", priority: 95, ...options });
  }

  async intercept(context) {
    const current = context.getCurrent();
    const headers = current.headers || {};
    const original = context.getOriginal();

    // Extract query parameters from URL
    let queryParams = {};
    try {
      const url = original?.originalUrl || original?.url || "";
      if (url.includes("?")) {
        const queryString = url.split("?")[1];
        const params = new URLSearchParams(queryString);
        params.forEach((value, key) => {
          queryParams[key] = value;
        });
      }
    } catch (e) {
      // Ignore query param parsing errors
    }

    // Try to use TrafficConfigManager for configurable mapping
    let configManager = null;
    try {
      const { getInstance } = require("../../config/TrafficConfigManager");
      configManager = getInstance();
    } catch (e) {
      // Config manager not available
    }

    // Extract using configured mappings
    if (configManager && configManager.isInitialized()) {
      const mappedValues = configManager.extractAllMappedValues(headers, queryParams);

      if (mappedValues.app_version) {
        context.setMetadata("appVersion", mappedValues.app_version);
      }
      if (mappedValues.app_environment) {
        context.setMetadata("appEnvironment", mappedValues.app_environment);
      }
      if (mappedValues.app_platform) {
        context.setMetadata("appPlatform", mappedValues.app_platform);
      }
      if (mappedValues.app_language) {
        context.setMetadata("appLanguage", mappedValues.app_language);
      }
    } else {
      logger.error("[MobileHeaderExtraction] TrafficConfigManager not initialized!!!");
    }

    return context;
  }
}

/**
 * RequestLoggingInterceptor - Log request details
 */
class RequestLoggingInterceptor extends RequestInterceptor {
  constructor(options = {}) {
    super({ name: "RequestLogging", priority: 10, ...options });
    this.logger = options.logger || console;
  }

  async intercept(context) {
    const current = context.getCurrent();
    const userId = context.getMetadata("userId");
    const timestamp = new Date().toISOString();

    // INFO level: concise summary only (method, path, user ID)
    this.logger.info(`[REQUEST] ${current.method} ${current.path}${userId ? ` (user: ${userId})` : ""}`);

    // DEBUG level: detailed information (headers, body, full metadata)
    if (this.logger.debug) {
      this.logger.debug(`[REQUEST_DETAIL] ${current.method} ${current.path}`, {
        userId: userId,
        path: current.path,
        headers: current.headers,
        timestamp: timestamp,
      });
    }

    return context;
  }
}

/**
 * RequestValidationInterceptor - Validate request format
 */
class RequestValidationInterceptor extends RequestInterceptor {
  constructor(options = {}) {
    super({ name: "RequestValidation", priority: 90, ...options });
    this.rules = options.rules || {};
  }

  async intercept(context) {
    const current = context.getCurrent();

    // Validate required headers
    if (this.rules.requiredHeaders) {
      for (const header of this.rules.requiredHeaders) {
        if (!current.headers[header.toLowerCase()]) {
          throw new Error(`Missing required header: ${header}`);
        }
      }
    }

    // Validate content-type for POST/PUT
    if (["POST", "PUT", "PATCH"].includes(current.method)) {
      const contentType = current.headers["content-type"];
      if (!contentType) {
        throw new Error("Missing Content-Type header for request with body");
      }
    }

    // Validate body size
    if (this.rules.maxBodySize && current.body) {
      const bodySize = JSON.stringify(current.body).length;
      if (bodySize > this.rules.maxBodySize) {
        throw new Error(`Request body exceeds maximum size: ${this.rules.maxBodySize}`);
      }
    }

    return context;
  }
}

/**
 * HeaderNormalizationInterceptor - Normalize headers
 */
class HeaderNormalizationInterceptor extends RequestInterceptor {
  constructor(options = {}) {
    super({ name: "HeaderNormalization", priority: 80, ...options });
  }

  async intercept(context) {
    const current = context.getCurrent();

    // Remove proxy-specific headers
    const proxyHeaders = ["proxy-connection", "proxy-authorization", "proxy-authenticate"];

    proxyHeaders.forEach((header) => {
      if (current.headers[header]) {
        context.removeHeader(header);
      }
    });

    // Remove host header - it will be set correctly by HttpForwarder based on target URL
    // The original host header is from the proxy (localhost:8080), not the backend
    // HttpForwarder will let axios derive the correct Host header from the target URL
    context.removeHeader("host");

    return context;
  }
}

/**
 * RequestTransformInterceptor - Transform request data
 */
class RequestTransformInterceptor extends RequestInterceptor {
  constructor(options = {}) {
    super({ name: "RequestTransform", priority: 50, ...options });
    this.transformer = options.transformer || ((ctx) => ctx);
  }

  async intercept(context) {
    return await this.transformer(context);
  }
}

module.exports = {
  RequestInterceptor,
  UserIdExtractionInterceptor,
  MobileHeaderExtractionInterceptor,
  RequestLoggingInterceptor,
  RequestValidationInterceptor,
  HeaderNormalizationInterceptor,
  RequestTransformInterceptor,
};
