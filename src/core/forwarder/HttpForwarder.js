/**
 * HttpForwarder - Forwards HTTP requests to backend servers
 *
 * Purpose:
 * - Forward requests to target backend servers
 * - Handle request/response transformation
 * - Support timeout and retry logic
 * - Measure and track latency
 * - Handle connection pooling
 *
 * Features:
 * - Configurable timeout and retry
 * - Automatic error handling
 * - Request/response logging
 * - Connection reuse via axios
 * - Support for HTTP/HTTPS
 *
 * Usage:
 * const forwarder = new HttpForwarder(config);
 * const response = await forwarder.forward(requestContext);
 */

const axios = require("axios");
const https = require("https");
const http = require("http");
const logger = require("../../utils/logger");
const { isTransmitEndpoint } = require("../../utils/endpoint_utils");
const CurlForwarder = require("./CurlForwarder");

class HttpForwarder {
  /**
   * @param {ForwardConfig} config - Forwarder configuration
   */
  constructor(config) {
    this.config = config;

    // Create axios instance with connection pooling
    this.httpClient = axios.create({
      timeout: config.getTimeout(),
      maxRedirects: config.getMaxRedirects(),
      validateStatus: () => true, // Accept all status codes
      httpAgent: new http.Agent({
        keepAlive: true,
        keepAliveMsecs: 30000,
        maxSockets: config.getMaxConnections(),
        maxFreeSockets: 10,
      }),
      httpsAgent: new https.Agent({
        keepAlive: true,
        keepAliveMsecs: 30000,
        maxSockets: config.getMaxConnections(),
        maxFreeSockets: 10,
        rejectUnauthorized: !config.isInsecureMode(),
      }),
    });

    // Add request interceptor to fix Content-Length/Transfer-Encoding conflict for no-body requests
    this.httpClient.interceptors.request.use((config) => {
      const noBodyMethods = ["GET", "DELETE", "HEAD", "OPTIONS"];
      const isNoBodyMethod = noBodyMethods.includes(config.method?.toUpperCase());

      // Log all outgoing requests for debugging
      logger.info("[HttpForwarder] Axios interceptor - ACTUAL outgoing request", {
        method: config.method,
        url: config.url,
        headerKeys: config.headers ? Object.keys(config.headers) : [],
        hasContentLength: config.headers ? !!config.headers["content-length"] : false,
        contentLength: config.headers ? config.headers["content-length"] : null,
        dataType: config.data ? (Buffer.isBuffer(config.data) ? "Buffer" : typeof config.data) : "undefined",
        dataLength: config.data
          ? Buffer.isBuffer(config.data)
            ? config.data.length
            : typeof config.data === "string"
            ? config.data.length
            : 0
          : 0,
      });

      if (isNoBodyMethod && (!config.data || config.data === "" || config.data === undefined)) {
        // Remove Content-Length and Transfer-Encoding headers for no-body requests
        if (config.headers) {
          delete config.headers["content-length"];
          delete config.headers["Content-Length"];
          delete config.headers["transfer-encoding"];
          delete config.headers["Transfer-Encoding"];
        }
        // Ensure data is undefined
        config.data = undefined;
      }

      return config;
    });

    // Track metrics
    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      totalLatency: 0,
      avgLatency: 0,
    };

