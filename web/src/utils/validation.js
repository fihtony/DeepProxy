/**
 * Validation utilities for form inputs and API data
 */

// Validate HTTP method
export const validateHttpMethod = (method) => {
  const validMethods = ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"];
  return validMethods.includes(method?.toUpperCase());
};

// Validate endpoint path
export const validateEndpointPath = (path) => {
  if (!path || typeof path !== "string") return false;
  // Must start with /
  if (!path.startsWith("/")) return false;
  // No spaces
  if (path.includes(" ")) return false;
  return true;
};

// Validate HTTP status code
export const validateStatusCode = (code) => {
  const numCode = Number(code);
  return Number.isInteger(numCode) && numCode >= 100 && numCode < 600;
};

// Validate JSON string
export const validateJson = (jsonString) => {
  if (!jsonString || jsonString.trim() === "") return { valid: true, error: null };

  try {
    JSON.parse(jsonString);
    return { valid: true, error: null };
  } catch (error) {
    return { valid: false, error: error.message };
  }
};

// Validate headers object
export const validateHeaders = (headers) => {
  if (!headers) return { valid: true, error: null };

  if (typeof headers !== "object" || Array.isArray(headers)) {
    return { valid: false, error: "Headers must be an object" };
  }

  // Check each header name is a string
  for (const key of Object.keys(headers)) {
    if (typeof key !== "string" || key.trim() === "") {
      return { valid: false, error: "Header names must be non-empty strings" };
    }
  }

  return { valid: true, error: null };
};

// Validate semantic version
export const validateSemver = (version) => {
  if (!version) return { valid: true, error: null };

  const semverRegex = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

  if (semverRegex.test(version)) {
    return { valid: true, error: null };
  }

  return { valid: false, error: "Version must be in semantic versioning format (e.g., 1.0.0)" };
};

// Validate URL
export const validateUrl = (url) => {
  if (!url) return { valid: false, error: "URL is required" };

  try {
    new URL(url);
    return { valid: true, error: null };
  } catch (error) {
    return { valid: false, error: "Invalid URL format" };
  }
};

// Validate environment name
export const validateEnvironment = (env) => {
  const validEnvs = ["Exact", "sit", "stage", "prod", "dev"];
  if (validEnvs.includes(env)) {
    return { valid: true, error: null };
  }
  return { valid: false, error: `Environment must be one of: ${validEnvs.join(", ")}` };
};

// Validate platform name
export const validatePlatform = (platform) => {
  const validPlatforms = ["ios", "android", "web", "desktop"];
  if (validPlatforms.includes(platform?.toLowerCase())) {
    return { valid: true, error: null };
  }
  return { valid: false, error: `Platform must be one of: ${validPlatforms.join(", ")}` };
};

// Validate query parameters
export const validateQueryParams = (params) => {
  if (!params) return { valid: true, error: null };

  if (typeof params === "string") {
    try {
      params = JSON.parse(params);
    } catch {
      return { valid: false, error: "Query params must be valid JSON" };
    }
  }

  if (!Array.isArray(params)) {
    return { valid: false, error: "Query params must be an array" };
  }

  for (const param of params) {
    if (typeof param !== "string" || param.trim() === "") {
      return { valid: false, error: "Each query param must be a non-empty string" };
    }
  }

  return { valid: true, error: null };
};

// Validate response source
export const validateResponseSource = (source) => {
  const validSources = ["backend", "dproxy", "custom"];
  if (validSources.includes(source)) {
    return { valid: true, error: null };
  }
  return { valid: false, error: `Response source must be one of: ${validSources.join(", ")}` };
};

// Validate entire endpoint configuration
export const validateEndpointConfig = (config) => {
  const errors = {};

  if (!validateHttpMethod(config.http_method)) {
    errors.http_method = "Invalid HTTP method";
  }

  if (!validateEndpointPath(config.endpoint_path)) {
    errors.endpoint_path = "Invalid endpoint path";
  }

  if (config.match_by_query_params) {
    const result = validateQueryParams(config.match_by_query_params);
    if (!result.valid) {
      errors.match_by_query_params = result.error;
    }
  }

  if (config.match_by_env) {
    const result = validateEnvironment(config.match_by_env);
    if (!result.valid) {
      errors.match_by_env = result.error;
    }
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
};

// Validate entire response configuration
export const validateResponseConfig = (config) => {
  const errors = {};

  if (!validateStatusCode(config.response_status)) {
    errors.response_status = "Invalid status code";
  }

  const sourceResult = validateResponseSource(config.response_source);
  if (!sourceResult.valid) {
    errors.response_source = sourceResult.error;
  }

  if (config.response_headers) {
    const headersResult = validateHeaders(
      typeof config.response_headers === "string" ? JSON.parse(config.response_headers) : config.response_headers
    );
    if (!headersResult.valid) {
      errors.response_headers = headersResult.error;
    }
  }

  if (config.response_body) {
    const jsonResult = validateJson(config.response_body);
    if (!jsonResult.valid) {
      errors.response_body = jsonResult.error;
    }
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
};

export default {
  validateHttpMethod,
  validateEndpointPath,
  validateStatusCode,
  validateJson,
  validateHeaders,
  validateSemver,
  validateUrl,
  validateEnvironment,
  validatePlatform,
  validateQueryParams,
  validateResponseSource,
  validateEndpointConfig,
  validateResponseConfig,
};
