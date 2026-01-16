/**
 * InterceptorChain - Manages and executes interceptor pipeline
 *
 * Purpose:
 * - Orchestrate multiple interceptors in sequence
 * - Support priority-based ordering
 * - Enable conditional execution
 * - Provide error handling and recovery
 *
 * Features:
 * - Dynamic interceptor registration/removal
 * - Priority sorting (higher priority first)
 * - Async execution with error handling
 * - Interceptor enable/disable without removal
 *
 * Usage:
 * const chain = new InterceptorChain();
 * chain.addRequestInterceptor(new LoggingInterceptor());
 * chain.addResponseInterceptor(new CorsInterceptor());
 * await chain.executeRequest(requestContext);
 * await chain.executeResponse(responseContext, requestContext);
 */

class InterceptorChain {
  constructor() {
    this.requestInterceptors = [];
    this.responseInterceptors = [];
  }

  /**
   * Add request interceptor
   * @param {RequestInterceptor} interceptor - Request interceptor instance
   * @returns {InterceptorChain} Chain instance for fluent API
   */
  addRequestInterceptor(interceptor) {
    this.requestInterceptors.push(interceptor);
    this._sortRequestInterceptors();
    return this;
  }

  /**
   * Add response interceptor
   * @param {ResponseInterceptor} interceptor - Response interceptor instance
   * @returns {InterceptorChain} Chain instance for fluent API
   */
  addResponseInterceptor(interceptor) {
    this.responseInterceptors.push(interceptor);
    this._sortResponseInterceptors();
    return this;
  }

  /**
   * Add multiple request interceptors
   * @param {Array<RequestInterceptor>} interceptors - Array of interceptors
   * @returns {InterceptorChain} Chain instance for fluent API
   */
  addRequestInterceptors(interceptors) {
    interceptors.forEach((interceptor) => {
      this.requestInterceptors.push(interceptor);
    });
    this._sortRequestInterceptors();
    return this;
  }

  /**
   * Add multiple response interceptors
   * @param {Array<ResponseInterceptor>} interceptors - Array of interceptors
   * @returns {InterceptorChain} Chain instance for fluent API
   */
  addResponseInterceptors(interceptors) {
    interceptors.forEach((interceptor) => {
      this.responseInterceptors.push(interceptor);
    });
    this._sortResponseInterceptors();
    return this;
  }

  /**
   * Remove request interceptor by name
   * @param {string} name - Interceptor name
   * @returns {boolean} True if removed
   */
  removeRequestInterceptor(name) {
    const index = this.requestInterceptors.findIndex((i) => i.getName() === name);
    if (index !== -1) {
      this.requestInterceptors.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Remove response interceptor by name
   * @param {string} name - Interceptor name
   * @returns {boolean} True if removed
   */
  removeResponseInterceptor(name) {
    const index = this.responseInterceptors.findIndex((i) => i.getName() === name);
    if (index !== -1) {
      this.responseInterceptors.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Get request interceptor by name
   * @param {string} name - Interceptor name
   * @returns {RequestInterceptor|null} Interceptor instance or null
   */
  getRequestInterceptor(name) {
    return this.requestInterceptors.find((i) => i.getName() === name) || null;
  }

  /**
   * Get response interceptor by name
   * @param {string} name - Interceptor name
   * @returns {ResponseInterceptor|null} Interceptor instance or null
   */
  getResponseInterceptor(name) {
    return this.responseInterceptors.find((i) => i.getName() === name) || null;
  }

  /**
   * Execute request interceptor chain
   * @param {RequestContext} context - Request context
   * @returns {Promise<RequestContext>} Modified context
   */
  async executeRequest(context) {
    let currentContext = context;

    for (const interceptor of this.requestInterceptors) {
      if (interceptor.isEnabled()) {
        try {
          currentContext = await interceptor.execute(currentContext);
        } catch (error) {
          console.error(`[InterceptorChain] Request interceptor ${interceptor.getName()} failed:`, error);
          // Continue with next interceptor unless error is critical
          if (error.critical) {
            throw error;
          }
        }
      }
    }

    return currentContext;
  }

  /**
   * Execute response interceptor chain
   * @param {ResponseContext} context - Response context
   * @param {RequestContext} requestContext - Associated request context
   * @returns {Promise<ResponseContext>} Modified context
   */
  async executeResponse(context, requestContext = null) {
    let currentContext = context;

    for (const interceptor of this.responseInterceptors) {
      if (interceptor.isEnabled()) {
        try {
          currentContext = await interceptor.execute(currentContext, requestContext);
        } catch (error) {
          console.error(`[InterceptorChain] Response interceptor ${interceptor.getName()} failed:`, error);
          // Continue with next interceptor unless error is critical
          if (error.critical) {
            throw error;
          }
        }
      }
    }

    return currentContext;
  }

  /**
   * Clear all request interceptors
   */
  clearRequestInterceptors() {
    this.requestInterceptors = [];
  }

  /**
   * Clear all response interceptors
   */
  clearResponseInterceptors() {
    this.responseInterceptors = [];
  }

  /**
   * Get all request interceptors
   * @returns {Array<RequestInterceptor>} Array of interceptors
   */
  getRequestInterceptors() {
    return [...this.requestInterceptors];
  }

  /**
   * Get all response interceptors
   * @returns {Array<ResponseInterceptor>} Array of interceptors
   */
  getResponseInterceptors() {
    return [...this.responseInterceptors];
  }

  /**
   * Get interceptor counts
   * @returns {Object} Count statistics
   */
  getStats() {
    return {
      requestInterceptors: {
        total: this.requestInterceptors.length,
        enabled: this.requestInterceptors.filter((i) => i.isEnabled()).length,
        disabled: this.requestInterceptors.filter((i) => !i.isEnabled()).length,
      },
      responseInterceptors: {
        total: this.responseInterceptors.length,
        enabled: this.responseInterceptors.filter((i) => i.isEnabled()).length,
        disabled: this.responseInterceptors.filter((i) => !i.isEnabled()).length,
      },
    };
  }

  /**
   * Sort request interceptors by priority (higher first)
   * @private
   */
  _sortRequestInterceptors() {
    this.requestInterceptors.sort((a, b) => b.getPriority() - a.getPriority());
  }

  /**
   * Sort response interceptors by priority (higher first)
   * @private
   */
  _sortResponseInterceptors() {
    this.responseInterceptors.sort((a, b) => b.getPriority() - a.getPriority());
  }
}

module.exports = InterceptorChain;
