/**
 * ModeService.js
 *
 * Service layer for managing proxy modes.
 * Provides business logic for:
 * - Mode configuration and switching
 * - Mode execution coordination
 * - Mode statistics and monitoring
 */

const PassthroughMode = require("../modes/PassthroughMode");
const RecordingMode = require("../modes/RecordingMode");
const ReplayMode = require("../modes/ReplayMode");
const RequestService = require("./RequestService");
const ResponseService = require("./ResponseService");
const MatchingService = require("./MatchingService");
const logger = require("../utils/logger");
const { shouldBypassDProxy } = require("../utils/requestTypeDetector");

class ModeService {
  constructor(db, dependencies = {}) {
    if (!db) {
      throw new Error("ModeService requires a database connection");
    }

    this.db = db;
    this.requestService = new RequestService(db);
    this.responseService = new ResponseService(db);
    this.matchingService = new MatchingService(db);

    // Initialize repositories for mode handlers
    const ApiRequestRepository = require("../database/repositories/ApiRequestRepository");
    const ApiResponseRepository = require("../database/repositories/ApiResponseRepository");
    const ResponseTemplateRepository = require("../database/repositories/ResponseTemplateRepository");
    const EndpointConfigRepository = require("../database/repositories/EndpointConfigRepository");
    const MatchingEngine = require("../core/matching/MatchingEngine");
    const {
      VersionMatcher,
      LanguageMatcher,
      PlatformMatcher,
      EnvironmentMatcher,
      HeaderMatcher,
      BodyMatcher,
    } = require("../core/matching/Matchers");

    const repositories = {
      apiRequestRepo: new ApiRequestRepository(db),
      apiResponseRepo: new ApiResponseRepository(db),
      templateRepo: new ResponseTemplateRepository(db),
      endpointConfigRepo: new EndpointConfigRepository(db),
    };

    // Initialize matchers
    const matchers = {
      versionMatcher: new VersionMatcher(),
      languageMatcher: new LanguageMatcher(),
      platformMatcher: new PlatformMatcher(),
      environmentMatcher: new EnvironmentMatcher(),
      headerMatcher: new HeaderMatcher(),
      bodyMatcher: new BodyMatcher(),
    };

    // Initialize matching engine with repositories and matchers
    const matchingEngine = new MatchingEngine(repositories, matchers);

    // Build dependencies object for mode handlers
    const modeDependencies = {
      forwarder: dependencies.forwarder,
      interceptorChain: dependencies.interceptorChain,
      repositories,
      matchingEngine,
      config: dependencies.config || {},
    };

    // Initialize mode handlers
    this.modes = {
      passthrough: new PassthroughMode(modeDependencies),
      recording: new RecordingMode(modeDependencies),
      replay: new ReplayMode(modeDependencies),
    };

    // Current active mode - initialize from database
    this.currentMode = "passthrough"; // Default, will be updated from database

    // Mode statistics
    this.stats = {
      passthrough: { requests: 0, errors: 0 },
      recording: { requests: 0, errors: 0, recorded: 0 },
      replay: { requests: 0, errors: 0, hits: 0, misses: 0 },
    };
  }

  /**
   * Initialize mode from database (call after database is ready)
   * If mode doesn't exist or is invalid, set to "passthrough" and save to database
   * @returns {Promise<void>}
   */
  async initializeModeFromDatabase() {
    try {
      const configRepository = require("../database/repositories/config_repository");
      const dbMode = await configRepository.getProxyMode();

      const validModes = ["passthrough", "recording", "replay"];

      if (dbMode && validModes.includes(dbMode) && this.modes[dbMode]) {
        // Valid mode found in database - use it
        this.currentMode = dbMode;
        logger.info("Mode initialized from database", { mode: dbMode });
      } else {
        // No valid mode in database - use "passthrough" as default and save to database
        const defaultMode = "passthrough";
        this.currentMode = defaultMode;

        // Save default mode to database
        try {
          await configRepository.updateProxyMode(defaultMode);
          logger.info("Mode not found or invalid in database, set to default and saved", {
            mode: defaultMode,
            previousDbMode: dbMode || "none",
          });
        } catch (saveError) {
          logger.error("Failed to save default mode to database", {
            error: saveError.message,
            mode: defaultMode,
          });
        }
      }
    } catch (error) {
      logger.error("Failed to initialize mode from database, using default passthrough", {
        error: error.message,
      });
      // Use passthrough as fallback if database read fails
      this.currentMode = "passthrough";
    }
  }

