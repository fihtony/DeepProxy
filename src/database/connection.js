/**
 * Database Connection Manager
 *
 * Provides SQLite database connection using better-sqlite3 (sync API)
 */

const BetterSqlite3 = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

// Simple logger fallback if main logger not available
const logger = {
  info: (...args) => console.log("[INFO]", ...args),
  error: (...args) => console.error("[ERROR]", ...args),
  debug: (...args) => console.log("[DEBUG]", ...args),
};

// Try to load config, fallback to defaults
let config;
try {
  config = require("../config");
} catch (e) {
  config = {
    database: {
      path: path.join(__dirname, "../../data/dproxy.db"),
      logging: false,
    },
  };
}

class DatabaseConnection {
  constructor() {
    this.db = null;
    this.isInitialized = false;
  }

  /**
   * Initialize database connection (synchronous with better-sqlite3)
   */
  initialize() {
    if (this.isInitialized && this.db) {
      return this.db;
    }

    try {
      // Ensure database directory exists
      const dbPath = path.resolve(config.database.path);
      const dbDir = path.dirname(dbPath);

      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
        logger.info(`Created database directory: ${dbDir}`);
      }

      // Create database connection using better-sqlite3
      this.db = new BetterSqlite3(dbPath);

      // Configure database
      this.db.pragma("journal_mode = WAL"); // Write-Ahead Logging
      this.db.pragma("foreign_keys = ON"); // Enable foreign keys
      this.db.pragma("synchronous = NORMAL");
      this.db.pragma("cache_size = -64000"); // 64MB cache

      this.isInitialized = true;
      logger.info(`Database connected: ${dbPath}`);

      // Run migrations for existing databases (e.g. add new columns)
      this.runMigrations();

      return this.db;
    } catch (error) {
      logger.error("Failed to initialize database:", error);
      throw error;
    }
  }

  /**
   * Get database instance (synchronous with better-sqlite3)
   * Initializes on first call if needed
   */
  getDatabase() {
    if (!this.isInitialized) {
      this.initialize();
    }
    return this.db;
  }

  /**
   * Get database instance synchronously (alias for compatibility)
   * Throws if not initialized
   */
  getDatabaseSync() {
    if (!this.db || !this.isInitialized) {
      // Try to initialize if not already done
      if (!this.isInitialized) {
        return this.initialize();
      }
      throw new Error("Database not initialized.");
    }
    return this.db;
  }

  /**
   * Run database schema from SQL file
   */
  runSchema() {
    try {
      const schemaPath = path.join(__dirname, "schema.sql");
      const schema = fs.readFileSync(schemaPath, "utf8");

      // Execute schema in a transaction
      const db = this.getDatabase();
      db.exec(schema);

      logger.info("Database schema initialized successfully");
    } catch (error) {
      logger.error("Failed to run database schema:", error);
      throw error;
    }
  }

  /**
   * Run migrations for existing databases (e.g. add new columns)
   */
  runMigrations() {
    try {
      const db = this.getDatabase();

      // Migration: add app_language to stats table if missing
      try {
        const tableInfo = db.prepare("PRAGMA table_info(stats)").all();
        const hasAppLanguage = tableInfo.some((col) => col.name === "app_language");
        if (!hasAppLanguage) {
          db.prepare("ALTER TABLE stats ADD COLUMN app_language TEXT").run();
          logger.info("Migration: added app_language column to stats table");
        }
      } catch (e) {
        // stats table may not exist yet (fresh install)
        logger.debug("Migration stats.app_language skipped:", e.message);
      }
    } catch (error) {
      logger.error("Failed to run migrations:", error);
      throw error;
    }
  }

  /**
   * Get database statistics
   */
  getStats() {
    try {
      const db = this.getDatabase();
      const tables = db
        .prepare(
          `
        SELECT name FROM sqlite_master WHERE type='table'
      `
        )
        .all();

      return {
        tables: tables.length,
        tableNames: tables.map((t) => t.name),
      };
    } catch (error) {
      logger.error("Failed to get database stats:", error);
      return { tables: 0, tableNames: [] };
    }
  }

  /**
   * Optimize database
   */
  optimize() {
    try {
      const db = this.getDatabase();
      db.pragma("optimize");
      logger.info("Database optimized");
    } catch (error) {
      logger.error("Failed to optimize database:", error);
    }
  }

  /**
   * Close database connection
   */
  close() {
    if (this.db) {
      this.db.close();
      this.isInitialized = false;
      logger.info("Database connection closed");
    }
  }

  /**
   * Execute raw SQL
   */
  exec(sql) {
    const db = this.getDatabase();
    return db.exec(sql);
  }

  /**
   * Run a single SQL statement
   */
  run(sql, params = []) {
    const db = this.getDatabase();
    const stmt = db.prepare(sql);
    return stmt.run(...params);
  }

  /**
   * Get a single row
   */
  get(sql, params = []) {
    const db = this.getDatabase();
    const stmt = db.prepare(sql);
    return stmt.get(...params);
  }

  /**
   * Get all rows
   */
  all(sql, params = []) {
    const db = this.getDatabase();
    const stmt = db.prepare(sql);
    return stmt.all(...params);
  }

  /**
   * Begin transaction
   */
  beginTransaction() {
    this.exec("BEGIN TRANSACTION");
  }

  /**
   * Commit transaction
   */
  commit() {
    this.exec("COMMIT");
  }

  /**
   * Rollback transaction
   */
  rollback() {
    this.exec("ROLLBACK");
  }

  /**
   * Health check
   */
  async healthCheck() {
    try {
      const result = await this.get("SELECT 1 as healthy");
      return result.healthy === 1;
    } catch (error) {
      logger.error("Database health check failed:", error);
      return false;
    }
  }
}

// Create singleton instance
const dbConnection = new DatabaseConnection();

// Graceful shutdown
process.on("SIGINT", async () => {
  await dbConnection.close();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await dbConnection.close();
  process.exit(0);
});

module.exports = dbConnection;
