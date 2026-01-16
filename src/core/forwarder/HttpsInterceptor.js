/**
 * HttpsInterceptor - HTTPS Traffic Interception Handler
 *
 * Purpose:
 * - Intercept HTTPS connections using MITM (Man-in-the-Middle)
 * - Decrypt HTTPS traffic for inspection/recording
 * - Re-encrypt and forward to target server
 * - Support all proxy modes (passthrough, recording, replay)
 *
 * How it works:
 * 1. Client sends CONNECT request to proxy
 * 2. Proxy creates TLS server with dynamic certificate for target host
 * 3. Client establishes TLS connection with proxy (using dynamic cert)
 * 4. Proxy parses HTTP requests from decrypted stream
 * 5. Proxy forwards requests to actual target server over HTTPS
 * 6. Response is sent back to client over the established TLS connection
 *
 * Usage:
 * const interceptor = new HttpsInterceptor(modeService, interceptorChain);
 * await interceptor.handleConnect(req, socket, head, targetHost);
 */

const tls = require("tls");
const http = require("http");
const https = require("https");
const net = require("net");
const { URL } = require("url");

const CertManager = require("./CertManager");
const ContextFactory = require("../context/ContextFactory");
const logger = require("../../utils/logger");
const trafficLogger = require("../../utils/traffic_logger");
const { isSecureDomain } = require("../../utils/cookieDomainHelper");
const { shouldBypassDProxy } = require("../../utils/requestTypeDetector");

class HttpsInterceptor {
  /**
   * @param {Object} options - Interceptor options
   * @param {Object} options.modeService - Mode service instance
   * @param {Object} options.interceptorChain - Interceptor chain instance
   * @param {Object} options.forwarder - HTTP forwarder instance
   */
  constructor(options = {}) {
    this.modeService = options.modeService;
    this.interceptorChain = options.interceptorChain;
    this.forwarder = options.forwarder;
    this.certManager = CertManager.getInstance();
  }

  /**
   * Handle CONNECT request with HTTPS interception
   * @param {Object} req - HTTP request object
   * @param {net.Socket} socket - Client socket
   * @param {Buffer} head - Initial data buffer
   * @param {string} targetHost - Target host:port from CONNECT request
   */
  async handleConnect(req, socket, head, targetHost) {
    const startTime = Date.now();

    try {
      // Parse target host and port
      const [host, portStr] = targetHost.split(":");
      const port = parseInt(portStr || "443", 10);

      logger.info("[HttpsInterceptor] Intercepting HTTPS connection", {
        targetHost,
        host,
        port,
      });

      // Get certificate for this host
      const { key, cert } = await this.certManager.getCertificateForHost(host);

      // Create secure context with our certificate
      const secureContext = tls.createSecureContext({
        key: key,
        cert: cert,
      });

      // Send CONNECT response before upgrading to TLS
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");

      // Upgrade socket to TLS using secure context
      const tlsSocket = new tls.TLSSocket(socket, {
        isServer: true,
        secureContext: secureContext,
        // SNI callback for additional certificate handling if needed
        SNICallback: (servername, cb) => {
          // For now, use the same context for all SNI requests
          cb(null, secureContext);
        },
      });

      // Handle TLS errors
      tlsSocket.on("error", (error) => {
        const targetHost = req.url; // CONNECT requests have target host:port in req.url
        const [host, portStr] = targetHost.split(":");
        if (isSecureDomain(host)) {
          logger.warn("[HttpsInterceptor] TLS socket error on configured domain", {
            error: error.message,
            targetHost,
          });
        } else {
          logger.warn("[HttpsInterceptor] TLS socket error", {
            error: error.message,
            targetHost,
          });
        }
        this._closeSocket(tlsSocket);
      });

      // If we have head data, feed it into the TLS socket
      if (head && head.length > 0) {
        tlsSocket.unshift(head);
      }

      // Create HTTP parser for the decrypted stream
      this._handleDecryptedConnection(tlsSocket, host, port, startTime);
    } catch (error) {
      logger.error("[HttpsInterceptor] Failed to intercept HTTPS", {
        error: error.message,
        targetHost,
        stack: error.stack,
      });

      socket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
      socket.destroy();
    }
  }

