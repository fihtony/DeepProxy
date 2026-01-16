/**
 * ForwardConfig - Configuration for HTTP forwarder
 *
 * Purpose:
 * - Centralize forwarder configuration
 * - Provide validation and defaults
 * - Support dynamic reconfiguration
 * - Enable per-request overrides
 *
 * Usage:
 * const config = new ForwardConfig({
 *   targetBaseUrl: 'https://api.example.com',
 *   timeout: 30000,
 *   retryCount: 3
 * });
 */

class ForwardConfig {
  /**
   * @param {Object} options - Configuration options
   */
  constructor(options = {}) {
    // Target server configuration
    this.targetBaseUrl = options.targetBaseUrl || null;
    this.targetHost = options.targetHost || null;
    this.targetPort = options.targetPort || null;

    // Timeout configuration
    this.timeout = options.timeout || 30000; // 30 seconds
    this.connectTimeout = options.connectTimeout || 5000; // 5 seconds

    // Retry configuration
    this.retryCount = options.retryCount || 3;
    this.retryDelay = options.retryDelay || 1000; // 1 second
    this.retryOnTimeout = options.retryOnTimeout !== false;

    // Connection configuration
    this.maxConnections = options.maxConnections || 100;
    this.maxRedirects = options.maxRedirects || 5;
    this.followRedirect = options.followRedirect !== false;

    // Security configuration
    this.insecureMode = options.insecureMode || false;
    this.trustSelfSignedCerts = options.trustSelfSignedCerts || false;

    // Header configuration
    this.preserveHostHeader = options.preserveHostHeader || false;
    this.customHeaders = options.customHeaders || {};

    // Proxy configuration
    this.proxyUrl = options.proxyUrl || null;
    this.proxyAuth = options.proxyAuth || null;

    this._validate();
  }

  /**
   * Get target base URL
   * @returns {string|null} Base URL
   */
  getTargetBaseUrl() {
    if (this.targetBaseUrl) {
      return this.targetBaseUrl;
    }
    if (this.targetHost) {
      const protocol = this.targetPort === 443 ? "https" : "http";
      const port = this.targetPort ? `:${this.targetPort}` : "";
      return `${protocol}://${this.targetHost}${port}`;
    }
    return null;
  }

  /**
   * Get timeout in milliseconds
   * @returns {number} Timeout
   */
  getTimeout() {
    return this.timeout;
  }

  /**
   * Get connect timeout in milliseconds
   * @returns {number} Connect timeout
   */
  getConnectTimeout() {
    return this.connectTimeout;
  }

  /**
   * Get retry count
   * @returns {number} Retry count
   */
  getRetryCount() {
    return this.retryCount;
  }

  /**
   * Get retry delay in milliseconds
   * @returns {number} Retry delay
   */
  getRetryDelay() {
    return this.retryDelay;
  }

  /**
   * Check if retry on timeout is enabled
   * @returns {boolean} True if enabled
   */
  shouldRetryOnTimeout() {
    return this.retryOnTimeout;
  }

  /**
   * Get max connections
   * @returns {number} Max connections
   */
  getMaxConnections() {
    return this.maxConnections;
  }

  /**
   * Get max redirects
   * @returns {number} Max redirects
   */
  getMaxRedirects() {
    return this.maxRedirects;
  }

  /**
   * Check if should follow redirects
   * @returns {boolean} True if should follow
   */
  shouldFollowRedirect() {
    return this.followRedirect;
  }

  /**
   * Check if insecure mode is enabled
   * @returns {boolean} True if enabled
   */
  isInsecureMode() {
    return this.insecureMode || this.trustSelfSignedCerts;
  }

  /**
   * Check if host header should be preserved
   * @returns {boolean} True if should preserve
   */
  shouldPreserveHostHeader() {
    return this.preserveHostHeader;
  }

  /**
   * Get custom headers
   * @returns {Object} Custom headers
   */
  getCustomHeaders() {
    return { ...this.customHeaders };
  }

  /**
   * Get proxy URL
   * @returns {string|null} Proxy URL
   */
  getProxyUrl() {
    return this.proxyUrl;
  }

  /**
   * Get proxy authentication
   * @returns {Object|null} Proxy auth
   */
  getProxyAuth() {
    return this.proxyAuth;
  }

  /**
   * Set target base URL
   * @param {string} url - Base URL
   */
  setTargetBaseUrl(url) {
    this.targetBaseUrl = url;
    this._validate();
  }

  /**
   * Set timeout
   * @param {number} timeout - Timeout in milliseconds
   */
  setTimeout(timeout) {
    this.timeout = timeout;
    this._validate();
  }

  /**
   * Set retry count
   * @param {number} count - Retry count
   */
  setRetryCount(count) {
    this.retryCount = count;
    this._validate();
  }

  /**
   * Set custom headers
   * @param {Object} headers - Custom headers
   */
  setCustomHeaders(headers) {
    this.customHeaders = { ...headers };
  }

  /**
   * Add custom header
   * @param {string} name - Header name
   * @param {string} value - Header value
   */
  addCustomHeader(name, value) {
    this.customHeaders[name] = value;
  }

  /**
   * Remove custom header
   * @param {string} name - Header name
   */
  removeCustomHeader(name) {
    delete this.customHeaders[name];
  }

  /**
   * Create copy of configuration
   * @returns {ForwardConfig} Cloned configuration
   */
  clone() {
    return new ForwardConfig(this.toJSON());
  }

  /**
   * Merge with another configuration
   * @param {Object} overrides - Override options
   * @returns {ForwardConfig} New merged configuration
   */
  merge(overrides) {
    return new ForwardConfig({
      ...this.toJSON(),
      ...overrides,
    });
  }

  /**
   * Export configuration to JSON
   * @returns {Object} JSON representation
   */
  toJSON() {
    return {
      targetBaseUrl: this.targetBaseUrl,
      targetHost: this.targetHost,
      targetPort: this.targetPort,
      timeout: this.timeout,
      connectTimeout: this.connectTimeout,
      retryCount: this.retryCount,
      retryDelay: this.retryDelay,
      retryOnTimeout: this.retryOnTimeout,
      maxConnections: this.maxConnections,
      maxRedirects: this.maxRedirects,
      followRedirect: this.followRedirect,
      insecureMode: this.insecureMode,
      trustSelfSignedCerts: this.trustSelfSignedCerts,
      preserveHostHeader: this.preserveHostHeader,
      customHeaders: this.customHeaders,
      proxyUrl: this.proxyUrl,
      proxyAuth: this.proxyAuth,
    };
  }

  /**
   * Create configuration from JSON
   * @param {Object} json - JSON object
   * @returns {ForwardConfig} Configuration instance
   */
  static fromJSON(json) {
    return new ForwardConfig(json);
  }

  /**
   * Validate configuration
   * @private
   */
  _validate() {
    if (this.timeout <= 0) {
      throw new Error("Timeout must be positive");
    }
    if (this.connectTimeout <= 0) {
      throw new Error("Connect timeout must be positive");
    }
    if (this.retryCount < 0) {
      throw new Error("Retry count must be non-negative");
    }
    if (this.retryDelay < 0) {
      throw new Error("Retry delay must be non-negative");
    }
    if (this.maxConnections <= 0) {
      throw new Error("Max connections must be positive");
    }
    if (this.maxRedirects < 0) {
      throw new Error("Max redirects must be non-negative");
    }
  }
}

module.exports = ForwardConfig;
