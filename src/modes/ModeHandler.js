/**
 * ModeHandler - Base class for proxy mode handlers
 *
 * Purpose:
 * - Define interface for mode handlers
 * - Provide common mode handling logic
 * - Support three modes: Passthrough, Recording, Replay
 * - Enable mode-specific request/response processing
 *
 * Usage:
 * class MyModeHandler extends ModeHandler {
 *   async handleRequest(requestContext) {
 *     // Custom logic
 *   }
 * }
 */

const trafficLogger = require("../utils/traffic_logger");

class ModeHandler {
  /**
   * @param {Object} dependencies - Dependencies (forwarder, repositories, etc.)
   */
  constructor(dependencies = {}) {
    this.forwarder = dependencies.forwarder;
    this.interceptorChain = dependencies.interceptorChain;
    this.repositories = dependencies.repositories;
    this.config = dependencies.config || {};
  }

  /**
   * Handle incoming request
   * @param {RequestContext} requestContext - Request context
   * @returns {Promise<ResponseContext>} Response context
   */
  async handleRequest(requestContext) {
    throw new Error(`${this.constructor.name}.handleRequest() must be implemented`);
  }

  /**
   * Get mode name
   * @returns {string} Mode name
   */
  getModeName() {
    return this.constructor.name.replace("Mode", "").toLowerCase();
  }

  /**
   * Check if mode is enabled
   * @returns {boolean} True if enabled
   */
  isEnabled() {
    return true;
  }

  /**
   * Initialize mode handler
   * @returns {Promise<void>}
   */
  async initialize() {
    // Override in subclass for initialization logic
  }

  /**
   * Shutdown mode handler
   * @returns {Promise<void>}
   */
  async shutdown() {
    // Override in subclass for cleanup logic
  }

  /**
   * Common logging helper - Initialize request logging with ID
   * @param {RequestContext} requestContext - Request context
   * @param {string} clientIP - Client IP address
   * @param {string} mode - Current proxy mode
   * @returns {number} Request ID for grouping logs
   */
  initializeRequestLogging(requestContext, clientIP, mode) {
    // Generate request ID for grouping all logs for this request
    const requestId = trafficLogger.generateRequestId();

    // Store request ID in request context metadata for later use
    requestContext.metadata = requestContext.metadata || {};
    requestContext.metadata.requestId = requestId;

    const current = requestContext.getCurrent();
    const original = requestContext.getOriginal();

    // Log incoming request
    trafficLogger.logIncomingRequest(
      {
        method: current.method,
        path: current.path,
        url: original.originalUrl || current.url,
        originalUrl: original.originalUrl || current.url,
        headers: current.headers,
        body: current.body,
      },
      clientIP,
      mode,
      requestId
    );

    return requestId;
  }

  /**
   * Common logging helper - Log forwarded request to backend
   * @param {RequestContext} requestContext - Request context
   * @param {string} targetUrl - Target backend URL
   * @param {string} mode - Current proxy mode
   * @param {Object} forwardedHeaders - Headers to forward (optional)
   * @param {number} requestId - Request ID for grouping logs
   */
  logForwardedRequest(requestContext, targetUrl, mode, forwardedHeaders = null, requestId = null) {
    const current = requestContext.getCurrent();
    const processedRequest = requestContext;

    trafficLogger.logForwardedRequest(
      {
        method: current.method,
        path: current.path,
        url: targetUrl,
        originalUrl: targetUrl,
        headers: forwardedHeaders || current.headers,
        rawBody: requestContext.getRawBody(), // Pass rawBody from RequestContext
      },
      targetUrl,
      mode,
      forwardedHeaders,
      requestId
    );
  }

  /**
   * Common logging helper - Log backend response
   * @param {RequestContext} requestContext - Request context
   * @param {ResponseContext} responseContext - Response context
   * @param {string} targetUrl - Target backend URL (or original URL for replay mode)
   * @param {string} mode - Current proxy mode
   * @param {number} duration - Response time in milliseconds
   * @param {number} requestId - Request ID for grouping logs
   */
  logBackendResponse(requestContext, responseContext, targetUrl, mode, duration, requestId = null) {
    const current = requestContext.getCurrent();

    trafficLogger.logBackendResponse(
      {
        method: current.method,
        path: current.path,
        url: targetUrl,
        originalUrl: targetUrl,
        headers: current.headers,
      },
      responseContext.getStatus(),
      responseContext.headers,
      responseContext.getBody(),
      duration,
      targetUrl,
      mode,
      requestId
    );

    // Store request ID in response metadata for client response logging
    responseContext.setMetadata("requestId", requestId);
  }

  /**
   * Common helper - Store request ID in response context
   * @param {ResponseContext} responseContext - Response context
   * @param {number} requestId - Request ID
   */
  storeRequestIdInResponse(responseContext, requestId) {
    responseContext.setMetadata("requestId", requestId);
  }
}

module.exports = ModeHandler;