  /**
   * Handle decrypted TLS connection
   * Parse HTTP requests and process them through the proxy
   * @param {tls.TLSSocket} tlsSocket - Decrypted TLS socket
   * @param {string} host - Target host
   * @param {number} port - Target port
   * @param {number} startTime - Request start time
   */
  _handleDecryptedConnection(tlsSocket, host, port, startTime) {
    // Buffer for accumulating data
    let buffer = Buffer.alloc(0);
    let currentRequest = null;
    let bodyRemaining = 0;

    const processBuffer = async () => {
      while (buffer.length > 0) {
        if (!currentRequest) {
          // Try to parse HTTP request headers
          const headerEndIndex = buffer.indexOf("\r\n\r\n");
          if (headerEndIndex === -1) {
            // Need more data for headers
            break;
          }

          // Parse headers
          const headerData = buffer.slice(0, headerEndIndex).toString();
          const lines = headerData.split("\r\n");
          const requestLine = lines[0];
          const [method, path, httpVersion] = requestLine.split(" ");

          // Parse headers
          const headers = {};
          for (let i = 1; i < lines.length; i++) {
            const colonIndex = lines[i].indexOf(":");
            if (colonIndex > 0) {
              const key = lines[i].slice(0, colonIndex).trim().toLowerCase();
              const value = lines[i].slice(colonIndex + 1).trim();
              headers[key] = value;
            }
          }

          // Set host header if not present
          if (!headers.host) {
            headers.host = port === 443 ? host : `${host}:${port}`;
          }

          currentRequest = {
            method,
            path,
            httpVersion,
            headers,
            body: Buffer.alloc(0),
            fullUrl: `https://${headers.host}${path}`,
          };

          // Determine body length
          if (headers["content-length"]) {
            bodyRemaining = parseInt(headers["content-length"], 10);
          } else if (headers["transfer-encoding"]?.toLowerCase() === "chunked") {
            // For chunked encoding, we'll accumulate until end
            bodyRemaining = -1; // Special marker for chunked
          } else {
            bodyRemaining = 0;
          }

          // Remove header part from buffer
          buffer = buffer.slice(headerEndIndex + 4);
        }

        if (currentRequest) {
          if (bodyRemaining > 0) {
            // Read body data
            const chunk = buffer.slice(0, Math.min(bodyRemaining, buffer.length));
            currentRequest.body = Buffer.concat([currentRequest.body, chunk]);
            buffer = buffer.slice(chunk.length);
            bodyRemaining -= chunk.length;
          } else if (bodyRemaining === -1) {
            // Chunked encoding - for simplicity, read until we see 0\r\n\r\n
            const chunkEndIndex = buffer.indexOf("0\r\n\r\n");
            if (chunkEndIndex !== -1) {
              currentRequest.body = Buffer.concat([currentRequest.body, buffer.slice(0, chunkEndIndex + 5)]);
              buffer = buffer.slice(chunkEndIndex + 5);
              bodyRemaining = 0;
            } else {
              // Accumulate and wait for more data
              currentRequest.body = Buffer.concat([currentRequest.body, buffer]);
              buffer = Buffer.alloc(0);
              break;
            }
          }

          if (bodyRemaining === 0) {
            // Request is complete, process it
            await this._processRequest(currentRequest, tlsSocket, host, port, startTime);
            currentRequest = null;
          }
        }
      }
    };

    tlsSocket.on("data", async (data) => {
      buffer = Buffer.concat([buffer, data]);
      try {
        await processBuffer();
      } catch (error) {
        logger.error("[HttpsInterceptor] Error processing request", {
          error: error.message,
          host,
        });
        this._sendErrorResponse(tlsSocket, 500, "Internal Proxy Error");
      }
    });

    tlsSocket.on("end", () => {
      logger.debug("[HttpsInterceptor] TLS socket ended", { host });
    });

    tlsSocket.on("close", () => {
      logger.debug("[HttpsInterceptor] TLS socket closed", { host });
    });
  }

