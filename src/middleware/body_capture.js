/**
 * Body Capture Middleware
 *
 * Captures request bodies for logging and recording.
 * Skips parsing for /admin routes to allow express.json() to handle them.
 */

const logger = require("../utils/logger");

/**
 * Capture request body for logging/recording purposes
 * Stores the raw body on req object, but allows downstream parsers for /admin routes
 */
function captureRequestBody(req, res, next) {
  logger.info("[BODY_CAPTURE] Processing request", {
    method: req.method,
    path: req.path,
    contentLength: req.get("content-length"),
    contentType: req.get("content-type"),
  });

  // Skip body capture for GET, HEAD, DELETE
  if (req.method === "GET" || req.method === "HEAD" || req.method === "DELETE") {
    req.body = null;
    req.rawBody = null;
    logger.debug("[BODY_CAPTURE] Skipped (method)", { method: req.method });
    return next();
  }

  // Skip if no content-length or no content-type
  if (req.get("content-length") === "0" || !req.get("content-type")) {
    req.body = null;
    req.rawBody = null;
    logger.debug("[BODY_CAPTURE] Skipped (no content)");
    return next();
  }

  // For /admin routes, skip body capture to let express.json() handle it
  if (req.path.startsWith("/admin")) {
    req.body = null;
    req.rawBody = null;
    logger.debug("[BODY_CAPTURE] Skipped (/admin route)");
    return next();
  }

  logger.info("[BODY_CAPTURE] Starting body capture", {
    path: req.path,
    method: req.method,
  });

  const buffers = [];
  let streamEnded = false;

  // Collect chunks
  const onData = (chunk) => {
    buffers.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  };

  const onEnd = () => {
    if (streamEnded) return;
    streamEnded = true;

    req.removeListener("data", onData);
    req.removeListener("end", onEnd);
    req.removeListener("error", onError);

    try {
      if (buffers.length > 0) {
        const rawBody = Buffer.concat(buffers);
        req.rawBody = rawBody;

        logger.info("[BODY_CAPTURE] Raw body captured", {
          method: req.method,
          path: req.path,
          rawBodyLength: rawBody.length,
          contentType: req.get("content-type"),
        });

        // Try to parse as JSON
        const contentType = req.get("content-type") || "";
        if (contentType.includes("application/json")) {
          try {
            req.body = JSON.parse(rawBody.toString("utf8"));
            logger.debug("[BODY_CAPTURE] Captured JSON body", {
              method: req.method,
              path: req.path,
              size: rawBody.length,
            });
          } catch (e) {
            req.body = null;
            logger.debug("[BODY_CAPTURE] JSON parse deferred", {
              method: req.method,
              path: req.path,
            });
          }
        } else {
          req.body = rawBody.toString("utf8");
        }
      } else {
        req.body = null;
        req.rawBody = null;
      }

      next();
    } catch (err) {
      logger.error("[BODY_CAPTURE] Error", { error: err.message });
      next();
    }
  };

  const onError = (err) => {
    logger.error("[BODY_CAPTURE] Stream error", {
      method: req.method,
      path: req.path,
      error: err.message,
    });
    req.body = null;
    req.rawBody = null;
    next();
  };

  req.on("data", onData);
  req.on("end", onEnd);
  req.on("error", onError);
}

module.exports = {
  captureRequestBody,
};
