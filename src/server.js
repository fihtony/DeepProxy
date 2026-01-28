/**
 * server.js
 *
 * Main Express server with new architecture integration
 * - Proxy server with three modes (Passthrough, Recording, Replay)
 * - Management API endpoints
 * - Context + Interceptor + Forwarder pattern
 */

const express = require("express");
const cors = require("cors");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const { open } = require("sqlite");

// Core components
const ContextFactory = require("./core/context/ContextFactory");
const InterceptorChain = require("./core/interceptors/InterceptorChain");
const HttpForwarder = require("./core/forwarder/HttpForwarder");
const ForwardConfig = require("./core/forwarder/ForwardConfig");
const ModeService = require("./services/ModeService");

// Interceptors
const {
  UserIdExtractionInterceptor,
  MobileHeaderExtractionInterceptor,
  RequestLoggingInterceptor,
  HeaderNormalizationInterceptor,
} = require("./core/interceptors/RequestInterceptor");

const {
  ResponseLoggingInterceptor,
  CorsHeadersInterceptor,
  SecurityHeadersInterceptor,
  JsonResponseInterceptor,
} = require("./core/interceptors/ResponseInterceptor");

const StatsRecordingInterceptor = require("./core/interceptors/StatsRecordingInterceptor");
const { shouldBypassDProxy } = require("./utils/requestTypeDetector");

// API Routes
const requestsRoutes = require("./api/routes/requests");
const responsesRoutes = require("./api/routes/responses");
const configsRoutes = require("./api/routes/configs");
const templatesRoutes = require("./api/routes/templates");
const modesRoutes = require("./api/routes/modes");
const servicesRoutes = require("./api/routes/services");
const settingsRoutes = require("./api/routes/settings");

// Utils
const logger = require("./utils/logger");
const config = require("./config");

class ProxyServer {
  constructor(options = {}) {
    this.port = options.port || config.proxy?.port || 8080;
    this.targetBaseUrl = options.targetBaseUrl || config.proxy?.targetHost || "http://localhost:3000";
    this.db = null;
    this.modeService = null;
    this.interceptorChain = null;
    this.forwarder = null;
    this.app = null;
  }

  /**
   * Initialize database connection
   */
  async initializeDatabase() {
    try {
      logger.info("Initializing database connection");

      const dbPath = path.join(__dirname, "../data/dproxy.db");
      this.db = await open({
        filename: dbPath,
        driver: sqlite3.Database,
      });

      // Enable foreign keys
      await this.db.exec("PRAGMA foreign_keys = ON");

      logger.info("Database connection established", { dbPath });
    } catch (error) {
      logger.error("Failed to initialize database", { error: error.message });
      throw error;
    }
  }

  /**
   * Initialize core components
   */
  initializeComponents() {
    logger.info("Initializing core components");

    // Initialize interceptor chain
    this.interceptorChain = new InterceptorChain();

    // Register request interceptors
    this.interceptorChain.addRequestInterceptor(new UserIdExtractionInterceptor(), 100);
    this.interceptorChain.addRequestInterceptor(new MobileHeaderExtractionInterceptor(), 95);
    this.interceptorChain.addRequestInterceptor(new HeaderNormalizationInterceptor(), 90);
    this.interceptorChain.addRequestInterceptor(new RequestLoggingInterceptor(), 10);

    // Register response interceptors
    this.interceptorChain.addResponseInterceptor(new SecurityHeadersInterceptor(), 100);
    this.interceptorChain.addResponseInterceptor(new CorsHeadersInterceptor(), 90);
    this.interceptorChain.addResponseInterceptor(new JsonResponseInterceptor(), 80);
    this.interceptorChain.addResponseInterceptor(new StatsRecordingInterceptor(), 50); // Record statistics for monitored requests
    this.interceptorChain.addResponseInterceptor(new ResponseLoggingInterceptor(), 10);

    // Initialize HTTP forwarder
    // Note: targetBaseUrl is not set - proxy extracts host from client request directly
    const forwardConfig = new ForwardConfig({
      targetBaseUrl: null, // Proxy extracts target from client request, not from predefined value
      timeout: 30000,
      retryCount: 2,
      trustSelfSignedCerts: true, // Trust self-signed certs for backend connections (e.g., UAT environments)
    });
    this.forwarder = new HttpForwarder(forwardConfig);

    // Initialize mode service with dependencies
    const modeDependencies = {
      forwarder: this.forwarder,
      interceptorChain: this.interceptorChain,
      config: config,
    };
    this.modeService = new ModeService(this.db, modeDependencies);

    // Mode will be initialized from database in start() method after database is ready

    logger.info("Core components initialized", {
      requestInterceptors: this.interceptorChain.requestInterceptors.length,
      responseInterceptors: this.interceptorChain.responseInterceptors.length,
      // Note: Mode will be initialized from database in start() method
    });
  }

