/**
 * Formatting utilities for displaying data
 */

// Format date/time
export const formatDate = (date, includeTime = false) => {
  if (!date) return "-";

  const d = new Date(date);
  if (isNaN(d.getTime())) return "Invalid Date";

  const options = {
    year: "numeric",
    month: "short",
    day: "numeric",
  };

  if (includeTime) {
    options.hour = "2-digit";
    options.minute = "2-digit";
    options.second = "2-digit";
  }

  // Explicitly use local timezone (timeZone: undefined means browser's local timezone)
  return d.toLocaleString("en-US", { ...options, timeZone: undefined });
};

// Format JSON with indentation
export const formatJson = (json, indent = 2) => {
  if (!json) return "";

  try {
    if (typeof json === "string") {
      json = JSON.parse(json);
    }
    return JSON.stringify(json, null, indent);
  } catch {
    return json;
  }
};

// Format file size
export const formatFileSize = (bytes) => {
  if (!bytes || bytes === 0) return "0 B";

  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));

  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
};

// Format duration in milliseconds
export const formatDuration = (ms) => {
  if (!ms || ms === 0) return "0ms";

  if (ms < 1000) {
    return `${ms}ms`;
  }

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }

  return `${seconds}s`;
};

// Format HTTP status code with description
export const formatStatusCode = (code) => {
  const descriptions = {
    200: "OK",
    201: "Created",
    204: "No Content",
    400: "Bad Request",
    401: "Unauthorized",
    403: "Forbidden",
    404: "Not Found",
    409: "Conflict",
    422: "Unprocessable Entity",
    500: "Internal Server Error",
    502: "Bad Gateway",
    503: "Service Unavailable",
    504: "Gateway Timeout",
  };

  return descriptions[code] || `HTTP ${code}`;
};

// Format headers object to display string
export const formatHeaders = (headers) => {
  if (!headers) return "";

  if (typeof headers === "string") {
    try {
      headers = JSON.parse(headers);
    } catch {
      return headers;
    }
  }

  return Object.entries(headers)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
};

// Truncate long strings
export const truncate = (str, maxLength = 50) => {
  if (!str || str.length <= maxLength) return str;
  return `${str.substring(0, maxLength)}...`;
};

// Format endpoint path with method
export const formatEndpoint = (method, path) => {
  return `${method.toUpperCase()} ${path}`;
};

// Format query parameters object
export const formatQueryParams = (params) => {
  if (!params) return "";

  if (typeof params === "string") {
    try {
      params = JSON.parse(params);
    } catch {
      return params;
    }
  }

  if (Array.isArray(params)) {
    return params.join(", ");
  }

  return Object.entries(params)
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
};

// Highlight JSON syntax
export const highlightJson = (json) => {
  if (typeof json !== "string") {
    json = JSON.stringify(json, null, 2);
  }

  // Simple syntax highlighting
  return json.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, (match) => {
    let cls = "number";
    if (/^"/.test(match)) {
      if (/:$/.test(match)) {
        cls = "key";
      } else {
        cls = "string";
      }
    } else if (/true|false/.test(match)) {
      cls = "boolean";
    } else if (/null/.test(match)) {
      cls = "null";
    }
    return `<span class="${cls}">${match}</span>`;
  });
};

// Format version for display
export const formatVersion = (version) => {
  if (!version) return "-";

  // Remove 'v' prefix if present
  if (version.startsWith("v")) {
    return version.substring(1);
  }

  return version;
};

// Format platform name
export const formatPlatform = (platform) => {
  if (!platform) return "-";

  const platformNames = {
    ios: "iOS",
    android: "Android",
    web: "Web",
    desktop: "Desktop",
  };

  return platformNames[platform.toLowerCase()] || platform;
};

// Format environment name
export const formatEnvironment = (env) => {
  if (!env) return "-";

  const envNames = {
    sit: "SIT",
    stage: "Stage",
    prod: "Production",
    dev: "Development",
    exact: "Exact Match",
  };

  return envNames[env.toLowerCase()] || env;
};

// Format response source
export const formatResponseSource = (source) => {
  if (!source) return "-";

  const sourceNames = {
    backend: "Backend",
    dproxy: "dProxy",
    custom: "Custom",
  };

  return sourceNames[source.toLowerCase()] || source;
};

// Format matching rule
export const formatMatchingRule = (config) => {
  const rules = [];

  if (config.match_by_version) {
    rules.push("Version");
  }
  if (config.match_by_platform) {
    rules.push("Platform");
  }
  if (config.match_by_env && config.match_by_env !== "Exact") {
    rules.push(`Env (${config.match_by_env})`);
  }
  if (config.match_by_query_params && config.match_by_query_params.length > 0) {
    rules.push("Query Params");
  }
  if (config.match_by_headers && config.match_by_headers.length > 0) {
    rules.push("Headers");
  }

  return rules.length > 0 ? rules.join(", ") : "No matching rules";
};

export default {
  formatDate,
  formatJson,
  formatFileSize,
  formatDuration,
  formatStatusCode,
  formatHeaders,
  truncate,
  formatEndpoint,
  formatQueryParams,
  highlightJson,
  formatVersion,
  formatPlatform,
  formatEnvironment,
  formatResponseSource,
  formatMatchingRule,
};
