#!/usr/bin/env node

/**
 * Simple database setup script
 */

const db = require("./connection");
const fs = require("fs");
const path = require("path");

try {
  // Initialize connection
  db.initialize();

  // Read schema file
  const schemaPath = path.join(__dirname, "schema.sql");
  const schema = fs.readFileSync(schemaPath, "utf-8");

  // Get raw database instance and execute schema
  const sqliteDb = db.getDatabase();
  sqliteDb.exec(schema);

  console.log("✓ Database initialized successfully");
  console.log("  Tables created: users, sessions, and related indexes");

  db.close();
} catch (error) {
  console.error("✗ Database setup failed:", error.message);
  process.exit(1);
}
