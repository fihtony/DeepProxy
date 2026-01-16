/**
 * main.js
 *
 * Application entry point
 * Starts dProxy server with new architecture
 */

require("dotenv").config();
const ProxyServer = require("./server");
const logger = require("./utils/logger");
const config = require("./config");

// Parse command line arguments
const args = process.argv.slice(2);
const portArg = args.find((arg) => arg.startsWith("--port="));
const targetArg = args.find((arg) => arg.startsWith("--target="));
const modeArg = args.find((arg) => arg.startsWith("--mode="));

const port = portArg ? parseInt(portArg.split("=")[1]) : config.server?.port || 8080;
// Note: Mode is read from database on startup, not from .env or command line
// Command line mode arg is ignored - mode must be changed via API after startup

// Create server instance
const server = new ProxyServer({
  port,
});

// Graceful shutdown handler
const gracefulShutdown = async (signal) => {
  logger.info(`${signal} received, starting graceful shutdown`);

  try {
    await server.stop();
    process.exit(0);
  } catch (error) {
    logger.error("Error during shutdown", { error: error.message });
    process.exit(1);
  }
};

// Register shutdown handlers
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// Unhandled errors
process.on("unhandledRejection", (reason, promise) => {
  logger.error("Unhandled promise rejection", {
    reason: reason instanceof Error ? reason.message : reason,
    stack: reason instanceof Error ? reason.stack : undefined,
  });
});

process.on("uncaughtException", (error) => {
  logger.error("Uncaught exception", {
    error: error.message,
    stack: error.stack,
  });
  gracefulShutdown("UNCAUGHT_EXCEPTION");
});

// Start server
(async () => {
  try {
    logger.info("dProxy starting...", {
      version: require("../package.json").version,
      port,
    });

    await server.start();

    // Mode is already initialized from database in server.start()
    const modeService = server.getModeService();
    const currentMode = modeService.getCurrentMode();

    logger.info("dProxy ready!", {
      managementApi: `http://localhost:${port}/api`,
      health: `http://localhost:${port}/health`,
      mode: modeService.getCurrentMode(),
    });

    // Log some helpful information
    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("📡 dProxy Server Started Successfully!");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`🌐 Server:          http://localhost:${port}`);
    console.log(`🔧 Mode:            ${modeService.getCurrentMode()}`);
    console.log(`📊 Management API:  http://localhost:${port}/api`);
    console.log(`❤️  Health Check:   http://localhost:${port}/health`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("\nAPI Endpoints:");
    console.log("  GET  /api/modes              - Get current mode");
    console.log("  POST /api/modes/set          - Set proxy mode");
    console.log("  GET  /api/requests           - Get recorded requests");
    console.log("  GET  /api/responses          - Get recorded responses");
    console.log("  GET  /api/configs            - Get matching configs");
    console.log("  GET  /api/templates          - Get response templates");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  } catch (error) {
    logger.error("Failed to start dProxy", { error: error.message });
    process.exit(1);
  }
})();

module.exports = server;
