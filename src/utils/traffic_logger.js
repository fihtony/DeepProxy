/**
 * Traffic Logger
 *
 * Logs all HTTP traffic (incoming/outgoing) to dproxy-requests-<date>.log
 * with detailed information for monitored app and simplified logs for others.
 *
 * Features:
 * - Automatic daily file rotation
 * - Detailed logging for monitored app traffic
 * - Simplified logging for non-monitored traffic
 * - Auto-recovery if log file is deleted during runtime
 */

const fs = require("fs");
const path = require("path");
const logger = require("./logger");
const config = require("../config");

const logDir = path.join(__dirname, "../../logs");

/**
 * Check if request is from monitored application and domain
 * Requires BOTH:
 * 1. User-Agent matches configured monitor pattern
 * 2. Request comes from a monitored domain
 * @param {Object} req - Request object with headers, url, originalUrl
 * @returns {boolean} True if request is from monitored app AND domain
 */
function isMonitoredApp(req) {
  const userAgent = req.headers["user-agent"] || "";

  // Try to extract host from multiple sources:
  // 1. headers.host (HTTP/1.1 standard)
  // 2. headers[":authority"] (HTTP/2)
  // 3. Extract from originalUrl/url (HTTP proxy protocol with full URL)
  let host = req.headers.host || req.headers[":authority"];

  if (!host) {
    // Prefer originalUrl over url for full URL extraction
    const url = req.originalUrl || req.url || "";
    if (url && (url.startsWith("http://") || url.startsWith("https://"))) {
      try {
        const urlObj = new URL(url);
        host = urlObj.hostname;
      } catch (e) {
        // URL parsing failed, host remains undefined
      }
    }
  }

  // Default to unknown if still no host
  if (!host) {
    host = "unknown";
  }

  try {
    const { getInstance } = require("../config/TrafficConfigManager");
    const configManager = getInstance();

    if (!configManager || !configManager.isInitialized()) {
      return false;
    }

    // Check 1: User-Agent must match monitor pattern
    const trafficConfig = configManager.getTrafficConfig();
    const pattern = trafficConfig?.monitor?.pattern;
    if (!pattern) return false;

    const regex = new RegExp(pattern);
    if (!regex.test(userAgent)) {
      return false;
    }

    // Check 2: Domain must be in monitored domains list
    const isMonitoredDomain = configManager.isMonitoredDomain(host);
    return isMonitoredDomain;
  } catch (e) {
    // Fallback: return false if config check fails
    return false;
  }
}

// Cached traffic logging config from database
let cachedTrafficLogConfig = null;

/**
 * Get traffic logging config from database with fallback to .env config
 * @returns {Object} Traffic logging config
 */
async function getTrafficLogConfig() {
  // Return cached config if available
  if (cachedTrafficLogConfig) {
    return cachedTrafficLogConfig;
  }

  try {
    const configRepository = require("../database/repositories/config_repository");
    const dbConfig = await configRepository.getTrafficLoggingConfig();

    if (dbConfig) {
      cachedTrafficLogConfig = {
        enabled: dbConfig.overall !== false,
        headerLog: dbConfig.header !== false,
        bodyLog: dbConfig.body !== false,
      };
      return cachedTrafficLogConfig;
    }
  } catch (error) {
    logger.error("Failed to load traffic logging config from database, using .env fallback", {
      error: error.message,
    });
  }

  // Fall back to .env config
  return {
    enabled: config.trafficLog?.enabled !== false,
    headerLog: config.trafficLog?.headerLog !== false,
    bodyLog: config.trafficLog?.bodyLog !== false,
  };
}

/**
 * Get traffic logging config synchronously (uses cached value or .env fallback)
 * @returns {Object} Traffic logging config
 */
function getTrafficLogConfigSync() {
  // Use cached config if available
  if (cachedTrafficLogConfig) {
    return cachedTrafficLogConfig;
  }

  // Fall back to .env config
  return {
    enabled: config.trafficLog?.enabled !== false,
    headerLog: config.trafficLog?.headerLog !== false,
    bodyLog: config.trafficLog?.bodyLog !== false,
  };
}

/**
 * Clear cached traffic logging config (call after updating database)
 */
function clearTrafficLogConfigCache() {
  cachedTrafficLogConfig = null;
}

// Ensure logs directory exists
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// Request ID persistence file path
const requestIdFilePath = path.join(logDir, ".request_id_state.json");

// Request ID generator - persisted counter that resets daily
let requestIdCounter = 0;
let lastResetDate = "";

