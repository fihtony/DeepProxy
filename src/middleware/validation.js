/**
 * Request Validation Middleware
 *
 * Provides validation middleware using express-validator
 * for common admin API request patterns.
 *
 * @module middleware/validation
 */

const { body, query, param, validationResult } = require("express-validator");
const logger = require("../utils/logger");

/**
 * Handle validation errors
 * Returns 400 with error details if validation fails
 *
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Function} next - Express next function
 */
function handleValidationErrors(req, res, next) {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    logger.warn("Validation failed", {
      path: req.path,
      errors: errors.array(),
    });

    return res.status(400).json({
      error: "Validation Error",
      message: "Request validation failed",
      details: errors.array().map((err) => ({
        field: err.param,
        message: err.msg,
        value: err.value,
      })),
    });
  }

  next();
}

/**
 * Validate mode switch request
 */
const validateModeSwitch = [
  body("mode")
    .notEmpty()
    .withMessage("Mode is required")
    .isIn(["passthrough", "recording", "replay"])
    .withMessage('Mode must be "passthrough", "recording", or "replay"'),
  handleValidationErrors,
];

/**
 * Validate pagination parameters
 */
const validatePagination = [
  query("page").optional().isInt({ min: 1 }).withMessage("Page must be a positive integer").toInt(),
  query("limit").optional().isInt({ min: 1, max: 1000 }).withMessage("Limit must be between 1 and 1000").toInt(),
  handleValidationErrors,
];

/**
 * Validate date range parameters
 */
const validateDateRange = [
  query("start_date").optional().isISO8601().withMessage("Start date must be valid ISO 8601 date (YYYY-MM-DD)"),
  query("end_date")
    .optional()
    .isISO8601()
    .withMessage("End date must be valid ISO 8601 date (YYYY-MM-DD)")
    .custom((endDate, { req }) => {
      if (req.query.start_date && endDate < req.query.start_date) {
        throw new Error("End date must be after start date");
      }
      return true;
    }),
  handleValidationErrors,
];

/**
 * Validate search query
 */
const validateSearch = [
  query("search").optional().isString().trim().isLength({ min: 1, max: 100 }).withMessage("Search query must be 1-100 characters"),
  handleValidationErrors,
];

/**
 * Validate user ID parameter
 */
const validateUserId = [
  param("userId").notEmpty().isInt({ min: 1 }).withMessage("User ID must be a positive integer").toInt(),
  handleValidationErrors,
];

/**
 * Validate request ID parameter
 */
const validateRequestId = [
  param("requestId").notEmpty().isInt({ min: 1 }).withMessage("Request ID must be a positive integer").toInt(),
  handleValidationErrors,
];

/**
 * Validate endpoint ID parameter
 */
const validateEndpointId = [
  param("endpointId").notEmpty().isInt({ min: 1 }).withMessage("Endpoint ID must be a positive integer").toInt(),
  handleValidationErrors,
];

/**
 * Validate processor ID parameter
 */
const validateProcessorId = [
  param("processorId").notEmpty().isInt({ min: 1 }).withMessage("Processor ID must be a positive integer").toInt(),
  handleValidationErrors,
];

/**
 * Validate endpoint name parameter
 */
const validateEndpointName = [
  param("endpointName").notEmpty().isString().trim().isLength({ min: 1, max: 200 }).withMessage("Endpoint name must be 1-200 characters"),
  handleValidationErrors,
];

/**
 * Validate service name parameter
 */
const validateServiceName = [
  param("serviceName").notEmpty().isString().trim().isLength({ min: 1, max: 200 }).withMessage("Service name must be 1-200 characters"),
  handleValidationErrors,
];

/**
 * Validate request update body
 */
const validateRequestUpdate = [
  body("response_body")
    .optional()
    .custom((value) => {
      try {
        if (typeof value === "string") {
          JSON.parse(value);
        }
        return true;
      } catch (error) {
        throw new Error("Response body must be valid JSON");
      }
    }),
  body("response_status")
    .optional()
    .isInt({ min: 100, max: 599 })
    .withMessage("Response status must be a valid HTTP status code (100-599)"),
  handleValidationErrors,
];

/**
 * Validate endpoint metadata update
 */
const validateEndpointUpdate = [
  body("endpoint_name").optional().isString().trim().isLength({ min: 1, max: 200 }).withMessage("Endpoint name must be 1-200 characters"),
  body("description").optional().isString().trim().isLength({ max: 1000 }).withMessage("Description must not exceed 1000 characters"),
  body("service_category")
    .optional()
    .isString()
    .trim()
    .isLength({ max: 100 })
    .withMessage("Service category must not exceed 100 characters"),
  handleValidationErrors,
];

module.exports = {
  validateModeSwitch,
  validatePagination,
  validateDateRange,
  validateSearch,
  validateUserId,
  validateRequestId,
  validateEndpointId,
  validateProcessorId,
  validateEndpointName,
  validateServiceName,
  validateRequestUpdate,
  validateEndpointUpdate,
  handleValidationErrors,
};
