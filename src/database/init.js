/**
 * Database Initialization Script
 *
 * Initializes the database by running the schema SQL file.
 * Run this script to set up a new database.
 */

const db = require("./connection");
const logger = require("../utils/logger");

async function initializeDatabase() {
  try {
    logger.info("Starting database initialization...");

    // Initialize connection
    db.initialize();

    // Run schema
    db.runSchema();

    // Get statistics
    const stats = db.getStats();
    logger.info("Database initialized successfully", stats);

    // Optimize database
    db.optimize();

    logger.info("Database ready for use");

    return true;
  } catch (error) {
    logger.error("Database initialization failed:", error);
    throw error;
  }
}

// Run if called directly
if (require.main === module) {
  initializeDatabase()
    .then(() => {
      logger.info("Database setup complete");
      process.exit(0);
    })
    .catch((error) => {
      logger.error("Database setup failed:", error);
      process.exit(1);
    });
}

module.exports = initializeDatabase;