/**
 * Load request ID state from file
 * Called once at startup to restore counter
 */
function loadRequestIdState() {
  try {
    if (fs.existsSync(requestIdFilePath)) {
      const data = fs.readFileSync(requestIdFilePath, "utf-8");
      const state = JSON.parse(data);

      // Get today's date in local time (YYYY-MM-DD format)
      const today = getLocalDateString();

      if (state.date === today) {
        // Same day, restore counter
        requestIdCounter = state.counter || 0;
        lastResetDate = state.date;
        logger.info("[TrafficLogger] Restored request ID state", {
          counter: requestIdCounter,
          date: lastResetDate,
        });
      } else {
        // New day, reset counter
        requestIdCounter = 0;
        lastResetDate = today;
        saveRequestIdState();
        logger.info("[TrafficLogger] New day detected, reset request ID counter", {
          previousDate: state.date,
          newDate: today,
        });
      }
    } else {
      // First run, initialize
      lastResetDate = getLocalDateString();
      requestIdCounter = 0;
      saveRequestIdState();
      logger.info("[TrafficLogger] Initialized request ID state", {
        date: lastResetDate,
      });
    }
  } catch (error) {
    logger.error("[TrafficLogger] Failed to load request ID state, starting fresh", {
      error: error.message,
    });
    lastResetDate = getLocalDateString();
    requestIdCounter = 0;
  }
}

/**
 * Save request ID state to file
 */
function saveRequestIdState() {
  try {
    const state = {
      counter: requestIdCounter,
      date: lastResetDate,
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(requestIdFilePath, JSON.stringify(state, null, 2), "utf-8");
  } catch (error) {
    logger.error("[TrafficLogger] Failed to save request ID state", {
      error: error.message,
    });
  }
}

/**
 * Get local date string in YYYY-MM-DD format
 * @returns {string} Date string
 */
function getLocalDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Initialize request ID state at module load
loadRequestIdState();

/**
 * Generate a unique request ID for grouping logs
 * Counter persists across restarts and resets daily
 * @returns {number} Request ID
 */
function generateRequestId() {
  const today = getLocalDateString();
  if (today !== lastResetDate) {
    requestIdCounter = 0;
    lastResetDate = today;
    logger.info("[TrafficLogger] Day changed, reset request ID counter", {
      newDate: today,
    });
  }
  requestIdCounter++;

  // Save state every 10 requests to balance performance and durability
  if (requestIdCounter % 10 === 0) {
    saveRequestIdState();
  }

  return requestIdCounter;
}

/**
 * Get today's log filename
 * @returns {string} Filename in format: dproxy-requests-YYYY-MM-DD.log
 */
function getLogFilename() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `dproxy-requests-${year}-${month}-${day}.log`;
}

/**
 * Get full log file path
 * @returns {string} Absolute path to log file
 */
function getLogFilePath() {
  return path.join(logDir, getLogFilename());
}

/**
 * Ensure log file exists
 */
function ensureLogFileExists() {
  const logPath = getLogFilePath();
  if (!fs.existsSync(logPath)) {
    fs.writeFileSync(logPath, "", { encoding: "utf-8" });
  }
}

/**
 * Write to log file with auto-recovery
 * Only logs if traffic logging is enabled and in passthrough or recording mode
 * @param {string} content - Content to write
 * @param {string} mode - Current proxy mode (passthrough/recording/replay)
 */
function writeToLog(content, mode = "unknown") {
  // Master flag check - if traffic logging is disabled, don't log anything
  const trafficLogConfig = getTrafficLogConfigSync();
  if (!trafficLogConfig.enabled) {
    return;
  }

  // Only generate logs in passthrough and recording modes
  if (mode === "replay") {
    return;
  }

  try {
    ensureLogFileExists();
    const logPath = getLogFilePath();
    fs.appendFileSync(logPath, content + "\n", { encoding: "utf-8" });
  } catch (error) {
    console.error("Error writing to traffic log:", error.message);
  }
}

/**
 * Get mode indicator for logs
 * @param {string} mode - Current proxy mode
 * @returns {string} Mode indicator (PT, RC, RP)
 */
function getModeIndicator(mode) {
  switch (mode) {
    case "passthrough":
      return "[PT]";
    case "recording":
      return "[RC]";
    case "replay":
      return "[RP]";
    default:
      return "[?]";
  }
}

/**
 * Format timestamp in local time
 * @returns {string} Formatted timestamp
 */