    // Create CurlForwarder for HTTPS requests (bypasses Akamai TLS fingerprinting)
    this.curlForwarder = new CurlForwarder(config);
  }

  /**
   * Forward request to backend server
   * @param {RequestContext} requestContext - Request context
   * @returns {Promise<ResponseContext>} Response context
   */
  async forward(requestContext) {
    const startTime = Date.now();
    const current = requestContext.getCurrent();

    // For transmit endpoints, use native HTTP to preserve exact request bytes
    // This is required because signatures are calculated over exact bytes
    // Use getActualPath() to handle proxy mode where current.path is "/"
    const actualPath = requestContext.getActualPath();

    if (isTransmitEndpoint(actualPath)) {
      return this._forwardWithNativeHttp(requestContext, startTime);
    }

    // Build target URL first to check if it's HTTPS
    const targetUrl = this._buildTargetUrl(current);
    const isHttps = targetUrl.startsWith("https://");

    // For HTTPS requests, use CurlForwarder to bypass Akamai TLS fingerprinting
    if (isHttps) {
      return this._forwardWithCurl(requestContext, startTime, targetUrl);
    }

    let attempt = 0;
    let lastError = null;

    // Retry logic for HTTP (non-HTTPS) endpoints (using axios)
    while (attempt <= this.config.getRetryCount()) {
      try {
        this.metrics.totalRequests++;

        // Log target URL for debugging
        logger.debug("[HttpForwarder] Forwarding HTTP request via axios", {
          method: current.method,
          targetUrl,
          originalUrl: current.originalUrl,
        });

        // Prepare headers
        const preparedHeaders = this._prepareHeaders(current.headers, targetUrl);

        // Prepare request options
        // For methods without body (GET, DELETE, HEAD, OPTIONS), explicitly set data to undefined
        // This prevents axios from adding Content-Length: 0 header
        const hasBody = current.body !== null && current.body !== undefined && current.body !== "";
        const noBodyMethods = ["GET", "DELETE", "HEAD", "OPTIONS"];
        const isNoBodyMethod = noBodyMethods.includes(current.method.toUpperCase());

        // For no-body methods, explicitly remove Content-Length and Transfer-Encoding headers
        if (isNoBodyMethod) {
          delete preparedHeaders["content-length"];
          delete preparedHeaders["Content-Length"];
          delete preparedHeaders["transfer-encoding"];
          delete preparedHeaders["Transfer-Encoding"];
          // Set Content-Length to 0 explicitly to prevent axios from adding Transfer-Encoding
          // But we'll remove it in transformRequest
        }

        const requestOptions = {
          method: current.method,
          url: targetUrl,
          headers: preparedHeaders,
          data: undefined, // Always undefined for no-body methods, or body for methods with body
          // IMPORTANT: Do NOT pass params here if targetUrl already contains query parameters
          // This prevents axios from duplicating query parameters
          // The targetUrl already includes all query parameters from _buildTargetUrl()
          params: {},
          // Ensure axios doesn't add Content-Length for empty bodies
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
          // For no-body methods, use transformRequest to completely remove Content-Length
          transformRequest: isNoBodyMethod
            ? [
                (data, headers) => {
                  // Completely remove Content-Length and Transfer-Encoding headers
                  delete headers["content-length"];
                  delete headers["Content-Length"];
                  delete headers["transfer-encoding"];
                  delete headers["Transfer-Encoding"];
                  // Return undefined (not empty string) to prevent axios from adding any body-related headers
                  return undefined;
                },
              ]
            : undefined,
          // Disable automatic header addition for no-body requests
          validateStatus: () => true, // Accept all status codes
        };

        // For methods with body, set data properly
        if (!isNoBodyMethod && hasBody) {
          requestOptions.data = current.body;
        }

        // Debug: Log actual request options sent to axios
        logger.info("[HttpForwarder] Axios request details", {
          method: requestOptions.method,
          url: requestOptions.url,
          headerKeys: Object.keys(requestOptions.headers),
          dataType: requestOptions.data ? (Buffer.isBuffer(requestOptions.data) ? "Buffer" : typeof requestOptions.data) : "undefined",
          dataLength: requestOptions.data
            ? Buffer.isBuffer(requestOptions.data)
              ? requestOptions.data.length
              : JSON.stringify(requestOptions.data).length
            : 0,
        });

        // Execute request
        const response = await this.httpClient.request(requestOptions);

        // Calculate latency
        const latency = Date.now() - startTime;
        this.metrics.successfulRequests++;
        this.metrics.totalLatency += latency;
        this.metrics.avgLatency = this.metrics.totalLatency / this.metrics.successfulRequests;

        // Create response context
        const ContextFactory = require("../context/ContextFactory");
        const responseContext = ContextFactory.createResponseContextFromHttp(response);
        responseContext.setLatency(latency);

        return responseContext;
      } catch (error) {
        lastError = error;
        attempt++;

        // Log the error for debugging
        const latency = Date.now() - startTime;
        logger.error("[HttpForwarder] Request failed", {
          attempt,
          error: error.message,
          code: error.code,
          latency,
          url: targetUrl,
        });

        if (attempt <= this.config.getRetryCount()) {
          // Wait before retry with exponential backoff
          const delay = this.config.getRetryDelay() * Math.pow(2, attempt - 1);
          await this._sleep(delay);
        }
      }
    }

    // All retries failed
    this.metrics.failedRequests++;

    // Create error response context with latency for stats recording
    const latency = Date.now() - startTime;
    const ContextFactory = require("../context/ContextFactory");
    const errorContext = ContextFactory.createErrorResponse(502, "Bad Gateway", { error: lastError.message || "Request failed" });
    errorContext.setLatency(latency);

    // Attach error context to the error so it can be used for stats recording
    const forwardError = this._createForwardError(lastError, requestContext);
    forwardError.responseContext = errorContext;
    throw forwardError;
  }

  /**
   * Forward request with custom options
   * @param {RequestContext} requestContext - Request context
   * @param {Object} options - Custom options
   * @returns {Promise<ResponseContext>} Response context
   */
  async forwardWithOptions(requestContext, options = {}) {
    const startTime = Date.now();
    const current = requestContext.getCurrent();

    try {
      this.metrics.totalRequests++;

      // Build target URL
      const targetUrl = options.url || this._buildTargetUrl(current);

      // Merge options with defaults
      const requestOptions = {
        method: current.method,
        url: targetUrl,
        headers: options.headers || this._prepareHeaders(current.headers, targetUrl),
        data: options.body !== undefined ? options.body : current.body,
        params: options.query || current.query,
        timeout: options.timeout || this.config.getTimeout(),
        ...options,
      };

      // Execute request
      const response = await this.httpClient.request(requestOptions);

      // Calculate latency
      const latency = Date.now() - startTime;
      this.metrics.successfulRequests++;
      this.metrics.totalLatency += latency;
      this.metrics.avgLatency = this.metrics.totalLatency / this.metrics.successfulRequests;

      // Create response context
      const ContextFactory = require("../context/ContextFactory");
      const responseContext = ContextFactory.createResponseContextFromHttp(response);
      responseContext.setLatency(latency);

      return responseContext;
    } catch (error) {
      this.metrics.failedRequests++;
      throw this._createForwardError(error, requestContext);
    }
  }

  /**
   * Forward HTTPS request using curl subprocess
   * This bypasses Akamai Bot Manager TLS fingerprint detection
   * while still allowing request/response content recording for REPLAY
   * @private
   * @param {RequestContext} requestContext - Request context
   * @param {number} startTime - Request start time
   * @param {string} targetUrl - Target URL
   * @returns {Promise<ResponseContext>} Response context
   */
  async _forwardWithCurl(requestContext, startTime, targetUrl) {
    const current = requestContext.getCurrent();

    let attempt = 0;
    let lastError = null;

    while (attempt <= this.config.getRetryCount()) {
      try {
        this.metrics.totalRequests++;

        logger.info("[HttpForwarder] Forwarding HTTPS request via curl", {
          method: current.method,
          targetUrl,
          attempt,
        });

        // Prepare headers
        const preparedHeaders = this._prepareHeaders(current.headers, targetUrl);

        // Forward using curl
        const response = await this.curlForwarder.forward({
          method: current.method,
          url: targetUrl,
          headers: preparedHeaders,
          body: current.body,
          timeout: this.config.getTimeout(),
        });

        // Calculate latency
        const latency = Date.now() - startTime;
        this.metrics.successfulRequests++;
        this.metrics.totalLatency += latency;
        this.metrics.avgLatency = this.metrics.totalLatency / this.metrics.successfulRequests;

        // Create response context
        const ContextFactory = require("../context/ContextFactory");
        const responseContext = ContextFactory.createResponseContextFromHttp({
          status: response.status,
          headers: response.headers,
          data: response.body,
        });
        responseContext.setLatency(latency);

        logger.info("[HttpForwarder] Curl forward successful", {
          method: current.method,
          targetUrl,
          status: response.status,
          latency,
        });

        return responseContext;
      } catch (error) {
        lastError = error;
        attempt++;

        logger.error("[HttpForwarder] Curl forward failed", {
          attempt,
          error: error.message,
          url: targetUrl,
        });

        if (attempt <= this.config.getRetryCount()) {
          const delay = this.config.getRetryDelay() * Math.pow(2, attempt - 1);
          await this._sleep(delay);
        }
      }
    }

    // All retries failed
    this.metrics.failedRequests++;

    const latency = Date.now() - startTime;
    const ContextFactory = require("../context/ContextFactory");
    const errorContext = ContextFactory.createErrorResponse(502, "Bad Gateway", { error: lastError.message || "Curl forward failed" });
    errorContext.setLatency(latency);

    const forwardError = this._createForwardError(lastError, requestContext);
    forwardError.responseContext = errorContext;
    throw forwardError;
  }

  /**
   * Forward transmit endpoint request using native HTTP to preserve exact bytes
   * Uses raw request body stored by captureRequestBody middleware for signature verification
   * Based on proven approach from mp_bak project
   * @private
   * @param {RequestContext} requestContext - Request context
   * @param {number} startTime - Request start time
   * @returns {Promise<ResponseContext>} Response context
   */
  async _forwardWithNativeHttp(requestContext, startTime) {
    const current = requestContext.getCurrent();
    const targetUrl = this._buildTargetUrl(current);
    const url = new URL(targetUrl);
    const rawBody = requestContext.getRawBody();

    // Debug logging
    const logger = require("../../utils/logger");
    logger.info("[TRANSMIT] Native HTTP forwarding ENTRY", {
      path: current.path,
      method: current.method,
      hasRequestContextRawBody: !!requestContext.rawBody,
      requestContextRawBodyLength: requestContext.rawBody ? requestContext.rawBody.length : 0,
      hasGetRawBodyResult: !!rawBody,
      getRawBodyLength: rawBody ? rawBody.length : 0,
      targetUrl: targetUrl,
    });

    if (!rawBody && current.path.includes("/transmit")) {
      logger.warn("[TRANSMIT] WARNING: No rawBody available for transmit endpoint!", {
        path: current.path,
        requestContextHasRawBody: !!requestContext.rawBody,
        getRawBodyReturned: !!rawBody,
      });
    }

    return new Promise((resolve, reject) => {
      try {
        const isHttps = url.protocol === "https:";
        const httpModule = isHttps ? https : http;

        // Prepare headers - keep all original headers except those managed by Node.js
        const headers = { ...current.headers };
        delete headers.host;
        headers.host = url.host;

        // Remove headers that Node.js will recalculate or manage
        delete headers["content-length"];
        delete headers["connection"];
        delete headers["keep-alive"];
        delete headers["transfer-encoding"];

        // Set correct content-length if raw body exists
        if (rawBody && rawBody.length > 0) {
          headers["content-length"] = rawBody.length;
        }

        const options = {
          method: current.method,
          headers: headers,
          timeout: this.config.getTimeout(),
        };

        const req = httpModule.request(url, options, (res) => {
          let responseBody = Buffer.alloc(0);

          res.on("data", (chunk) => {
            responseBody = Buffer.concat([responseBody, chunk]);
          });

          res.on("end", () => {
            const latency = Date.now() - startTime;
            this.metrics.successfulRequests++;
            this.metrics.totalLatency += latency;
            this.metrics.avgLatency = this.metrics.totalLatency / this.metrics.successfulRequests;

            try {
              // Parse response
              const ContextFactory = require("../context/ContextFactory");
              const responseContext = ContextFactory.createResponseContextFromHttp({
                status: res.statusCode,
                headers: res.headers,
                data: responseBody,
              });
              responseContext.setLatency(latency);
              resolve(responseContext);
            } catch (error) {
              reject(error);
            }
          });

          res.on("error", (error) => {
            const latency = Date.now() - startTime;
            this.metrics.failedRequests++;
            reject(error);
          });
        });

        req.on("error", (error) => {
          const latency = Date.now() - startTime;
          this.metrics.failedRequests++;

          const ContextFactory = require("../context/ContextFactory");
          const errorContext = ContextFactory.createErrorResponse(502, "Bad Gateway", { error: error.message });
          errorContext.setLatency(latency);

          const forwardError = new Error(`Forward failed: ${error.message}`);
          forwardError.responseContext = errorContext;
          reject(forwardError);
        });

        req.on("timeout", () => {
          req.destroy();
          const latency = Date.now() - startTime;
          this.metrics.failedRequests++;

          const ContextFactory = require("../context/ContextFactory");
          const errorContext = ContextFactory.createErrorResponse(504, "Gateway Timeout", { error: "Request timeout" });
          errorContext.setLatency(latency);

          const forwardError = new Error("Forward timeout");
          forwardError.responseContext = errorContext;
          reject(forwardError);
        });

        // Send raw body if exists
        // This preserves exact bytes for signature verification
        if (rawBody && rawBody.length > 0) {
          logger.info("[TRANSMIT] Writing rawBody to request", {
            path: current.path,
            rawBodyLength: rawBody.length,
            bytesWritten: true,
          });
          req.write(rawBody);
        } else {
          logger.warn("[TRANSMIT] NOT writing body - rawBody is null/empty", {
            path: current.path,
            hasRawBody: !!rawBody,
            rawBodyLength: rawBody ? rawBody.length : 0,
          });
        }

        req.end();
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Test connection to target server
   * @param {string} url - Target URL
   * @returns {Promise<boolean>} True if connection successful
   */
  async testConnection(url) {
    try {
      const response = await this.httpClient.get(url, {
        timeout: 5000,
        validateStatus: () => true,
      });
      return response.status !== 0;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get forwarder metrics
   * @returns {Object} Metrics object
   */
  getMetrics() {
    return {
      ...this.metrics,
      successRate:
        this.metrics.totalRequests > 0 ? ((this.metrics.successfulRequests / this.metrics.totalRequests) * 100).toFixed(2) + "%" : "0%",
    };
  }

  /**
   * Reset metrics
   */
  resetMetrics() {
    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      totalLatency: 0,
      avgLatency: 0,
    };
  }

  /**
   * Update configuration
   * @param {ForwardConfig} config - New configuration
   */
  updateConfig(config) {
    this.config = config;

    // Update axios client settings
    this.httpClient.defaults.timeout = config.getTimeout();
    this.httpClient.defaults.maxRedirects = config.getMaxRedirects();
  }

  /**
   * Destroy forwarder and close connections
   */
  destroy() {
    // Close all connections
    if (this.httpClient.defaults.httpAgent) {
      this.httpClient.defaults.httpAgent.destroy();
    }
    if (this.httpClient.defaults.httpsAgent) {
      this.httpClient.defaults.httpsAgent.destroy();
    }
  }

  /**
   * Build target URL from request
   * @private
   */
  _buildTargetUrl(current) {
    const baseUrl = this.config.getTargetBaseUrl();

    // Priority 1: Use originalUrl if it's a full URL (starts with http/https)
    if (current.originalUrl && (current.originalUrl.startsWith("http://") || current.originalUrl.startsWith("https://"))) {
      return current.originalUrl;
    }

    // Priority 2: Use current.url if it's a full URL
    if (current.url && (current.url.startsWith("http://") || current.url.startsWith("https://"))) {
      return current.url;
    }

    if (!baseUrl) {
      // Use original URL if no base URL configured
      return current.url || current.originalUrl || current.path;
    }

    // Priority 3: Use originalUrl (relative path) with baseUrl
    const pathToUse = current.originalUrl || current.url || current.path;

    // Combine base URL with path
    const url = new URL(pathToUse, baseUrl);

    // Add query parameters if they exist and weren't already in the URL
    if (current.query && Object.keys(current.query).length > 0) {
      Object.entries(current.query).forEach(([key, value]) => {
        // Only add if not already in URL
        if (!url.searchParams.has(key)) {
          url.searchParams.append(key, value);
        }
      });
    }

    return url.toString();
  }

  /**
   * Prepare headers for forwarding
   * @private
   * @param {Object} headers - Original headers
   * @param {string} targetUrl - Target URL to derive host from
   */
  _prepareHeaders(headers, targetUrl) {
    const prepared = { ...headers };

    // IMPORTANT: Remove the host header - axios will automatically derive it from the URL
    // The original host header is from the proxy (localhost:8080), not the backend
    // Axios will set the correct Host header based on the targetUrl
    delete prepared.host;

    // Remove hop-by-hop headers that shouldn't be forwarded
    const hopByHopHeaders = [
      "connection",
      "keep-alive",
      "proxy-authenticate",
      "proxy-authorization",
      "te",
      "trailer",
      "transfer-encoding",
      "upgrade",
    ];

    hopByHopHeaders.forEach((header) => {
      delete prepared[header];
    });

    // Remove content-length - axios will recalculate it based on the body
    // Exception: Keep content-length for Buffer bodies to ensure correct transmission
    // Axios should handle this automatically, but we'll let it recalculate to be safe
    delete prepared["content-length"];

    return prepared;
  }

  /**
   * Create standardized forward error
   * @private
   */
  _createForwardError(error, requestContext) {
    const current = requestContext.getCurrent();
    const forwardError = new Error(`Forward failed: ${error.message}`);
    forwardError.code = error.code || "FORWARD_ERROR";
    forwardError.originalError = error;
    forwardError.request = {
      method: current.method,
      url: current.url,
      path: current.path,
    };
    return forwardError;
  }

  /**
   * Sleep for specified milliseconds
   * @private
   */
  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = HttpForwarder;