  /**
   * Get current proxy mode
   * @returns {string} Current mode name
   */
  getCurrentMode() {
    return this.currentMode;
  }

  /**
   * Set proxy mode and persist to database
   * @param {string} mode Mode name (passthrough, recording, replay)
   * @returns {Promise<Object>} Mode info
   */
  async setMode(mode) {
    if (!this.modes[mode]) {
      throw new Error(`Invalid mode: ${mode}. Valid modes: passthrough, recording, replay`);
    }

    const oldMode = this.currentMode;
    this.currentMode = mode;

    // Persist to database
    try {
      const configRepository = require("../database/repositories/config_repository");
      await configRepository.updateProxyMode(mode);
    } catch (error) {
      logger.error("Failed to persist mode change to database", {
        error: error.message,
        mode,
      });
      // Don't throw - mode change still succeeds in memory
    }

    logger.info("Proxy mode changed", { oldMode, newMode: mode });

    return {
      mode: this.currentMode,
      handler: this.modes[mode].getModeName(),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get mode handler
   * @param {string} mode Mode name (optional, defaults to current mode)
   * @returns {Object} Mode handler instance
   */
  getModeHandler(mode = null) {
    const modeName = mode || this.currentMode;

    if (!this.modes[modeName]) {
      throw new Error(`Invalid mode: ${modeName}`);
    }

    return this.modes[modeName];
  }

  /**
   * Handle request using current mode
   * Non-monitored requests (not matching configured monitoring criteria) are directly forwarded
   * and bypass normal Deep Proxy processing (matching, stats recording, etc.)
   * @param {Object} requestContext RequestContext instance
   * @param {Object} responseContext ResponseContext instance
   * @param {Object} options Mode-specific options
   * @returns {Promise<Object>} Response data
   */
  async handleRequest(requestContext, responseContext, options = {}) {
    try {
      const startTime = Date.now();

      // Check if this is a non-monitored request (e.g., CDN, static image request, request from unmonitored domain)
      // These should be directly forwarded without endpoint matching or stats recording
      if (shouldBypassDProxy(requestContext)) {
        logger.info("Non-monitored request detected - bypassing Deep Proxy, direct forward", {
          method: requestContext.getMethod(),
          path: requestContext.getPath(),
          userAgent: requestContext.getCurrent().headers["user-agent"] || "unknown",
        });

        // Use passthrough mode to directly forward the request
        const passthroughMode = this.getModeHandler("passthrough");
        const result = await passthroughMode.handleRequest(requestContext, responseContext, options);

        // Set latency
        if (!result.getAllMetadata().latency) {
          result.setLatency(Date.now() - startTime);
        }

        // Return result WITHOUT executing response interceptors
        // This prevents stats recording and other processing
        logger.info("Non-monitored request forwarded successfully", {
          method: requestContext.getMethod(),
          path: requestContext.getPath(),
          status: result.getStatus(),
          latency: Date.now() - startTime,
        });

        return result;
      }

      const mode = options.mode || this.currentMode;
      const handler = this.getModeHandler(mode);

      logger.debug("Handling monitored request", {
        mode,
        method: requestContext.getMethod(),
        path: requestContext.getPath(),
      });

      // Execute mode handler for monitored requests
      const result = await handler.handleRequest(requestContext, responseContext, options);

      // Update statistics
      const elapsed = Date.now() - startTime;
      this._updateStats(mode, "success", result, elapsed);

      return result;
    } catch (error) {
      logger.error("Failed to handle request", {
        mode: this.currentMode,
        error: error.message,
      });

      // Update error statistics
      this._updateStats(this.currentMode, "error");

      throw error;
    }
  }

  /**
   * Configure replay mode fallback behavior
   * @param {string} behavior Fallback behavior (error, passthrough, template)
   * @param {Object} options Behavior-specific options
   */
  configureReplayFallback(behavior, options = {}) {
    const replayMode = this.modes.replay;
    replayMode.setFallbackBehavior(behavior, options);

    logger.info("Replay fallback configured", { behavior, options });
  }

  /**
   * Test if request has a match (for replay mode)
   * @param {Object} requestContext RequestContext instance
   * @returns {Promise<boolean>} True if has match
   */
  async testMatch(requestContext) {
    try {
      const requestData = {
        user_id: requestContext.getHeader("x-user-id") || null,
        method: requestContext.getMethod(),
        path: requestContext.getPath(),
        app_version: requestContext.getHeader("x-app-version") || null,
        app_language: requestContext.getHeader("x-app-language") || null,
        app_platform: requestContext.getHeader("x-app-platform") || null,
        app_environment: requestContext.getHeader("x-app-environment") || null,
      };

      return await this.matchingService.hasMatch(requestData);
    } catch (error) {
      logger.error("Failed to test match", { error: error.message });
      throw error;
    }
  }

  /**
   * Get all matching requests for a request
   * @param {Object} requestContext RequestContext instance
   * @param {number} limit Maximum number of matches
   * @returns {Promise<Array>} List of matching requests
   */
  async getAllMatches(requestContext, limit = 10) {
    try {
      const requestData = {
        user_id: requestContext.getHeader("x-user-id") || null,
        method: requestContext.getMethod(),
        path: requestContext.getPath(),
        app_version: requestContext.getHeader("x-app-version") || null,
        app_language: requestContext.getHeader("x-app-language") || null,
        app_platform: requestContext.getHeader("x-app-platform") || null,
        app_environment: requestContext.getHeader("x-app-environment") || null,
      };

      return await this.matchingService.findAllMatches(requestData, limit);
    } catch (error) {
      logger.error("Failed to get all matches", { error: error.message });
      throw error;
    }
  }

  /**
   * Get mode statistics
   * @param {string} mode Mode name (optional, defaults to current mode)
   * @returns {Object} Mode statistics
   */
  getStats(mode = null) {
    const modeName = mode || this.currentMode;

    if (!this.stats[modeName]) {
      throw new Error(`Invalid mode: ${modeName}`);
    }

    return {
      mode: modeName,
      ...this.stats[modeName],
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get all modes statistics
   * @returns {Object} Statistics for all modes
   */
  getAllStats() {
    return {
      currentMode: this.currentMode,
      modes: {
        passthrough: { ...this.stats.passthrough },
        recording: { ...this.stats.recording },
        replay: { ...this.stats.replay },
      },
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get mode information
   * @returns {Object} Information about all modes
   */
  getModesInfo() {
    return {
      currentMode: this.currentMode,
      availableModes: Object.keys(this.modes),
      modes: {
        passthrough: {
          name: "passthrough",
          description: "Forward all requests without recording",
          features: ["Zero overhead", "Direct forwarding", "No database writes"],
        },
        recording: {
          name: "recording",
          description: "Forward requests and record to database",
          features: ["Request recording", "Response recording", "Dimension capture"],
        },
        replay: {
          name: "replay",
          description: "Return recorded responses without forwarding",
          features: ["Match scoring", "Fallback behaviors", "Offline mode"],
        },
      },
    };
  }

  /**
   * Update statistics
   * @param {string} mode Mode name
   * @param {string} type Result type (success, error)
   * @param {Object} result Request result
   * @param {number} elapsed Elapsed time in ms
   * @private
   */
  _updateStats(mode, type, result = null, elapsed = 0) {
    if (!this.stats[mode]) return;

    this.stats[mode].requests++;

    if (type === "error") {
      this.stats[mode].errors++;
    } else if (type === "success") {
      // Mode-specific statistics
      if (mode === "recording" && result) {
        this.stats[mode].recorded++;
      } else if (mode === "replay" && result) {
        if (result.source === "database" || result.source === "dproxy") {
          this.stats[mode].hits++;
        } else {
          this.stats[mode].misses++;
        }
      }
    }
  }

  /**
   * Get initial statistics object for a mode
   * @param {string} mode Mode name
   * @returns {Object} Initial statistics
   * @private
   */
  _getInitialStats(mode) {
    const baseStats = { requests: 0, errors: 0 };

    if (mode === "recording") {
      return { ...baseStats, recorded: 0 };
    } else if (mode === "replay") {
      return { ...baseStats, hits: 0, misses: 0 };
    }

    return baseStats;
  }

  /**
   * Get service health status
   * @returns {Promise<Object>} Health status
   */
  async getHealthStatus() {
    try {
      // Test database connection
      await this.db.get("SELECT 1");

      // Get basic statistics
      const stats = this.getAllStats();
      const requestCount = await this.requestService.getServiceStats();
      const responseCount = await this.responseService.getServiceStats();

      return {
        status: "healthy",
        mode: this.currentMode,
        database: "connected",
        stats,
        records: {
          requests: requestCount.totalRequests,
          responses: responseCount.totalResponses,
        },
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      logger.error("Health check failed", { error: error.message });
      return {
        status: "unhealthy",
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }
}

module.exports = ModeService;
