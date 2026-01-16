/**
 * Winston Logger Configuration
 *
 * Provides structured logging with multiple transports:
 * - Console (development)
 * - File with rotation (production)
 * - Correlation ID tracking
 */

const winston = require("winston");
const DailyRotateFile = require("winston-daily-rotate-file");
const path = require("path");
const fs = require("fs");
const config = require("../config");

// Ensure logs directory exists
const logDir = path.dirname(config.logging.file);
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// Custom format for detailed logs
const detailedFormat = winston.format.combine(
  winston.format.timestamp({
    format: () => {
      // Use local time with HH:mm:ss format
      const now = new Date();
      return now
        .toLocaleString("en-US", {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        })
        .replace(/\//g, "-")
        .replace(" ", " ");
    },
  }),
  winston.format.errors({ stack: true }),
  winston.format.metadata({ fillExcept: ["message", "level", "timestamp", "label"] }),
  winston.format.printf(({ timestamp, level, message, metadata, stack }) => {
    let log = `${timestamp} [${level.toUpperCase()}]: ${message}`;

    // Add correlation ID if present
    if (metadata.correlationId) {
      log += ` [CorrelationID: ${metadata.correlationId}]`;
    }

    // Add additional metadata
    if (Object.keys(metadata).length > 0) {
      log += ` ${JSON.stringify(metadata)}`;
    }

    // Add stack trace for errors
    if (stack) {
      log += `\n${stack}`;
    }

    return log;
  })
);

// Simple format for console
const simpleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({
    format: () => {
      // Use local time with HH:mm:ss format
      const now = new Date();
      return now.toLocaleString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      });
    },
  }),
  winston.format.printf(({ timestamp, level, message }) => {
    return `${timestamp} ${level}: ${message}`;
  })
);

// JSON format for production
const jsonFormat = winston.format.combine(winston.format.timestamp(), winston.format.errors({ stack: true }), winston.format.json());

// Choose format based on configuration
let logFormat;
if (config.logging.format === "json") {
  logFormat = jsonFormat;
} else if (config.logging.format === "simple") {
  logFormat = simpleFormat;
} else {
  logFormat = detailedFormat;
}

// Create transports array
const transports = [];

// Console transport (for development) - INFO level only for concise output
if (config.logging.console) {
  transports.push(
    new winston.transports.Console({
      level: "info", // Only show INFO and above in console
      format: config.server.nodeEnv === "production" ? jsonFormat : simpleFormat,
    })
  );
}

// File transport with daily rotation (concise traffic log)
transports.push(
  new DailyRotateFile({
    filename: path.join(logDir, "dproxy-%DATE%.log"),
    datePattern: "YYYY-MM-DD",
    maxSize: config.logging.maxSize,
    maxFiles: config.logging.maxFiles,
    format: logFormat,
  })
);

// Error file transport (errors only)
transports.push(
  new DailyRotateFile({
    filename: path.join(logDir, "dproxy-error-%DATE%.log"),
    datePattern: "YYYY-MM-DD",
    maxSize: config.logging.maxSize,
    maxFiles: config.logging.maxFiles,
    level: "error",
    format: logFormat,
  })
);

// Detailed requests log (for passthrough and recording modes)
// This will be used by a separate logger instance
const requestsLogTransport = new DailyRotateFile({
  filename: path.join(logDir, "dproxy-requests-%DATE%.log"),
  datePattern: "YYYY-MM-DD",
  maxSize: config.logging.maxSize,
  maxFiles: config.logging.maxFiles,
  format: detailedFormat,
});

// Create logger instance
const logger = winston.createLogger({
  level: config.logging.level,
  transports,
  exceptionHandlers: [
    new winston.transports.File({
      filename: path.join(logDir, "exceptions.log"),
      format: logFormat,
    }),
  ],
  rejectionHandlers: [
    new winston.transports.File({
      filename: path.join(logDir, "rejections.log"),
      format: logFormat,
    }),
  ],
  exitOnError: false,
});

// Add child logger method for correlation ID
logger.withCorrelation = function (correlationId) {
  return this.child({ correlationId });
};

// Add helper methods
logger.logRequest = function (req, message = "Incoming request") {
  this.info(message, {
    method: req.method,
    url: req.url,
    ip: req.ip,
    userAgent: req.get("user-agent"),
    correlationId: req.headers["x-correlation-id"],
  });
};

logger.logResponse = function (req, res, duration) {
  this.info("Response sent", {
    method: req.method,
    url: req.url,
    status: res.statusCode,
    duration: `${duration}ms`,
    correlationId: req.headers["x-correlation-id"],
  });
};

logger.logError = function (error, req = null) {
  const errorLog = {
    error: {
      message: error.message,
      stack: error.stack,
      code: error.code,
    },
  };

  if (req) {
    errorLog.request = {
      method: req.method,
      url: req.url,
      ip: req.ip,
      correlationId: req.headers["x-correlation-id"],
    };
  }

  this.error("Error occurred", errorLog);
};

// Create a separate logger for detailed request/response logging
// Used in passthrough and recording modes only
const requestLogger = winston.createLogger({
  level: "info",
  transports: [requestsLogTransport],
  exitOnError: false,
});

// Helper to log detailed request/response information
requestLogger.logRequestResponse = function (mode, requestData, responseData) {
  // Only log in passthrough and recording modes
  if (mode === "replay") {
    return;
  }

  const logEntry = {
    mode,
    timestamp: new Date().toISOString(),
    request: {
      method: requestData.method,
      url: requestData.url || requestData.path,
      path: requestData.path,
      query: requestData.query,
      headers: requestData.headers,
      body: requestData.body,
      userId: requestData.userId,
      appVersion: requestData.appVersion,
      appLanguage: requestData.appLanguage,
      appPlatform: requestData.appPlatform,
      appEnvironment: requestData.appEnvironment,
    },
    response: {
      status: responseData.status,
      statusText: responseData.statusText,
      headers: responseData.headers,
      body: responseData.body,
      source: responseData.source,
      latency: responseData.latency,
    },
  };

  this.info("Request/Response", logEntry);
};

module.exports = logger;
module.exports.requestLogger = requestLogger;
