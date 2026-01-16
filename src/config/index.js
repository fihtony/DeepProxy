/**
 * Application Configuration
 *
 * Centralized configuration management with environment variable support.
 * All sensitive values should be loaded from environment variables.
 */

require("dotenv").config();

const config = {
  // Server configuration
  server: {
    port: parseInt(process.env.PORT || "8080", 10),
    httpsPort: parseInt(process.env.HTTPS_PORT || "8443", 10),
    host: process.env.HOST || "0.0.0.0",
    nodeEnv: process.env.NODE_ENV || "development",
    enableHttps: process.env.ENABLE_HTTPS === "true",
    sslCertPath: process.env.SSL_CERT_PATH || "./certs/server.crt",
    sslKeyPath: process.env.SSL_KEY_PATH || "./certs/server.key",
  },

  // Proxy configuration
  proxy: {
    defaultMode: process.env.DEFAULT_MODE || "paththrough", // Options: passthrough, recording, replay
    targetBaseUrl: process.env.TARGET_BASE_URL || "http://api.example.com",
    requestTimeoutMs: parseInt(process.env.REQUEST_TIMEOUT_MS || "30000", 10),
  },

  // Database configuration
  database: {
    path: process.env.DB_PATH || "./data/dproxy.db",
    backupPath: process.env.DB_BACKUP_PATH || "./data/backups",
    logging: process.env.DB_LOGGING === "true",
    poolSize: parseInt(process.env.DB_POOL_SIZE || "10", 10),
  },

  // Security configuration
  security: {
    adminApiKey: process.env.ADMIN_API_KEY || "dev-api-key-change-in-production",
    encryptionKey: process.env.ENCRYPTION_KEY || "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    jwtSecret: process.env.JWT_SECRET || "dev-jwt-secret-change-in-production",
    sessionCookieName: process.env.SESSION_COOKIE_NAME || "UserSession",
    sessionExpirySeconds: parseInt(process.env.SESSION_EXPIRY_SECONDS || "86400", 10),
  },

  // Data retention configuration
  retention: {
    publicVersionRetention: parseInt(process.env.PUBLIC_VERSION_RETENTION || "5", 10),
    secureUserRetention: parseInt(process.env.SECURE_USER_RETENTION || "3", 10),
    autoCleanupEnabled: process.env.AUTO_CLEANUP_ENABLED !== "false",
    cleanupSchedule: process.env.CLEANUP_SCHEDULE || "0 2 * * *",
    deleteRecordsOlderThanDays: parseInt(process.env.DELETE_RECORDS_OLDER_THAN_DAYS || "90", 10),
  },

  // Logging configuration
  logging: {
    level: process.env.LOG_LEVEL || "info",
    file: process.env.LOG_FILE || "./logs/dproxy.log",
    maxSize: process.env.LOG_MAX_SIZE || "20m",
    maxFiles: process.env.LOG_MAX_FILES || "14d",
    console: process.env.LOG_CONSOLE !== "false",
    format: process.env.LOG_FORMAT || "detailed",
  },

  // Traffic logging configuration (for dproxy-requests log file)
  trafficLog: {
    enabled: process.env.TRAFFIC_LOG_ENABLED !== "false", // Master flag - if false, no traffic logging
    headerLog: process.env.TRAFFIC_LOG_HEADER !== "false", // Log request/response headers (default: enabled)
    bodyLog: process.env.TRAFFIC_LOG_BODY !== "false", // Log request/response body (default: enabled)
  },

  // Rate limiting configuration
  rateLimit: {
    enabled: process.env.RATE_LIMIT_ENABLED !== "false",
    proxy: {
      max: parseInt(process.env.RATE_LIMIT_PROXY_MAX || "1000", 10),
      windowMinutes: parseInt(process.env.RATE_LIMIT_PROXY_WINDOW_MINUTES || "1", 10),
    },
    admin: {
      max: parseInt(process.env.RATE_LIMIT_ADMIN_MAX || "60", 10),
      windowMinutes: parseInt(process.env.RATE_LIMIT_ADMIN_WINDOW_MINUTES || "1", 10),
    },
  },

  // CORS configuration
  cors: {
    origins: (process.env.CORS_ORIGINS || "http://localhost:3000,http://localhost:8080").split(","),
    credentials: process.env.CORS_CREDENTIALS !== "false",
  },

  // Processors configuration
  processors: {
    enablePostProcessors: process.env.ENABLE_POST_PROCESSORS !== "false",
    enablePreProcessors: process.env.ENABLE_PRE_PROCESSORS !== "false",
    timeoutMs: parseInt(process.env.PROCESSOR_TIMEOUT_MS || "5000", 10),
  },

  // Statistics configuration
  statistics: {
    enabled: process.env.ENABLE_STATS !== "false",
    intervalMinutes: parseInt(process.env.STATS_INTERVAL_MINUTES || "60", 10),
  },

  // Web UI configuration
  webUI: {
    port: parseInt(process.env.WEB_UI_PORT || "3000", 10),
    apiBaseUrl: process.env.WEB_UI_API_BASE_URL || "http://localhost:8080",
  },

  // Performance configuration
  performance: {
    enableCompression: process.env.ENABLE_COMPRESSION !== "false",
    maxRequestBodySize: process.env.MAX_REQUEST_BODY_SIZE || "10mb",
    enableMemoryCache: process.env.ENABLE_MEMORY_CACHE === "true",
    memoryCacheTTL: parseInt(process.env.MEMORY_CACHE_TTL || "60", 10),
  },

  // Development configuration
  development: {
    debug: process.env.DEBUG === "true",
    prettyJson: process.env.PRETTY_JSON !== "false",
    mockMode: process.env.MOCK_MODE === "true",
  },
};

// Validate critical configuration
function validateConfig() {
  const errors = [];

  // Validate mode
  if (!["passthrough", "recording", "replay"].includes(config.proxy.defaultMode)) {
    errors.push(`Invalid DEFAULT_MODE: ${config.proxy.defaultMode}. Must be 'passthrough', 'recording', or 'replay'`);
  }

  // Validate retention values
  if (config.retention.publicVersionRetention < 1) {
    errors.push("PUBLIC_VERSION_RETENTION must be at least 1");
  }

  if (config.retention.secureUserRetention < 1) {
    errors.push("SECURE_USER_RETENTION must be at least 1");
  }

  // Warn about default keys in production
  if (config.server.nodeEnv === "production") {
    if (config.security.adminApiKey.includes("dev-") || config.security.adminApiKey.includes("change-in-production")) {
      errors.push("ADMIN_API_KEY must be changed in production");
    }

    if (config.security.jwtSecret.includes("dev-") || config.security.jwtSecret.includes("change-in-production")) {
      errors.push("JWT_SECRET must be changed in production");
    }

    if (config.security.encryptionKey === "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef") {
      errors.push("ENCRYPTION_KEY must be changed in production");
    }
  }

  if (errors.length > 0) {
    throw new Error(`Configuration validation failed:\n${errors.join("\n")}`);
  }
}

// Validate on load
try {
  validateConfig();
} catch (error) {
  console.error("Configuration Error:", error.message);
  if (config.server.nodeEnv === "production") {
    process.exit(1);
  }
}

module.exports = config;
