/**
 * settings.js
 *
 * API routes for settings configuration management
 * Manages traffic, mapping, and endpoint configurations
 */

const express = require("express");
const router = express.Router();
const logger = require("../../utils/logger");
const { getInstance } = require("../../config/TrafficConfigManager");

/**
 * Initialize routes
 */
function initializeRoutes() {
  // ============================================================================
  // Traffic Configuration Routes
  // ============================================================================

  /**
   * GET /api/settings/traffic
   * Get traffic monitoring configuration (monitor + domains)
   */
  router.get("/traffic", async (req, res) => {
    try {
      const configManager = getInstance();

      // Refresh from database before returning
      await configManager._loadTrafficConfig();

      const config = configManager.getTrafficConfig();

      res.json({
        success: true,
        data: config,
        monitoringEnabled: configManager.isMonitoringEnabled(),
      });
    } catch (error) {
      logger.error("Failed to get traffic config", { error: error.message });
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * PUT /api/settings/traffic
   * Update traffic monitoring configuration
   */
  router.put("/traffic", async (req, res) => {
    try {
      const { monitor, domains } = req.body;

      // Validate monitor config
      if (!monitor) {
        return res.status(400).json({
          success: false,
          error: "monitor configuration is required",
        });
      }

      if (!monitor.source || !["header", "query"].includes(monitor.source)) {
        return res.status(400).json({
          success: false,
          error: "monitor.source must be 'header' or 'query'",
        });
      }

      if (!monitor.key || monitor.key.trim() === "") {
        return res.status(400).json({
          success: false,
          error: "monitor.key is required and cannot be empty",
        });
      }

      if (!monitor.pattern || monitor.pattern.trim() === "") {
        return res.status(400).json({
          success: false,
          error: "monitor.pattern is required and cannot be empty",
        });
      }

      // Validate pattern
      try {
        new RegExp(monitor.pattern);
      } catch (e) {
        return res.status(400).json({
          success: false,
          error: `Invalid regex pattern: ${e.message}`,
        });
      }

      // Validate domains
      if (!Array.isArray(domains)) {
        return res.status(400).json({
          success: false,
          error: "domains must be an array",
        });
      }

      // Validate each domain pattern
      for (const domain of domains) {
        if (!domain.domain || domain.domain.trim() === "") {
          return res.status(400).json({
            success: false,
            error: "Each domain must have a non-empty 'domain' field",
          });
        }
        // Validate domain as regex pattern
        try {
          new RegExp(domain.domain);
        } catch (e) {
          return res.status(400).json({
            success: false,
            error: `Invalid domain pattern '${domain.domain}': ${e.message}`,
          });
        }
      }

      const config = { monitor, domains };
      const configManager = getInstance();
      await configManager.updateTrafficConfig(config);

      res.json({
        success: true,
        message: "Traffic configuration updated",
        data: config,
        monitoringEnabled: configManager.isMonitoringEnabled(),
      });
    } catch (error) {
      logger.error("Failed to update traffic config", { error: error.message });
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ============================================================================
  // Mapping Configuration Routes
  // ============================================================================

  /**
   * GET /api/settings/mapping
   * Get field mapping configuration
   */
  router.get("/mapping", async (req, res) => {
    try {
      const configManager = getInstance();

      // Refresh from database before returning
      await configManager._loadMappingConfig();

      const config = configManager.getMappingConfig();

      res.json({
        success: true,
        data: config,
      });
    } catch (error) {
      logger.error("Failed to get mapping config", { error: error.message });
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * PUT /api/settings/mapping
   * Update field mapping configuration
   */
  router.put("/mapping", async (req, res) => {
    try {
      const config = req.body;

      // Validate required fields
      const requiredFields = ["app_version", "app_platform", "app_environment", "app_language"];

      for (const field of requiredFields) {
        if (!config[field]) {
          return res.status(400).json({
            success: false,
            error: `Missing required field: ${field}`,
          });
        }

        const fieldConfig = config[field];
        if (!fieldConfig.source || !["header", "query"].includes(fieldConfig.source)) {
          return res.status(400).json({
            success: false,
            error: `${field}.source must be 'header' or 'query'`,
          });
        }

        if (!fieldConfig.key) {
          return res.status(400).json({
            success: false,
            error: `${field}.key is required`,
          });
        }

        // Validate pattern if provided
        if (fieldConfig.pattern) {
          try {
            new RegExp(fieldConfig.pattern);
          } catch (e) {
            return res.status(400).json({
              success: false,
              error: `Invalid regex pattern for ${field}: ${e.message}`,
            });
          }
        }
      }

      const configManager = getInstance();
      await configManager.updateMappingConfig(config);

      res.json({
        success: true,
        message: "Mapping configuration updated",
        data: config,
      });
    } catch (error) {
      logger.error("Failed to update mapping config", { error: error.message });
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ============================================================================
  // Endpoint Configuration Routes
  // ============================================================================

  /**
   * GET /api/settings/endpoint
   * Get endpoint type configuration (public/secure rules and tags)
   */
  router.get("/endpoint", async (req, res) => {
    try {
      const configManager = getInstance();

      // Refresh from database before returning
      await configManager._loadEndpointConfig();

      const config = configManager.getEndpointConfig();

      res.json({
        success: true,
        data: config,
      });
    } catch (error) {
      logger.error("Failed to get endpoint config", { error: error.message });
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * PUT /api/settings/endpoint
   * Update endpoint type configuration
   */
  router.put("/endpoint", async (req, res) => {
    try {
      const { types, tags, fallback } = req.body;

      // Validate types
      if (!Array.isArray(types)) {
        return res.status(400).json({
          success: false,
          error: "types must be an array",
        });
      }

      for (const type of types) {
        if (!type.name) {
          return res.status(400).json({
            success: false,
            error: "Each type must have a 'name' field",
          });
        }

        if (type.patterns && Array.isArray(type.patterns)) {
          for (const pattern of type.patterns) {
            try {
              new RegExp(pattern);
            } catch (e) {
              return res.status(400).json({
                success: false,
                error: `Invalid regex pattern in type '${type.name}': ${e.message}`,
              });
            }
          }
        }
      }

      // Validate tags if provided
      if (tags && Array.isArray(tags)) {
        for (const tag of tags) {
          if (!tag.name) {
            return res.status(400).json({
              success: false,
              error: "Each tag must have a 'name' field",
            });
          }

          if (tag.pattern) {
            try {
              new RegExp(tag.pattern);
            } catch (e) {
              return res.status(400).json({
                success: false,
                error: `Invalid regex pattern in tag '${tag.name}': ${e.message}`,
              });
            }
          }
        }
      }

      const config = {
        types,
        tags: tags || [],
        fallback: fallback || "public",
      };

      const configManager = getInstance();
      await configManager.updateEndpointConfig(config);

      res.json({
        success: true,
        message: "Endpoint configuration updated",
        data: config,
      });
    } catch (error) {
      logger.error("Failed to update endpoint config", { error: error.message });
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * POST /api/settings/endpoint/test
   * Test endpoint type classification for a given path
   */
  router.post("/endpoint/test", async (req, res) => {
    try {
      const { path } = req.body;

      if (!path) {
        return res.status(400).json({
          success: false,
          error: "path is required",
        });
      }

      const configManager = getInstance();
      const endpointType = configManager.getEndpointType(path);
      const tags = configManager.getEndpointTags(path);
      const isSecure = configManager.isSecureEndpoint(path);

      res.json({
        success: true,
        data: {
          path,
          endpointType,
          tags,
          isSecure,
        },
      });
    } catch (error) {
      logger.error("Failed to test endpoint classification", { error: error.message });
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ============================================================================
  // Proxy Configuration Routes
  // ============================================================================

  /**
   * GET /api/settings/proxy
   * Get proxy configuration (default matching settings for REPLAY/RECORDING modes)
   */
  router.get("/proxy", async (req, res) => {
    try {
      const configManager = getInstance();

      // Refresh from database before returning
      await configManager._loadProxyConfig();

      const config = configManager.getProxyConfig();

      res.json({
        success: true,
        data: config,
      });
    } catch (error) {
      logger.error("Failed to get proxy config", { error: error.message });
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * PUT /api/settings/proxy
   * Update proxy configuration (only replayDefaults can be updated)
   */
  router.put("/proxy", async (req, res) => {
    try {
      const config = req.body;

      // Validate replayDefaults if provided
      if (config.replayDefaults) {
        const rd = config.replayDefaults;

        // Validate match_version: 0 (closest) or 1 (exact)
        if (rd.match_version !== undefined && rd.match_version !== 0 && rd.match_version !== 1) {
          return res.status(400).json({
            success: false,
            error: "replayDefaults.match_version must be 0 (Closest) or 1 (Exact)",
          });
        }

        // Validate match_platform: 0 (any) or 1 (exact)
        if (rd.match_platform !== undefined && rd.match_platform !== 0 && rd.match_platform !== 1) {
          return res.status(400).json({
            success: false,
            error: "replayDefaults.match_platform must be 0 (Any) or 1 (Exact)",
          });
        }

        // Validate match_language: 0 (any) or 1 (exact)
        if (rd.match_language !== undefined && rd.match_language !== 0 && rd.match_language !== 1) {
          return res.status(400).json({
            success: false,
            error: "replayDefaults.match_language must be 0 (Any) or 1 (Exact)",
          });
        }

        // Validate match_environment
        const validEnvValues = ["exact", "sit", "stage", "dev", "prod"];
        if (rd.match_environment !== undefined && !validEnvValues.includes(rd.match_environment)) {
          return res.status(400).json({
            success: false,
            error: `replayDefaults.match_environment must be one of: ${validEnvValues.join(", ")}`,
          });
        }

        // Validate match_endpoint - must be array of regex strings
        if (rd.match_endpoint !== undefined) {
          if (!Array.isArray(rd.match_endpoint)) {
            return res.status(400).json({
              success: false,
              error: "replayDefaults.match_endpoint must be an array of regex pattern strings",
            });
          }
          // Validate each pattern
          for (let i = 0; i < rd.match_endpoint.length; i++) {
            const pattern = rd.match_endpoint[i];
            if (typeof pattern !== "string") {
              return res.status(400).json({
                success: false,
                error: `replayDefaults.match_endpoint[${i}] must be a string`,
              });
            }
            try {
              new RegExp(pattern, "i");
            } catch (err) {
              return res.status(400).json({
                success: false,
                error: `replayDefaults.match_endpoint[${i}] is not a valid regex pattern: ${err.message}`,
              });
            }
          }
        }
      }

      const configManager = getInstance();
      await configManager.updateProxyConfig(config);

      res.json({
        success: true,
        message: "Proxy configuration updated",
        data: configManager.getProxyConfig(),
      });
    } catch (error) {
      logger.error("Failed to update proxy config", { error: error.message });
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * GET /api/settings/proxy/ca-cert
   * Download the CA certificate for HTTPS interception
   */
  router.get("/proxy/ca-cert", (req, res) => {
    try {
      const fs = require("fs");
      const path = require("path");

      // CA cert is stored in data/certs/ca.cert.pem
      const certPath = path.join(__dirname, "../../../data/certs/ca.cert.pem");

      if (!fs.existsSync(certPath)) {
        return res.status(404).json({
          success: false,
          error: "CA certificate not found. Please ensure the proxy has been initialized.",
        });
      }

      const certContent = fs.readFileSync(certPath, "utf8");

      // Set headers for file download
      res.setHeader("Content-Type", "application/x-pem-file");
      res.setHeader("Content-Disposition", 'attachment; filename="dproxy-ca.crt"');
      res.send(certContent);
    } catch (error) {
      logger.error("Failed to download CA certificate", { error: error.message });
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * GET /api/settings/proxy/ca-cert/info
   * Get CA certificate information without downloading
   */
  router.get("/proxy/ca-cert/info", (req, res) => {
    try {
      const fs = require("fs");
      const path = require("path");
      const crypto = require("crypto");

      const certPath = path.join(__dirname, "../../../data/certs/ca.cert.pem");

      if (!fs.existsSync(certPath)) {
        return res.json({
          success: true,
          data: {
            exists: false,
            message: "CA certificate not found",
          },
        });
      }

      const stats = fs.statSync(certPath);
      const certContent = fs.readFileSync(certPath, "utf-8");

      // Compute SHA256 hash of the certificate file
      const sha256Hash = crypto.createHash("sha256").update(certContent).digest("hex");

      // Also compute SHA1 for verification purposes (commonly used)
      const sha1Hash = crypto.createHash("sha1").update(certContent).digest("hex");

      res.json({
        success: true,
        data: {
          exists: true,
          fileName: "dproxy-ca.crt",
          downloadUrl: "/api/settings/proxy/ca-cert",
          size: stats.size,
          modifiedAt: stats.mtime.toISOString(),
          sha256: sha256Hash,
          sha1: sha1Hash,
        },
      });
    } catch (error) {
      logger.error("Failed to get CA cert info", { error: error.message });
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ============================================================================
  // Session Configuration Routes
  // ============================================================================

  /**
   * GET /api/settings/session
   * Get session management configuration
   */
  router.get("/session", async (req, res) => {
    try {
      const { getInstance: getSessionConfigManager } = require("../../config/SessionConfigManager");
      const sessionConfigManager = getSessionConfigManager();

      // Refresh from database before returning
      await sessionConfigManager.loadConfig();

      const config = sessionConfigManager.getConfigSync();

      res.json({
        success: true,
        data: config,
        hasConfig: sessionConfigManager.hasConfig(),
      });
    } catch (error) {
      logger.error("Failed to get session config", { error: error.message });
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * PUT /api/settings/session
   * Update session management configuration
   */
  router.put("/session", async (req, res) => {
    try {
      const config = req.body;

      const { getInstance: getSessionConfigManager } = require("../../config/SessionConfigManager");
      const sessionConfigManager = getSessionConfigManager();

      // Validate configuration
      const validation = sessionConfigManager.validateConfig(config);
      if (!validation.valid) {
        return res.status(400).json({
          success: false,
          error: "Invalid session configuration",
          details: validation.errors,
        });
      }

      // Save configuration
      await sessionConfigManager.saveConfig(config);

      res.json({
        success: true,
        message: "Session configuration updated",
        data: config,
      });
    } catch (error) {
      logger.error("Failed to update session config", { error: error.message });
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * POST /api/settings/session/validate
   * Validate session configuration without saving
   */
  router.post("/session/validate", async (req, res) => {
    try {
      const config = req.body;

      const { getInstance: getSessionConfigManager } = require("../../config/SessionConfigManager");
      const sessionConfigManager = getSessionConfigManager();

      const validation = sessionConfigManager.validateConfig(config);

      res.json({
        success: true,
        valid: validation.valid,
        errors: validation.errors,
      });
    } catch (error) {
      logger.error("Failed to validate session config", { error: error.message });
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ============================================================================
  // General Routes
  // ============================================================================

  /**
   * GET /api/settings
   * Get all configuration settings
   */
  router.get("/", async (req, res) => {
    try {
      const configManager = getInstance();
      const { getInstance: getSessionConfigManager } = require("../../config/SessionConfigManager");
      const sessionConfigManager = getSessionConfigManager();

      // Refresh all from database
      await configManager.refreshAll();
      await sessionConfigManager.loadConfig();

      res.json({
        success: true,
        data: {
          traffic: configManager.getTrafficConfig(),
          mapping: configManager.getMappingConfig(),
          endpoint: configManager.getEndpointConfig(),
          session: sessionConfigManager.getConfigSync(),
          proxy: configManager.getProxyConfig(),
        },
        monitoringEnabled: configManager.isMonitoringEnabled(),
      });
    } catch (error) {
      logger.error("Failed to get all settings", { error: error.message });
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * POST /api/settings/refresh
   * Force refresh all configurations from database
   */
  router.post("/refresh", async (req, res) => {
    try {
      const configManager = getInstance();
      const { getInstance: getSessionConfigManager } = require("../../config/SessionConfigManager");
      const sessionConfigManager = getSessionConfigManager();

      await configManager.refreshAll();
      await sessionConfigManager.refresh();

      res.json({
        success: true,
        message: "All configurations refreshed from database",
        data: {
          traffic: configManager.getTrafficConfig(),
          mapping: configManager.getMappingConfig(),
          endpoint: configManager.getEndpointConfig(),
          session: sessionConfigManager.getConfigSync(),
          proxy: configManager.getProxyConfig(),
        },
        monitoringEnabled: configManager.isMonitoringEnabled(),
      });
    } catch (error) {
      logger.error("Failed to refresh settings", { error: error.message });
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ============================================================================
  // Export/Import Configuration Routes
  // ============================================================================

  /**
   * GET /api/settings/export
   * Export all configurations as a single JSON object for backup
   */
  router.get("/export", async (req, res) => {
    try {
      const configManager = getInstance();
      const { getInstance: getSessionConfigManager } = require("../../config/SessionConfigManager");
      const sessionConfigManager = getSessionConfigManager();
      const dbConnection = require("../../database/connection");
      const db = dbConnection.getDatabase();

      // Refresh to ensure we have latest data
      await configManager.refreshAll();
      await sessionConfigManager.refresh();

      // Get all endpoint rules directly from database
      const sql = `
        SELECT
          id,
          endpoint_pattern,
          http_method,
          regex,
          override,
          match_version,
          match_language,
          match_platform,
          match_environment,
          match_headers,
          match_query_params,
          match_body,
          match_response_status,
          priority,
          enabled,
          type,
          created_at,
          updated_at
        FROM endpoint_matching_config
        ORDER BY priority ASC, endpoint_pattern ASC
      `;
      const stmt = db.prepare(sql);
      const endpointRules = stmt.all();

      // Parse JSON fields in endpoint rules for proper export
      const parsedEndpointRules = endpointRules.map((rule) => {
        const parsed = { ...rule };
        // Parse JSON string fields to arrays/objects
        if (parsed.match_headers) {
          try {
            parsed.match_headers = JSON.parse(parsed.match_headers);
          } catch (e) {
            // Keep as string if parsing fails
          }
        }
        if (parsed.match_query_params) {
          try {
            parsed.match_query_params = JSON.parse(parsed.match_query_params);
          } catch (e) {
            // Keep as string if parsing fails
          }
        }
        if (parsed.match_body) {
          try {
            parsed.match_body = JSON.parse(parsed.match_body);
          } catch (e) {
            // Keep as string if parsing fails
          }
        }
        // Convert boolean fields from 0/1 to true/false
        parsed.regex = parsed.regex === 1;
        parsed.override = parsed.override === 1;
        parsed.match_version = parsed.match_version === 1;
        parsed.match_language = parsed.match_language === 1;
        parsed.match_platform = parsed.match_platform === 1;
        parsed.enabled = parsed.enabled === 1;
        return parsed;
      });

      const exportData = {
        version: "1.0",
        exportedAt: new Date().toISOString(),
        configs: {
          traffic: configManager.getTrafficConfig(),
          mapping: configManager.getMappingConfig(),
          endpoint: configManager.getEndpointConfig(),
          session: sessionConfigManager.getConfigSync(),
          proxy: configManager.getProxyConfig(),
          endpointRules: parsedEndpointRules,
        },
      };

      res.json({
        success: true,
        data: exportData,
      });
    } catch (error) {
      logger.error("Failed to export settings", { error: error.message });
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * POST /api/settings/import
   * Import configurations from backup, with conflict detection
   * Body: { configs: { traffic?, mapping?, endpoint?, session?, proxy? }, overwrite: boolean }
   */
  router.post("/import", async (req, res) => {
    try {
      const { configs, overwrite = false } = req.body;

      if (!configs || typeof configs !== "object") {
        return res.status(400).json({
          success: false,
          error: "configs object is required",
        });
      }

      const configManager = getInstance();
      const { getInstance: getSessionConfigManager } = require("../../config/SessionConfigManager");
      const sessionConfigManager = getSessionConfigManager();

      // Refresh to get current state
      await configManager.refreshAll();
      await sessionConfigManager.refresh();

      // Get current endpoint rules count for conflict detection
      const dbConnection = require("../../database/connection");
      const db = dbConnection.getDatabase();
      const countStmt = db.prepare("SELECT COUNT(*) as count FROM endpoint_matching_config");
      const countResult = countStmt.get();
      const currentEndpointRulesCount = countResult.count;

      // Detect conflicts (existing non-empty configs)
      const currentConfigs = {
        traffic: configManager.getTrafficConfig(),
        mapping: configManager.getMappingConfig(),
        endpoint: configManager.getEndpointConfig(),
        session: sessionConfigManager.getConfigSync(),
        proxy: configManager.getProxyConfig(),
        endpointRules: currentEndpointRulesCount,
      };

      const conflicts = {};
      const importResults = {};

      // Check each config type
      const configTypes = ["traffic", "mapping", "endpoint", "session", "proxy", "endpointRules"];

      for (const type of configTypes) {
        if (configs[type]) {
          let hasExisting = false;
          if (type === "endpointRules") {
            // For endpoint rules, check if count > 0
            hasExisting = currentEndpointRulesCount > 0;
          } else {
            // For other configs, check if object has keys
            hasExisting = currentConfigs[type] && Object.keys(currentConfigs[type]).length > 0;
          }
          if (hasExisting && !overwrite) {
            conflicts[type] = {
              hasConflict: true,
              current: type === "endpointRules" ? { count: currentEndpointRulesCount } : currentConfigs[type],
              incoming: type === "endpointRules" ? { count: Array.isArray(configs[type]) ? configs[type].length : 0 } : configs[type],
            };
          }
        }
      }

      // If there are conflicts and overwrite is false, return conflicts for user decision
      if (Object.keys(conflicts).length > 0 && !overwrite) {
        return res.json({
          success: false,
          hasConflicts: true,
          conflicts,
          message: "Some configurations already exist. Set overwrite=true to replace them.",
        });
      }

      // Perform import
      for (const type of configTypes) {
        if (configs[type]) {
          try {
            switch (type) {
              case "traffic":
                await configManager.updateTrafficConfig(configs[type]);
                importResults[type] = { success: true };
                break;
              case "mapping":
                await configManager.updateMappingConfig(configs[type]);
                importResults[type] = { success: true };
                break;
              case "endpoint":
                await configManager.updateEndpointConfig(configs[type]);
                importResults[type] = { success: true };
                break;
              case "session":
                await sessionConfigManager.saveConfig(configs[type]);
                importResults[type] = { success: true };
                break;
              case "proxy":
                await configManager.updateProxyConfig(configs[type]);
                importResults[type] = { success: true };
                break;
              case "endpointRules":
                // Import endpoint rules
                if (!Array.isArray(configs[type])) {
                  importResults[type] = { success: false, error: "endpointRules must be an array" };
                  break;
                }

                if (overwrite) {
                  // Clear all existing rules if overwrite is true
                  const deleteStmt = db.prepare("DELETE FROM endpoint_matching_config");
                  deleteStmt.run();
                }

                // Import new rules
                let importedCount = 0;
                if (configs[type].length > 0) {
                  const { getLocalISOString } = require("../../utils/datetimeUtils");
                  const now = getLocalISOString();

                  const insertStmt = db.prepare(`
                    INSERT INTO endpoint_matching_config (
                      endpoint_pattern,
                      http_method,
                      regex,
                      override,
                      match_version,
                      match_language,
                      match_platform,
                      match_environment,
                      match_headers,
                      match_query_params,
                      match_body,
                      match_response_status,
                      priority,
                      enabled,
                      type,
                      created_at,
                      updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                  `);

                  for (const rule of configs[type]) {
                    // Convert boolean fields back to 0/1 for database
                    const matchHeadersStr = Array.isArray(rule.match_headers)
                      ? JSON.stringify(rule.match_headers)
                      : typeof rule.match_headers === "string"
                        ? rule.match_headers
                        : null;
                    const matchQueryParamsStr = Array.isArray(rule.match_query_params)
                      ? JSON.stringify(rule.match_query_params)
                      : typeof rule.match_query_params === "string"
                        ? rule.match_query_params
                        : null;
                    const matchBodyStr = Array.isArray(rule.match_body)
                      ? JSON.stringify(rule.match_body)
                      : typeof rule.match_body === "string"
                        ? rule.match_body
                        : null;

                    insertStmt.run(
                      rule.endpoint_pattern,
                      rule.http_method,
                      rule.regex === true || rule.regex === 1 ? 1 : 0,
                      rule.override === true || rule.override === 1 ? 1 : 0,
                      rule.match_version === true || rule.match_version === 1 ? 1 : 0,
                      rule.match_language === true || rule.match_language === 1 ? 1 : 0,
                      rule.match_platform === true || rule.match_platform === 1 ? 1 : 0,
                      rule.match_environment || "exact",
                      matchHeadersStr,
                      matchQueryParamsStr,
                      matchBodyStr,
                      rule.match_response_status || "2xx",
                      rule.priority !== undefined && rule.priority !== null ? rule.priority : 10,
                      rule.enabled !== false ? 1 : 0,
                      rule.type || "replay",
                      rule.created_at || now,
                      rule.updated_at || now,
                    );
                    importedCount++;
                  }
                }
                importResults[type] = { success: true, imported: importedCount };
                break;
            }
          } catch (err) {
            importResults[type] = { success: false, error: err.message };
          }
        }
      }

      // Refresh after import
      await configManager.refreshAll();
      await sessionConfigManager.refresh();

      // Get updated endpoint rules count
      const updatedCountStmt = db.prepare("SELECT COUNT(*) as count FROM endpoint_matching_config");
      const updatedCountResult = updatedCountStmt.get();
      const updatedEndpointRulesCount = updatedCountResult.count;

      res.json({
        success: true,
        message: "Configurations imported successfully",
        results: importResults,
        data: {
          traffic: configManager.getTrafficConfig(),
          mapping: configManager.getMappingConfig(),
          endpoint: configManager.getEndpointConfig(),
          session: sessionConfigManager.getConfigSync(),
          proxy: configManager.getProxyConfig(),
          endpointRules: { count: updatedEndpointRulesCount },
        },
      });
    } catch (error) {
      logger.error("Failed to import settings", { error: error.message });
      res.status(500).json({ success: false, error: error.message });
    }
  });

  return router;
}

module.exports = initializeRoutes;
