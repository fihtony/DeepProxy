/**
 * CurlForwarder - Uses curl subprocess to forward HTTPS requests
 *
 * Purpose:
 * - Bypass Akamai Bot Manager TLS fingerprint detection
 * - Forward HTTPS requests using curl (which has acceptable TLS fingerprint)
 * - Still allow request/response content recording for REPLAY feature
 *
 * Why curl?
 * - Node.js axios/https module TLS fingerprint is detected as bot by Akamai
 * - curl's TLS fingerprint is accepted by Akamai Bot Manager
 * - We can still capture request and response content for recording
 */

const { spawn } = require("child_process");
const logger = require("../../utils/logger");

class CurlForwarder {
  constructor(config) {
    this.config = config;
    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      totalLatency: 0,
      avgLatency: 0,
    };
  }

  /**
   * Forward request using curl subprocess
   * @param {Object} options - Request options
   * @param {string} options.method - HTTP method
   * @param {string} options.url - Target URL
   * @param {Object} options.headers - Request headers
   * @param {Buffer|string} options.body - Request body
   * @param {number} options.timeout - Timeout in milliseconds
   * @returns {Promise<Object>} Response object with status, headers, and body
   */
  async forward(options) {
    const startTime = Date.now();
    const { method, url, headers, body, timeout = 30000 } = options;

    this.metrics.totalRequests++;

    return new Promise((resolve, reject) => {
      // Build curl command arguments
      const args = this._buildCurlArgs(method, url, headers, body, timeout);

      logger.debug("[CurlForwarder] Executing curl", {
        method,
        url,
        headerCount: Object.keys(headers || {}).length,
        bodyLength: body ? (Buffer.isBuffer(body) ? body.length : body.length) : 0,
      });

      // Spawn curl process
      const curlProcess = spawn("curl", args, {
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = Buffer.alloc(0);
      let stderr = "";
      let killed = false;

      // Set timeout
      const timeoutId = setTimeout(() => {
        killed = true;
        curlProcess.kill("SIGTERM");
      }, timeout);

      // Collect stdout (response data)
      curlProcess.stdout.on("data", (chunk) => {
        stdout = Buffer.concat([stdout, chunk]);
      });

      // Collect stderr (curl error messages)
      curlProcess.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      // Write body to stdin if present
      if (body) {
        const bodyBuffer = Buffer.isBuffer(body) ? body : Buffer.from(body);
        curlProcess.stdin.write(bodyBuffer);
      }
      curlProcess.stdin.end();

      // Handle process completion
      curlProcess.on("close", (code) => {
        clearTimeout(timeoutId);
        const latency = Date.now() - startTime;

        if (killed) {
          this.metrics.failedRequests++;
          reject(new Error(`Curl timeout after ${timeout}ms`));
          return;
        }

        if (code !== 0) {
          this.metrics.failedRequests++;
          logger.error("[CurlForwarder] Curl failed", {
            code,
            stderr,
            url,
          });
          reject(new Error(`Curl failed with code ${code}: ${stderr}`));
          return;
        }

        try {
          // Parse curl output (with -i flag, includes headers)
          const response = this._parseCurlOutput(stdout);

          this.metrics.successfulRequests++;
          this.metrics.totalLatency += latency;
          this.metrics.avgLatency = this.metrics.totalLatency / this.metrics.successfulRequests;

          response.latency = latency;

          logger.debug("[CurlForwarder] Request successful", {
            url,
            status: response.status,
            latency,
            bodyLength: response.body ? response.body.length : 0,
          });

          resolve(response);
        } catch (parseError) {
          this.metrics.failedRequests++;
          reject(parseError);
        }
      });

      curlProcess.on("error", (error) => {
        clearTimeout(timeoutId);
        this.metrics.failedRequests++;
        reject(error);
      });
    });
  }

  /**
   * Build curl command arguments
   * @private
   */
  _buildCurlArgs(method, url, headers, body, timeout) {
    const args = [
      "-i", // Include response headers in output
      "-s", // Silent mode (no progress bar)
      "-S", // Show errors
      "-X",
      method, // HTTP method
      "--max-time",
      String(Math.ceil(timeout / 1000)), // Timeout in seconds
      "-k", // Allow insecure SSL (since we're MITM proxy)
    ];

    // Add headers
    if (headers) {
      // Skip certain headers that curl manages
      const skipHeaders = [
        "host", // curl will set this based on URL
        "connection",
        "content-length", // curl calculates this
        "transfer-encoding",
      ];

      Object.entries(headers).forEach(([key, value]) => {
        if (!skipHeaders.includes(key.toLowerCase())) {
          args.push("-H", `${key}: ${value}`);
        }
      });
    }

    // Add body via stdin
    if (body) {
      args.push("-d", "@-"); // Read body from stdin
    }

    // Add URL
    args.push(url);

    return args;
  }

  /**
   * Parse curl output (with -i flag) into response object
   * @private
   */
  _parseCurlOutput(output) {
    // curl -i output format:
    // HTTP/1.1 200 OK\r\n
    // Header1: value1\r\n
    // Header2: value2\r\n
    // \r\n
    // body...

    // Find the end of headers (double CRLF)
    let headerEndIndex = -1;

    // Try \r\n\r\n first
    headerEndIndex = output.indexOf("\r\n\r\n");
    let separatorLength = 4;

    // Fallback to \n\n if not found
    if (headerEndIndex === -1) {
      headerEndIndex = output.indexOf("\n\n");
      separatorLength = 2;
    }

    if (headerEndIndex === -1) {
      // No body, all headers
      headerEndIndex = output.length;
      separatorLength = 0;
    }

    const headerSection = output.slice(0, headerEndIndex).toString("utf8");
    const body = headerEndIndex + separatorLength < output.length ? output.slice(headerEndIndex + separatorLength) : Buffer.alloc(0);

    // Parse status line and headers
    const lines = headerSection.split(/\r?\n/);

    // Handle possible 100 Continue responses
    let statusLineIndex = 0;
    while (statusLineIndex < lines.length && lines[statusLineIndex].startsWith("HTTP/") && lines[statusLineIndex].includes("100")) {
      // Skip 100 Continue and its empty line
      statusLineIndex++;
      while (statusLineIndex < lines.length && lines[statusLineIndex].trim() === "") {
        statusLineIndex++;
      }
    }

    const statusLine = lines[statusLineIndex] || "";
    const statusMatch = statusLine.match(/^HTTP\/[\d.]+ (\d+)/);
    const status = statusMatch ? parseInt(statusMatch[1], 10) : 0;

    // Parse headers
    const headers = {};
    for (let i = statusLineIndex + 1; i < lines.length; i++) {
      const line = lines[i];
      const colonIndex = line.indexOf(":");
      if (colonIndex > 0) {
        const key = line.slice(0, colonIndex).trim().toLowerCase();
        const value = line.slice(colonIndex + 1).trim();
        headers[key] = value;
      }
    }

    return {
      status,
      statusText: statusLine.replace(/^HTTP\/[\d.]+ \d+ /, "").trim(),
      headers,
      body,
      data: body, // Alias for compatibility
    };
  }

  /**
   * Get metrics
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
}

module.exports = CurlForwarder;