function getFormattedTime() {
  const now = new Date();
  return now.toLocaleString("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

/**
 * Parse JSON safely
 * @param {string|object|Buffer} data - Data to parse
 * @returns {string} JSON string or error message
 */
function safeJSON(data) {
  if (!data) return "N/A";

  // Handle Buffer - convert to string first, then try to parse as JSON
  if (Buffer.isBuffer(data)) {
    const str = data.toString("utf8");
    try {
      return JSON.stringify(JSON.parse(str), null, 2);
    } catch {
      return str;
    }
  }

  if (typeof data === "string") {
    try {
      return JSON.stringify(JSON.parse(data), null, 2);
    } catch {
      return data;
    }
  }
  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return String(data);
  }
}

/**
 * Log incoming client request
 * @param {Object} req - Express request object or request-like object
 * @param {string} clientIP - Client IP address
 * @param {string} mode - Current proxy mode (passthrough/recording/replay)
 * @param {number} requestId - Request ID for grouping logs (optional, will be generated if not provided)
 * @returns {number} Request ID used for this request
 */
function logIncomingRequest(req, clientIP = "UNKNOWN", mode = "unknown", requestId = null) {
  // Master flag check - if traffic logging is disabled, don't log anything
  const trafficLogConfig = getTrafficLogConfigSync();
  if (!trafficLogConfig.enabled) {
    return requestId || generateRequestId();
  }

  const isMonitored = isMonitoredApp(req);
  const timestamp = getFormattedTime();
  const modeIndicator = getModeIndicator(mode);
  const id = requestId || generateRequestId();

  if (isMonitored) {
    // Detailed logging for monitored app traffic
    const headerLogEnabled = trafficLogConfig.headerLog;
    const bodyLogEnabled = trafficLogConfig.bodyLog;

    // Build headers section
    let headersSection = "";
    if (headerLogEnabled) {
      const headers = JSON.stringify(req.headers, null, 2);
      headersSection = `\n\nHeaders:\n${headers}`;
    }

    // Build body section
    let bodySection = "";
    if (bodyLogEnabled) {
      let body = "N/A";

      // Log body availability for debugging (body capture status)
      if (req.path) {
        logger.debug("[TRAFFIC_LOG] Request body capture status", {
          hasBody: !!req.body,
          bodyType: typeof req.body,
          bodyKeys: req.body ? Object.keys(req.body) : [],
          rawBodySize: req.rawBody ? req.rawBody.length : 0,
        });
      }

      if (req.body) {
        body = safeJSON(req.body);
      }
      bodySection = `\n\nBody:\n${body}`;
    }

    const log = `
=== INCOMING CLIENT REQUEST (${id}) ===
[${timestamp}] ${modeIndicator} Direction: ${clientIP} -> PROXY
HTTP Method: ${req.method}
Request URL: ${req.originalUrl || req.url}
User-Agent: ${req.headers["user-agent"] || "N/A"}${headersSection}${bodySection}
===============================`;

    writeToLog(log, mode);
  } else {
    // Simplified logging for non-monitored traffic
    const log = `[${timestamp}] ${modeIndicator} INCOMING (${id}): ${clientIP} -> PROXY | ${req.method} ${req.originalUrl || req.url}`;
    writeToLog(log, mode);
  }

  return id;
}

/**
 * Log forwarded proxy request to backend
 * @param {Object} req - Express request object or request-like object
 * @param {string} backendURL - Backend server URL
 * @param {string} mode - Current proxy mode (passthrough/recording/replay)
 * @param {Object} forwardedHeaders - Headers that will be forwarded to backend (optional)
 * @param {number} requestId - Request ID for grouping logs
 */
function logForwardedRequest(req, backendURL, mode = "unknown", forwardedHeaders = null, requestId = null) {
  // Master flag check - if traffic logging is disabled, don't log anything
  const trafficLogConfig = getTrafficLogConfigSync();
  if (!trafficLogConfig.enabled) {
    return;
  }

  const isMonitored = isMonitoredApp(req);
  const timestamp = getFormattedTime();
  const modeIndicator = getModeIndicator(mode);
  const id = requestId || generateRequestId();

  if (isMonitored) {
    // Detailed logging for monitored app traffic
    const headerLogEnabled = trafficLogConfig.headerLog;
    const bodyLogEnabled = trafficLogConfig.bodyLog;

    // Use forwarded headers if provided, otherwise use original request headers
    const headersToLog = forwardedHeaders || req.headers;

    // Build headers section
    let headersSection = "";
    if (headerLogEnabled) {
      const headers = JSON.stringify(headersToLog, null, 2);
      headersSection = `\n\nHeaders:\n${headers}`;
    }

    // Build body section
    let bodySection = "";
    if (bodyLogEnabled) {
      let body = "N/A";
      // For transmit endpoints, prefer rawBody to show exact bytes being forwarded
      if (req.rawBody && req.rawBody.length > 0) {
        try {
          // Try to parse rawBody as JSON for display
          body = JSON.stringify(JSON.parse(req.rawBody.toString("utf8")), null, 2);
        } catch (e) {
          // If not JSON, show as string
          body = req.rawBody.toString("utf8");
        }
      } else if (req.body) {
        body = safeJSON(req.body);
      }
      bodySection = `\n\nBody:\n${body}`;
    }

    const log = `
=== FORWARDED REQUEST TO BACKEND (${id}) ===
[${timestamp}] ${modeIndicator} Direction: PROXY -> ${new URL(backendURL).hostname}
HTTP Method: ${req.method}
Request URL: ${backendURL}
User-Agent: ${req.headers["user-agent"] || "N/A"}
RawBody: ${req.rawBody ? req.rawBody.length + " bytes" : "none"}${headersSection}${bodySection}
=====================================`;

    writeToLog(log, mode);
  } else {
    // Simplified logging for non-monitored traffic
    const log = `[${timestamp}] ${modeIndicator} FORWARD (${id}): PROXY -> ${new URL(backendURL).hostname} | ${req.method} ${backendURL}`;
    writeToLog(log, mode);
  }
}

/**
 * Log response from backend server
 * @param {Object} req - Express request object or request-like object
 * @param {number} statusCode - HTTP status code
 * @param {Object} responseHeaders - Response headers
 * @param {Object} responseBody - Response body
 * @param {number} duration - Response time in milliseconds
 * @param {string} backendURL - Backend server URL
 * @param {string} mode - Current proxy mode (passthrough/recording/replay)
 * @param {number} requestId - Request ID for grouping logs
 */
function logBackendResponse(req, statusCode, responseHeaders, responseBody, duration, backendURL, mode = "unknown", requestId = null) {
  // Master flag check - if traffic logging is disabled, don't log anything
  const trafficLogConfig = getTrafficLogConfigSync();
  if (!trafficLogConfig.enabled) {
    return;
  }

  const isMonitored = isMonitoredApp(req);
  const timestamp = getFormattedTime();
  const modeIndicator = getModeIndicator(mode);
  const id = requestId || generateRequestId();

  if (isMonitored) {
    // Detailed logging for monitored app traffic
    const headerLogEnabled = trafficLogConfig.headerLog;
    const bodyLogEnabled = trafficLogConfig.bodyLog;

    // Build headers section
    let headersSection = "";
    if (headerLogEnabled) {
      const headers = JSON.stringify(responseHeaders || {}, null, 2);
      headersSection = `\n\nHeaders:\n${headers}`;
    }

    // Build body section
    let bodySection = "";
    if (bodyLogEnabled) {
      const body = safeJSON(responseBody);
      bodySection = `\n\nBody:\n${body}`;
    }

    const log = `
=== RESPONSE FROM BACKEND (${id}) ===
[${timestamp}] ${modeIndicator} Direction: ${new URL(backendURL).hostname} -> PROXY
HTTP Status: ${statusCode}
Response URL: ${backendURL}
Total Response Time: ${duration}ms${headersSection}${bodySection}
=============================`;

    writeToLog(log, mode);
  } else {
    // Simplified logging for non-monitored traffic
    const log = `[${timestamp}] ${modeIndicator} RESPONSE (${id}): ${
      new URL(backendURL).hostname
    } -> PROXY | Status: ${statusCode} | Time: ${duration}ms`;
    writeToLog(log, mode);
  }
}

/**
 * Log response forwarded to client
 * @param {Object} req - Express request object or request-like object
 * @param {number} statusCode - HTTP status code
 * @param {Object} responseHeaders - Response headers
 * @param {Object} responseBody - Response body
 * @param {number} duration - Total request-response time in milliseconds
 * @param {string} clientIP - Client IP address
 * @param {string} mode - Current proxy mode (passthrough/recording/replay)
 * @param {number} requestId - Request ID for grouping logs
 */
function logClientResponse(
  req,
  statusCode,
  responseHeaders,
  responseBody,
  duration,
  clientIP = "UNKNOWN",
  mode = "unknown",
  requestId = null
) {
  // Master flag check - if traffic logging is disabled, don't log anything
  const trafficLogConfig = getTrafficLogConfigSync();
  if (!trafficLogConfig.enabled) {
    return;
  }

  const isMonitored = isMonitoredApp(req);
  const timestamp = getFormattedTime();
  const modeIndicator = getModeIndicator(mode);
  const id = requestId || generateRequestId();

  // Check for Set-Cookie headers in response (only if header logging is enabled)
  const headerLogEnabled = trafficLogConfig.headerLog;
  const setCookieHeader = responseHeaders["set-cookie"] || responseHeaders["Set-Cookie"];
  let dpsessionInfo = "";
  let existingCookiesInfo = "";

  if (headerLogEnabled && setCookieHeader) {
    const cookies = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];

    // Log all cookies found
    const cookieNames = cookies.map((c) => {
      const nameMatch = c.match(/([^=]+)=/);
      return nameMatch ? nameMatch[1] : "unknown";
    });

    if (cookies.length > 0) {
      existingCookiesInfo = `\n=== SET-COOKIE ARRAY (${cookies.length} total) ===`;
      cookies.forEach((cookie, index) => {
        existingCookiesInfo += `\n[${index + 1}] ${cookie.split(";")[0]} | Full: ${cookie}`;
      });
      existingCookiesInfo += `\n========================================`;
    }

    // Check for DPSESSION specifically
    for (const cookie of cookies) {
      if (cookie.includes("DPSESSION=")) {
        // Extract DPSESSION token
        const match = cookie.match(/DPSESSION=([^;]+)/);
        if (match) {
          dpsessionInfo = `\n\n=== DPSESSION COOKIE FOUND ===\nToken: ${match[1]}\nFull Cookie: ${cookie}\n================================`;
        }
        break;
      }
    }
  }

  if (isMonitored) {
    // Detailed logging for monitored app traffic
    const bodyLogEnabled = trafficLogConfig.bodyLog;

    // Build headers section
    let headersSection = "";
    if (headerLogEnabled) {
      const headers = JSON.stringify(responseHeaders || {}, null, 2);
      headersSection = `\n\nHeaders:\n${headers}`;
    }

    // Build body section
    let bodySection = "";
    if (bodyLogEnabled) {
      const body = safeJSON(responseBody);
      bodySection = `\n\nBody:\n${body}`;
    }

    const log = `
=== RESPONSE TO CLIENT (${id}) ===
[${timestamp}] ${modeIndicator} Direction: PROXY -> ${clientIP}
HTTP Status: ${statusCode}
Response URL: ${req.originalUrl || req.url}
Total Response Time: ${duration}ms${headersSection}${bodySection}
=========================${existingCookiesInfo}${dpsessionInfo}`;

    writeToLog(log, mode);
  } else {
    // Simplified logging for non-monitored traffic
    const statusFlag = dpsessionInfo ? " [HAS DPSESSION]" : "";
    const log = `[${timestamp}] ${modeIndicator} RESPONSE (${id}): PROXY -> ${clientIP} | Status: ${statusCode} | Time: ${duration}ms${statusFlag}${existingCookiesInfo}`;
    writeToLog(log, mode);
  }
}

