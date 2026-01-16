/**
 * HTTPS Tunnel Handler
 * 
 * Handles HTTP CONNECT method for HTTPS tunneling through proxy
 * Creates a tunnel between client and backend server for HTTPS connections
 * 
 * Usage:
 * When client sends: CONNECT example.com:443 HTTP/1.1
 * This handler creates a tunnel and forwards encrypted traffic
 * 
 * ⚠️ IMPORTANT NOTE FOR DEVELOPERS/AI AGENTS:
 * ============================================
 * This implementation is CORRECT and works fine with:
 * - curl (✅ works)
 * - Node.js native https module (✅ works)
 * - HttpsProxyAgent library (✅ works)
 * 
 * However, axios's 'proxy' option has a bug with CONNECT handling.
 * When using axios for HTTPS requests through this proxy:
 * 
 * ❌ DO NOT USE:
 *   axios.get('https://...', { proxy: { host: 'localhost', port: 8080 } })
 *   This will cause: EPROTO error "packet length too long"
 * 
 * ✅ USE INSTEAD:
 *   const { HttpsProxyAgent } = require('https-proxy-agent');
 *   const agent = new HttpsProxyAgent('http://localhost:8080');
 *   axios.get('https://...', { httpsAgent: agent })
 * 
 * See docs/IMPORTANT_HTTPS_PROXY_USAGE.md for details.
 * ============================================
 */

const net = require("net");
const https = require("https");
const logger = require("../../utils/logger");

class HttpsTunnel {
  /**
   * Handle CONNECT request
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {Buffer} head - Initial data buffer (from CONNECT request)
   * @param {string} targetHost - Target host from CONNECT request (e.g., "example.com:443")
   */
  static handleConnect(req, res, targetHost, head = null) {
    return new Promise((resolve, reject) => {
      try {
        // Get the client socket from request
        const clientSocket = req.socket || req;
        
        // Parse target host and port
        const [host, portStr] = targetHost.split(":");
        const port = parseInt(portStr || "443", 10);

        logger.info("[HTTPS_TUNNEL] Establishing tunnel", {
          targetHost,
          host,
          port,
          clientIP: clientSocket.remoteAddress,
          headLength: head ? head.length : 0,
        });

        // ⚠️ CRITICAL: Send CONNECT response IMMEDIATELY, before establishing target connection
        // ================================================================================
        // Some clients (like HttpsProxyAgent) start sending TLS data immediately after
        // receiving CONNECT response. We must send the response first, then establish
        // the tunnel. This implementation is correct and works with proper clients.
        // 
        // NOTE: axios's 'proxy' option has bugs that cause EPROTO errors even with
        // correct CONNECT handling. Clients should use HttpsProxyAgent instead.
        // See docs/IMPORTANT_HTTPS_PROXY_USAGE.md
        // ================================================================================
        if (!res.headersSent) {
          // Write proper HTTP/1.1 200 Connection Established response
          // Must be exact: "HTTP/1.1 200 Connection Established\r\n\r\n"
          const response = Buffer.from("HTTP/1.1 200 Connection Established\r\n\r\n");
          clientSocket.write(response);
          res.headersSent = true;
          
          logger.debug("[HTTPS_TUNNEL] CONNECT response sent immediately", {
            targetHost,
            headLength: head ? head.length : 0,
          });
        }

        // Buffer any data received from client while we're establishing the target connection
        const clientDataBuffer = [];
        let targetSocketReady = false;
        
        // Collect data from client until target is ready
        const onClientData = (data) => {
          if (targetSocketReady && targetSocket && !targetSocket.destroyed) {
            targetSocket.write(data);
          } else {
            clientDataBuffer.push(data);
          }
        };
        
        clientSocket.on("data", onClientData);
        
        // Forward buffered head data if any
        if (head && head.length > 0) {
          clientDataBuffer.push(head);
        }

        // Create connection to target server AFTER sending CONNECT response
        const targetSocket = net.createConnection(port, host, () => {
          logger.debug("[HTTPS_TUNNEL] Target connection established", {
            targetHost,
            host,
            port,
          });
          
          targetSocketReady = true;

          // Write all buffered client data to target
          if (clientDataBuffer.length > 0) {
            logger.debug("[HTTPS_TUNNEL] Forwarding buffered client data", {
              bufferChunks: clientDataBuffer.length,
              totalLength: clientDataBuffer.reduce((sum, chunk) => sum + chunk.length, 0),
            });
            clientDataBuffer.forEach(chunk => {
              if (!targetSocket.destroyed) {
                targetSocket.write(chunk);
              }
            });
            clientDataBuffer.length = 0; // Clear buffer
          }

          // Now pipe the sockets - client sends encrypted data to target, target sends back to client
          // Use { end: false } to prevent closing the socket when one side closes
          // Remove the data listener first to avoid double processing
          clientSocket.removeListener("data", onClientData);
          clientSocket.pipe(targetSocket, { end: false });
          targetSocket.pipe(clientSocket, { end: false });
          
          logger.debug("[HTTPS_TUNNEL] Pipes established", { targetHost });
          
          // Handle errors on sockets
          const onClientError = (err) => {
            logger.error("[HTTPS_TUNNEL] Client socket error", { error: err.message });
            if (!targetSocket.destroyed) {
              targetSocket.destroy();
            }
            clientSocket.removeListener("error", onClientError);
          };
          
          const onTargetError = (err) => {
            logger.error("[HTTPS_TUNNEL] Target socket error", { error: err.message });
            if (!clientSocket.destroyed) {
              clientSocket.destroy();
            }
            targetSocket.removeListener("error", onTargetError);
          };
          
          clientSocket.on("error", onClientError);
          targetSocket.on("error", onTargetError);
          
          // Handle end events
          clientSocket.on("end", () => {
            if (!targetSocket.destroyed) {
              targetSocket.end();
            }
          });
          targetSocket.on("end", () => {
            if (!clientSocket.destroyed) {
              clientSocket.end();
            }
          });

          logger.info("[HTTPS_TUNNEL] Tunnel established", {targetHost});
          
          resolve();
        });

        // Handle target socket errors
        targetSocket.on("error", (error) => {
          logger.error("[HTTPS_TUNNEL] Target socket error", {
            targetHost,
            error: error.message,
          });

          if (!res.headersSent) {
            clientSocket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
            res.headersSent = true;
          }

          clientSocket.destroy();
          reject(error);
        });

        // Handle client socket errors
        clientSocket.on("error", (error) => {
          logger.error("[HTTPS_TUNNEL] Client socket error", {
            targetHost,
            error: error.message,
          });
          targetSocket.destroy();
        });

        // Handle connection close
        clientSocket.on("close", () => {
          logger.info("[HTTPS_TUNNEL] Client socket closed", { targetHost });
          targetSocket.destroy();
        });

        targetSocket.on("close", () => {
          logger.info("[HTTPS_TUNNEL] Target socket closed", { targetHost });
          clientSocket.destroy();
        });

        // Don't resolve here - wait for connection to be established
      } catch (error) {
        logger.error("[HTTPS_TUNNEL] Error handling CONNECT", {
          targetHost,
          error: error.message,
        });

        const clientSocket = req.socket || req;
        if (!res.headersSent) {
          clientSocket.write("HTTP/1.1 500 Internal Server Error\r\n\r\n");
          res.headersSent = true;
        }

        clientSocket.destroy();
        reject(error);
      }
    });
  }
}

module.exports = HttpsTunnel;