  /**
   * Process a complete HTTP request
   * @param {Object} request - Parsed request object
   * @param {tls.TLSSocket} tlsSocket - TLS socket for response
   * @param {string} host - Target host
   * @param {number} port - Target port
   * @param {number} startTime - Request start time
   */
  async _processRequest(request, tlsSocket, host, port, startTime) {
    try {
      logger.info("[HttpsInterceptor] Processing HTTPS request", {
        method: request.method,
        url: request.fullUrl,
        host,
      });

      // Create a mock Express-like request object for context
      // Extract pathname (without query string) from request.path
      const pathWithQuery = request.path;
      const queryIndex = pathWithQuery.indexOf("?");
      const pathname = queryIndex !== -1 ? pathWithQuery.slice(0, queryIndex) : pathWithQuery;

      const mockReq = {
        method: request.method,
        url: request.fullUrl,
        originalUrl: request.fullUrl,
        path: pathname, // Path without query string (Express convention)
        headers: request.headers,
        body: request.body.length > 0 ? request.body : null,
        rawBody: request.body.length > 0 ? request.body : null,
        query: this._parseQueryString(pathWithQuery),
        ip: tlsSocket.remoteAddress,
        protocol: "https",
        get: (header) => request.headers[header.toLowerCase()],
      };

      // Create request context
      const requestContext = ContextFactory.createRequestContext(mockReq);

      // Create response context
      const responseContext = ContextFactory.createResponseContext();

      // Execute request interceptors
      if (this.interceptorChain) {
        await this.interceptorChain.executeRequest(requestContext);
      }

      // Handle request based on current mode
      let resultContext;
      if (this.modeService) {
        const modeOptions = {
          forwarder: this.forwarder,
          interceptorChain: this.interceptorChain,
        };

        // Log before mode handling
        logger.debug("[HttpsInterceptor] Calling mode service", {
          mode: this.modeService.getCurrentMode?.() || "unknown",
          hasForwarder: !!this.forwarder,
          targetUrl: requestContext.getCurrent().originalUrl || requestContext.getCurrent().url,
        });

        resultContext = await this.modeService.handleRequest(requestContext, responseContext, modeOptions);
      } else {
        // Fallback: direct forward to target
        resultContext = await this._forwardToTarget(requestContext, host, port);
      }

      const finalResponseContext = resultContext || responseContext;

      // Set latency
      if (!finalResponseContext.getAllMetadata().latency) {
        finalResponseContext.setLatency(Date.now() - startTime);
      }

      // Execute response interceptors only for monitored requests
      // Non-monitored requests (e.g., CDN, analytics, tracking) bypass stats recording
      if (this.interceptorChain && !shouldBypassDProxy(requestContext)) {
        await this.interceptorChain.executeResponse(finalResponseContext, requestContext);
      } else if (shouldBypassDProxy(requestContext)) {
        logger.debug("[HttpsInterceptor] Skipping response interceptors for non-monitored HTTPS request", {
          method: request.method,
          host,
          path: request.path,
        });
      }

      // Send response back to client
      this._sendResponse(tlsSocket, finalResponseContext, mockReq, startTime);

      logger.debug("[HttpsInterceptor] Request processed", {
        method: request.method,
        url: request.fullUrl,
        status: finalResponseContext.getStatus(),
        latency: Date.now() - startTime,
      });
    } catch (error) {
      logger.error("[HttpsInterceptor] Error processing request", {
        error: error.message,
        method: request.method,
        url: request.fullUrl,
        stack: error.stack,
      });
      this._sendErrorResponse(tlsSocket, 502, "Bad Gateway", mockReq, startTime);
    }
  }