  /**
   * Initialize Express app
   */
  initializeApp() {
    logger.info("Initializing Express app");

    this.app = express();

    // Basic middleware
    this.app.use(cors());

    // CRITICAL: Capture raw request body BEFORE body-parser consumes it
    // This is required for transmit endpoints that need exact bytes for signature verification
    // body_capture will handle JSON parsing for all routes EXCEPT /admin
    const { captureRequestBody } = require("./middleware/body_capture");
    this.app.use(captureRequestBody);

    // Only use express.json for /admin routes (captureRequestBody skips /admin)
    this.app.use("/admin", express.json({ limit: "10mb" }));
    this.app.use("/admin", express.urlencoded({ extended: true, limit: "10mb" }));

    // For all other routes, req.body should already be set by captureRequestBody
    // Or it might be null/undefined if no parsing was needed

    // Health check endpoint
    this.app.get("/health", (req, res) => {
      res.json({
        status: "healthy",
        mode: this.modeService.getCurrentMode(),
        timestamp: new Date().toISOString(),
      });
    });

    // API Routes (Management Interface)
    this.app.use("/api/requests", requestsRoutes(this.db));
    this.app.use("/api/responses", responsesRoutes(this.db));
    this.app.use("/api/configs", configsRoutes(this.db));
    this.app.use("/api/templates", templatesRoutes(this.db));
    // Pass the existing modeService instance (already initialized from database)
    this.app.use("/api/modes", modesRoutes(this.modeService));
    this.app.use("/api/stats", require("./api/routes/stats")(this.db));
    this.app.use("/api/services", servicesRoutes());
    this.app.use("/api/settings", settingsRoutes());

    // Admin API routes (for Web UI compatibility) - must be before proxy handler
    this.app.use("/admin/stats", require("./api/routes/stats")(this.db));
    this.app.use("/admin/services", servicesRoutes());
    this.app.use("/admin/api/configs", configsRoutes(this.db));
    this.app.use("/admin/api/responses", responsesRoutes(this.db));
    this.app.use("/admin/api/settings", settingsRoutes());

    // Timeline filter endpoints
    this.app.get("/admin/api/timeline-filter", async (req, res) => {
      try {
        const configRepository = require("./database/repositories/config_repository");
        const timelineFilter = await configRepository.getTimelineFilter();
        res.json({ success: true, timelineFilter });
      } catch (error) {
        logger.error("Failed to get timeline filter", { error: error.message });
        res.status(500).json({ success: false, error: error.message });
      }
    });

    this.app.post("/admin/api/timeline-filter", async (req, res) => {
      try {
        const { timelineFilter } = req.body;
        const configRepository = require("./database/repositories/config_repository");
        await configRepository.updateTimelineFilter(timelineFilter);
        res.json({ success: true, timelineFilter });
      } catch (error) {
        logger.error("Failed to save timeline filter", { error: error.message });
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Create a separate router for /admin/mode with direct routes
    const adminModeRouter = express.Router();
    // Use the existing modeService instance (already initialized from database)

    // GET /admin/mode
    adminModeRouter.get("/", (req, res) => {
      try {
        const mode = this.modeService.getCurrentMode();
        res.json({
          success: true,
          data: {
            mode,
            timestamp: new Date().toISOString(),
          },
        });
      } catch (error) {
        logger.error("Failed to get current mode", { error: error.message });
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // POST /admin/mode
    adminModeRouter.post("/", async (req, res) => {
      try {
        const { mode } = req.body;
        if (!mode) {
          return res.status(400).json({ success: false, error: "mode is required" });
        }
        const result = await this.modeService.setMode(mode);
        res.json({
          success: true,
          message: "Mode changed successfully",
          data: result,
        });
      } catch (error) {
        logger.error("Failed to set mode", { error: error.message });
        res.status(400).json({ success: false, error: error.message });
      }
    });

    this.app.use("/admin/mode", adminModeRouter);

    // Also keep /api/modes routes for API compatibility
    // Pass the existing modeService instance (already initialized from database)
    this.app.use("/api/modes", modesRoutes(this.modeService));

    // Proxy handler (catch-all for proxied requests)
    this.app.use("*", this.proxyHandler.bind(this));

    // Error handler
    this.app.use(this.errorHandler.bind(this));

    logger.info("Express app initialized");
  }

  /**
   * Main proxy request handler
   */
  async proxyHandler(req, res, next) {
    const startTime = Date.now();
    let requestContext = null; // Declare outside try block so it's accessible in catch

    try {
      // CONNECT method is handled at HTTP server level (see start() method)
      // Express middleware won't receive CONNECT requests

      // Skip proxy handling for admin API routes
      // These routes should be handled by Express routes registered before this catch-all handler
      // If we reach here, it means Express didn't match the route, so let it fall through
      const adminRoutes = ["/admin", "/api", "/health"];
      const isAdminRoute = adminRoutes.some(
        (route) =>
          req.path === route || req.path.startsWith(route + "/") || req.originalUrl === route || req.originalUrl.startsWith(route + "/")
      );

      if (isAdminRoute) {
        // Admin route should have been handled - if not, let Express error handler deal with it
        return next();
      }

      // Check if this is a proxy request (has absolute URL or is not a root path request)
      // Root path requests without absolute URL are likely admin API requests that should have been handled earlier
      const isRootPath = req.path === "/" || req.originalUrl === "/";
      const hasAbsoluteUrl =
        (req.originalUrl && (req.originalUrl.startsWith("http://") || req.originalUrl.startsWith("https://"))) ||
        (req.url && (req.url.startsWith("http://") || req.url.startsWith("https://")));

      // If it's a root path request without absolute URL, it's likely not a proxy request
      // Return a helpful error message instead of trying to proxy it
      if (isRootPath && !hasAbsoluteUrl) {
        logger.warn("Root path request without absolute URL - likely not a proxy request", {
          method: req.method,
          path: req.path,
          originalUrl: req.originalUrl,
          url: req.url,
          headers: req.headers,
        });

        return res.status(400).json({
          error: "Bad Request",
          message:
            "This is a proxy server. Please send requests with absolute URLs (e.g., GET http://example.com/path) or use the management API endpoints.",
          availableEndpoints: {
            health: "/health",
            stats: "/admin/stats",
            mode: "/admin/mode",
            api: "/api/*",
          },
        });
      }

      // Extract full URL from request if it's an absolute URL (HTTP proxy protocol)
      // When client sends request through proxy, it may send: GET https://example.com/path HTTP/1.1
      // Express parses this into req.originalUrl with the full path
      // Priority: req.originalUrl (has full path) > req.url (may be incomplete)
      if (req.originalUrl && (req.originalUrl.startsWith("http://") || req.originalUrl.startsWith("https://"))) {
        // req.originalUrl already has the full absolute URL with path - use it as-is
        // No need to modify req.originalUrl - it already has the correct full URL
      } else if (req.url && (req.url.startsWith("http://") || req.url.startsWith("https://"))) {
        // req.url has absolute URL but may be missing path - check if originalUrl has path info
        // If originalUrl has path, combine them
        if (req.originalUrl && req.originalUrl !== req.url && !req.originalUrl.startsWith("http")) {
          // originalUrl has the path part, combine with URL from req.url
          try {
            const urlObj = new URL(req.url);
            const fullUrl = urlObj.origin + req.originalUrl;
            req.originalUrl = fullUrl;
          } catch (e) {
            // Fallback: use req.url as-is
            req.originalUrl = req.url;
          }
        } else {
          req.originalUrl = req.url;
        }
      }

      // Create request context
      requestContext = ContextFactory.createRequestContext(req);

      // Create response context
      const responseContext = ContextFactory.createResponseContext();

      // Execute request interceptors
      await this.interceptorChain.executeRequest(requestContext);

      // Handle request based on current mode
      const modeOptions = {
        forwarder: this.forwarder,
        interceptorChain: this.interceptorChain,
      };

      // Get the response context from the mode handler
      const resultContext = await this.modeService.handleRequest(requestContext, responseContext, modeOptions);

      // Use the result context if returned, otherwise use the passed responseContext
      const finalResponseContext = resultContext || responseContext;

      // Set latency if not already set
      if (!finalResponseContext.getAllMetadata().latency) {
        finalResponseContext.setLatency(Date.now() - startTime);
      }

      // Execute response interceptors only for monitored requests
      // Non-monitored requests (e.g., CDN, static images) bypass stats recording
      if (!shouldBypassDProxy(requestContext)) {
        await this.interceptorChain.executeResponse(finalResponseContext, requestContext);
      } else {
        logger.debug("Skipping response interceptors for non-monitored request", {
          method: requestContext.getMethod(),
          path: requestContext.getPath(),
        });
      }

      // Send response
      res.status(finalResponseContext.getStatus());

      const headers = finalResponseContext.getHeaders();
      // Remove hop-by-hop headers and conflicting headers before setting
      const hopByHopHeaders = ["connection", "keep-alive", "transfer-encoding", "content-encoding", "upgrade"];
      Object.keys(headers).forEach((key) => {
        const lowerKey = key.toLowerCase();
        // Skip hop-by-hop headers
        if (hopByHopHeaders.includes(lowerKey)) {
          return;
        }
        // Skip Content-Length if Transfer-Encoding is present (Express will set Content-Length automatically)
        if (lowerKey === "content-length" && headers["transfer-encoding"]) {
          return;
        }
        res.setHeader(key, headers[key]);
      });

      const body = finalResponseContext.getBody();
      if (body !== null && body !== undefined) {
        if (Buffer.isBuffer(body)) {
          // Send Buffer directly without JSON serialization
          res.send(body);
        } else if (typeof body === "object") {
          res.json(body); // Express will set Content-Length automatically
        } else {
          res.send(body); // Express will set Content-Length automatically
        }
      } else {
        res.end();
      }

      // Log response sent to client
      const trafficLogger = require("./utils/traffic_logger");
      const requestId = finalResponseContext.getAllMetadata()?.requestId || requestContext?.metadata?.requestId;
      const originalRequest = requestContext?.getOriginal();
      const clientIP = originalRequest?.ip || req.ip || "UNKNOWN";
      const mode = this.modeService.getCurrentMode();
      const duration = Date.now() - startTime;

      trafficLogger.logClientResponse(
        {
          method: originalRequest?.method || req.method,
          path: originalRequest?.path || req.path,
          url: originalRequest?.originalUrl || req.originalUrl || req.url,
          originalUrl: originalRequest?.originalUrl || req.originalUrl || req.url,
          headers: originalRequest?.headers || req.headers,
        },
        finalResponseContext.getStatus(),
        finalResponseContext.getHeaders(),
        body,
        duration,
        clientIP,
        mode,
        requestId
      );

      // Log request completion
      const elapsed = Date.now() - startTime;
      logger.debug("Request completed", {
        method: requestContext.getMethod(),
        path: requestContext.getPath(),
        status: finalResponseContext.getStatus(),
        elapsed,
        mode: this.modeService.getCurrentMode(),
      });
    } catch (error) {
      // Record failed request in stats
      const elapsed = Date.now() - startTime;
      try {
        // Ensure we have a requestContext (might be null if error occurred early)
        if (!requestContext) {
          requestContext = ContextFactory.createRequestContext(req);
        }

        // Create error response context for stats recording
        const errorContext = ContextFactory.createErrorResponse(error.statusCode || 500, error.message || "Internal server error", {
          error,
        });
        errorContext.setLatency(elapsed);

        // Execute response interceptors to record the failure
        await this.interceptorChain.executeResponse(errorContext, requestContext);
      } catch (statsError) {
        logger.error("Failed to record error statistics", {
          error: statsError.message,
          originalError: error.message,
          stack: statsError.stack,
        });
      }

      // Send error response
      const statusCode = error.statusCode || 500;
      if (!res.headersSent) {
        res.status(statusCode).json({
          error: error.message || "Internal server error",
          timestamp: new Date().toISOString(),
        });
      }
    }
  }

  /**
   * Error handler middleware
   */
  errorHandler(error, req, res, next) {
    logger.error("Request error", {
      error: error.message,
      stack: error.stack,
      method: req.method,
      path: req.path,
    });

    res.status(error.statusCode || 500).json({
      error: error.message || "Internal server error",
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Start server
   */
  async start() {
    try {
      // Initialize database
      await this.initializeDatabase();

      // Initialize components
      this.initializeComponents();

      // Initialize mode from database (after ModeService is created)
      await this.modeService.initializeModeFromDatabase();

      // Initialize TrafficConfigManager (after database connection is ready)
      const { initializeInstance: initTrafficConfig } = require("./config/TrafficConfigManager");
      await initTrafficConfig();
      logger.info("TrafficConfigManager initialized");

      // Initialize SessionConfigManager (after database connection is ready)
      // Critical for session creation rules in recording/replay modes
      const { initialize: initSessionConfig } = require("./config/SessionConfigManager");
      await initSessionConfig();
      logger.info("SessionConfigManager initialized");

      // Initialize Express app
      this.initializeApp();

      // Initialize HTTPS interceptor for MITM proxying
      const HttpsInterceptor = require("./core/forwarder/HttpsInterceptor");
      this.httpsInterceptor = new HttpsInterceptor({
        modeService: this.modeService,
        interceptorChain: this.interceptorChain,
        forwarder: this.forwarder,
      });

      // Initialize certificate manager
      const CertManager = require("./core/forwarder/CertManager");
      const certManager = CertManager.getInstance();
      await certManager.initialize();
      logger.info("HTTPS interception ready", {
        caCertPath: certManager.getCACertificatePath(),
      });

      // Start listening with CONNECT method support
      await new Promise((resolve) => {
        const http = require("http");
        this.server = http.createServer(this.app);

        // ⚠️ HTTPS Interception (MITM) Handler
        // ========================================================
        // This handler intercepts HTTPS traffic using self-signed certificates.
        // It decrypts the traffic, processes it through the proxy (recording/replay),
        // then re-encrypts and forwards to the target server.
        //
        // Clients MUST trust the CA certificate at: data/certs/ca.cert.pem
        // For Android: Install as a user certificate or system certificate
        //
        // Domain Bypass Logic:
        // - Only domains configured in traffic monitoring are intercepted (MITM)
        // - All other domains bypass HTTPS interception and use direct tunneling
        // - This is determined by TrafficConfigManager.isMonitoredDomain()
        // ========================================================

        this.server.on("connect", (req, socket, head) => {
          const targetHost = req.url; // CONNECT requests have target host:port in req.url
          const [host, portStr] = targetHost.split(":");
          const port = parseInt(portStr || "443", 10);

          logger.info("[CONNECT] HTTPS interception request", {
            targetHost,
            userAgent: req.headers["user-agent"],
          });

          // Get traffic config manager to check if domain is monitored
          const { getInstance: getTrafficConfigManager } = require("./config/TrafficConfigManager");
          const trafficConfigManager = getTrafficConfigManager();

          // Check if this host is in the monitored domains list
          const isMonitored = trafficConfigManager.isMonitoredDomain(host);

          if (!isMonitored) {
            logger.info("[CONNECT] Domain not in monitored list - bypassing HTTPS interception for direct tunneling", { host });

            // Direct tunnel without MITM for non-monitored domains
            const net = require("net");
            const targetSocket = net.connect(port, host, () => {
              socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
              targetSocket.pipe(socket);
              socket.pipe(targetSocket);
            });

            targetSocket.on("error", (error) => {
              logger.error("[CONNECT] Direct tunnel error", {
                error: error.message,
                targetHost,
              });
              if (!socket.destroyed) {
                socket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
                socket.destroy();
              }
            });

            return;
          }

          // Use HTTPS interception to decrypt and process the traffic
          this.httpsInterceptor.handleConnect(req, socket, head, targetHost).catch((error) => {
            logger.error("[CONNECT] HTTPS interception error", {
              error: error.message,
              targetHost,
              stack: error.stack,
            });

            if (!socket.destroyed) {
              socket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
              socket.destroy();
            }
          });
        });

        this.server.listen(this.port, () => {
          logger.info("Deep Proxy server started", {
            port: this.port,
            mode: this.modeService.getCurrentMode(),
          });
          resolve();
        });
      });

      return this.server;
    } catch (error) {
      logger.error("Failed to start server", { error: error.message });
      throw error;
    }
  }

  /**
   * Stop server
   */
  async stop() {
    try {
      if (this.server) {
        await new Promise((resolve) => {
          this.server.close(() => {
            logger.info("Server stopped");
            resolve();
          });
        });
      }

      if (this.db) {
        await this.db.close();
        logger.info("Database connection closed");
      }

      logger.info("dProxy shutdown complete");
    } catch (error) {
      logger.error("Error during shutdown", { error: error.message });
      throw error;
    }
  }

  /**
   * Get mode service instance
   */
  getModeService() {
    return this.modeService;
  }

  /**
   * Get interceptor chain instance
   */
  getInterceptorChain() {
    return this.interceptorChain;
  }

  /**
   * Get forwarder instance
   */
  getForwarder() {
    return this.forwarder;
  }
}

module.exports = ProxyServer;