/**
 * Log transaction completion (for unified view)
 * @param {Object} req - Express request object
 * @param {number} statusCode - HTTP status code
 * @param {number} totalDuration - Total request-response time in milliseconds
 * @param {string} clientIP - Client IP address
 * @param {string} mode - Current proxy mode (passthrough/recording/replay)
 */
function logTransactionComplete(req, statusCode, totalDuration, clientIP = "UNKNOWN", mode = "unknown") {
  const timestamp = getFormattedTime();
  const modeIndicator = getModeIndicator(mode);
  const log = `[${timestamp}] ${modeIndicator} TRANSACTION COMPLETE | ${clientIP} | ${req.method} ${
    req.originalUrl || req.url
  } | Status: ${statusCode} | Duration: ${totalDuration}ms`;
  writeToLog(log, mode);
}

/**
 * Initialize traffic logging config from database
 * Call this after database is initialized to load config from database
 */
async function initializeTrafficLogConfig() {
  try {
    const config = await getTrafficLogConfig();
    cachedTrafficLogConfig = config;
    logger.info("Traffic logging config loaded from database", config);
  } catch (error) {
    logger.warn("Failed to initialize traffic logging config from database, using .env fallback", {
      error: error.message,
    });
  }
}

module.exports = {
  logIncomingRequest,
  logForwardedRequest,
  logBackendResponse,
  logClientResponse,
  logTransactionComplete,
  getLogFilePath,
  ensureLogFileExists,
  generateRequestId,
  initializeTrafficLogConfig,
  getTrafficLogConfig,
  clearTrafficLogConfigCache,
};