  /**
   * Forward request directly to target server (fallback when no modeService)
   * @param {Object} requestContext - Request context
   * @param {string} host - Target host
   * @param {number} port - Target port
   * @returns {Promise<Object>} Response context
   */
  async _forwardToTarget(requestContext, host, port) {
    const current = requestContext.getCurrent();
    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      const options = {
        hostname: host,
        port: port,
        path: current.path,
        method: current.method,
        headers: { ...current.headers },
        rejectUnauthorized: false, // Allow self-signed certs on backend
      };

      const req = https.request(options, (res) => {
        const chunks = [];

        res.on("data", (chunk) => {
          chunks.push(chunk);
        });

        res.on("end", () => {
          const body = Buffer.concat(chunks);
          const responseContext = ContextFactory.createResponseContext();
          responseContext.setStatus(res.statusCode);
          responseContext.setHeaders(res.headers);
          responseContext.setBody(body);
          responseContext.setLatency(Date.now() - startTime);
          resolve(responseContext);
        });
      });

      req.on("error", (error) => {
        reject(error);
      });

      // Send body if present
      if (current.body) {
        req.write(Buffer.isBuffer(current.body) ? current.body : Buffer.from(JSON.stringify(current.body)));
      }

      req.end();
    });
  }

  /**
   * Send response to client over TLS socket
   * @param {tls.TLSSocket} tlsSocket - TLS socket
   * @param {Object} responseContext - Response context
   * @param {Object} mockReq - Mock request object for logging
   * @param {number} startTime - Request start time for duration calculation
   */
  _sendResponse(tlsSocket, responseContext, mockReq, startTime) {
    if (tlsSocket.destroyed) {
      return;
    }

    const status = responseContext.getStatus();
    const headers = responseContext.getHeaders();
    const body = responseContext.getBody();

    // Build response
    let response = `HTTP/1.1 ${status} ${this._getStatusText(status)}\r\n`;

    // Add headers
    const bodyBuffer = this._prepareBody(body);

    // Filter out hop-by-hop headers and set correct content-length
    const hopByHop = ["connection", "keep-alive", "transfer-encoding", "upgrade"];
    for (const [key, value] of Object.entries(headers)) {
      if (!hopByHop.includes(key.toLowerCase()) && key.toLowerCase() !== "content-length") {
        const values = Array.isArray(value) ? value : [value];
        for (const v of values) {
          response += `${key}: ${v}\r\n`;
        }
      }
    }

    // Set content-length
    response += `Content-Length: ${bodyBuffer.length}\r\n`;
    response += "Connection: close\r\n";
    response += "\r\n";

    // Write headers
    tlsSocket.write(response);

    // Write body
    if (bodyBuffer.length > 0) {
      tlsSocket.write(bodyBuffer);
    }

    // Log response to client
    if (mockReq) {
      const clientIP = mockReq.ip || "UNKNOWN";
      const mode = this.modeService?.getCurrentMode?.() || "unknown";
      const duration = Date.now() - startTime;
      const requestId = responseContext.getAllMetadata()?.requestId;

      trafficLogger.logClientResponse(mockReq, status, headers, body, duration, clientIP, mode, requestId);
    }

    // End the connection since we set Connection: close
    tlsSocket.end();
  }

  /**
   * Send error response
   * @param {tls.TLSSocket} tlsSocket - TLS socket
   * @param {number} status - HTTP status code
   * @param {string} message - Error message
   * @param {Object} mockReq - Mock request object for logging
   * @param {number} startTime - Request start time for duration calculation
   */
  _sendErrorResponse(tlsSocket, status, message, mockReq, startTime) {
    if (tlsSocket.destroyed) {
      return;
    }

    const body = JSON.stringify({ error: message, timestamp: new Date().toISOString() });
    const response =
      `HTTP/1.1 ${status} ${this._getStatusText(status)}\r\n` +
      `Content-Type: application/json\r\n` +
      `Content-Length: ${Buffer.byteLength(body)}\r\n` +
      `Connection: close\r\n` +
      `\r\n` +
      body;

    tlsSocket.write(response);

    // Log error response to client
    if (mockReq) {
      const clientIP = mockReq.ip || "UNKNOWN";
      const mode = this.modeService?.getCurrentMode?.() || "unknown";
      const duration = Date.now() - startTime;
      const requestId = null;

      trafficLogger.logClientResponse(mockReq, status, {}, body, duration, clientIP, mode, requestId);
    }

    tlsSocket.end();
  }

  /**
   * Prepare body for response
   * @param {*} body - Response body
   * @returns {Buffer} Body as buffer
   */
  _prepareBody(body) {
    if (!body) {
      return Buffer.alloc(0);
    }
    if (Buffer.isBuffer(body)) {
      return body;
    }
    if (typeof body === "object") {
      return Buffer.from(JSON.stringify(body));
    }
    return Buffer.from(String(body));
  }

  /**
   * Get status text for HTTP status code
   * @param {number} status - HTTP status code
   * @returns {string} Status text
   */
  _getStatusText(status) {
    const statusTexts = {
      200: "OK",
      201: "Created",
      204: "No Content",
      301: "Moved Permanently",
      302: "Found",
      304: "Not Modified",
      400: "Bad Request",
      401: "Unauthorized",
      403: "Forbidden",
      404: "Not Found",
      405: "Method Not Allowed",
      500: "Internal Server Error",
      502: "Bad Gateway",
      503: "Service Unavailable",
      504: "Gateway Timeout",
    };
    return statusTexts[status] || "Unknown";
  }

  /**
   * Parse query string from path
   * @param {string} path - URL path with query string
   * @returns {Object} Parsed query parameters
   */
  _parseQueryString(path) {
    const queryIndex = path.indexOf("?");
    if (queryIndex === -1) {
      return {};
    }

    const queryString = path.slice(queryIndex + 1);
    const params = {};

    for (const pair of queryString.split("&")) {
      const [key, value] = pair.split("=");
      if (key) {
        params[decodeURIComponent(key)] = value ? decodeURIComponent(value) : "";
      }
    }

    return params;
  }

  /**
   * Close socket safely
   * @param {net.Socket} socket - Socket to close
   */
  _closeSocket(socket) {
    if (socket && !socket.destroyed) {
      socket.destroy();
    }
  }
}

module.exports = HttpsInterceptor;
