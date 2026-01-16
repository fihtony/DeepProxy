/**
 * HTTP Utilities
 *
 * Purpose:
 * - HTTP request/response helper functions
 * - Header manipulation utilities
 * - URL parsing and building
 * - Content-type handling
 */

/**
 * Parse content-type header
 * @param {string} contentType - Content-Type header value
 * @returns {Object} Parsed content type { type, charset, boundary }
 */
function parseContentType(contentType) {
  if (!contentType) {
    return { type: null, charset: null, boundary: null };
  }

  const parts = contentType.split(";").map((p) => p.trim());
  const type = parts[0];

  const params = {};
  parts.slice(1).forEach((part) => {
    const [key, value] = part.split("=").map((p) => p.trim());
    params[key] = value ? value.replace(/^["']|["']$/g, "") : null;
  });

  return {
    type,
    charset: params.charset || null,
    boundary: params.boundary || null,
  };
}

/**
 * Check if content type is JSON
 * @param {string} contentType - Content-Type header value
 * @returns {boolean} True if JSON
 */
function isJsonContent(contentType) {
  if (!contentType) return false;
  return contentType.toLowerCase().includes("application/json");
}

/**
 * Check if content type is form data
 * @param {string} contentType - Content-Type header value
 * @returns {boolean} True if form data
 */
function isFormContent(contentType) {
  if (!contentType) return false;
  const lower = contentType.toLowerCase();
  return lower.includes("application/x-www-form-urlencoded") || lower.includes("multipart/form-data");
}

/**
 * Normalize header name to lowercase
 * @param {string} name - Header name
 * @returns {string} Normalized name
 */
function normalizeHeaderName(name) {
  return name.toLowerCase();
}

/**
 * Normalize headers object
 * @param {Object} headers - Headers object
 * @returns {Object} Normalized headers
 */
function normalizeHeaders(headers) {
  const normalized = {};
  Object.entries(headers || {}).forEach(([name, value]) => {
    normalized[normalizeHeaderName(name)] = value;
  });
  return normalized;
}

/**
 * Get header value (case-insensitive)
 * @param {Object} headers - Headers object
 * @param {string} name - Header name
 * @returns {string|undefined} Header value
 */
function getHeader(headers, name) {
  const normalized = normalizeHeaderName(name);
  return headers[normalized];
}

/**
 * Set header value (case-insensitive)
 * @param {Object} headers - Headers object
 * @param {string} name - Header name
 * @param {string|string[]} value - Header value
 * @returns {Object} Modified headers
 */
function setHeader(headers, name, value) {
  const normalized = normalizeHeaderName(name);
  headers[normalized] = value;
  return headers;
}

/**
 * Remove header (case-insensitive)
 * @param {Object} headers - Headers object
 * @param {string} name - Header name
 * @returns {Object} Modified headers
 */
function removeHeader(headers, name) {
  const normalized = normalizeHeaderName(name);
  delete headers[normalized];
  return headers;
}

/**
 * Parse URL and extract components
 * @param {string} url - URL string
 * @returns {Object} Parsed URL components
 */
function parseUrl(url) {
  try {
    const parsed = new URL(url);
    return {
      protocol: parsed.protocol,
      host: parsed.host,
      hostname: parsed.hostname,
      port: parsed.port,
      pathname: parsed.pathname,
      search: parsed.search,
      searchParams: Object.fromEntries(parsed.searchParams),
      hash: parsed.hash,
      href: parsed.href,
    };
  } catch (error) {
    return null;
  }
}

/**
 * Build URL from components
 * @param {Object} components - URL components
 * @returns {string} Built URL
 */
function buildUrl(components) {
  const { protocol = "http:", hostname, port, pathname = "/", search = "", hash = "" } = components;

  let url = `${protocol}//${hostname}`;
  if (port) {
    url += `:${port}`;
  }
  url += pathname;
  if (search) {
    url += search.startsWith("?") ? search : `?${search}`;
  }
  if (hash) {
    url += hash.startsWith("#") ? hash : `#${hash}`;
  }

  return url;
}

/**
 * Extract path parameters from URL pattern
 * @param {string} pattern - URL pattern (e.g., '/users/:id/posts/:postId')
 * @param {string} path - Actual path (e.g., '/users/123/posts/456')
 * @returns {Object|null} Path parameters or null if no match
 */
function extractPathParams(pattern, path) {
  // Convert pattern to regex
  const regexPattern = pattern.replace(/:[^/]+/g, "([^/]+)").replace(/\*/g, ".*");

  const regex = new RegExp(`^${regexPattern}$`);
  const match = path.match(regex);

  if (!match) {
    return null;
  }

  // Extract parameter names
  const paramNames = [];
  const paramMatches = pattern.matchAll(/:([^/]+)/g);
  for (const m of paramMatches) {
    paramNames.push(m[1]);
  }

  // Build params object
  const params = {};
  paramNames.forEach((name, index) => {
    params[name] = match[index + 1];
  });

  return params;
}

/**
 * Check if path matches pattern
 * @param {string} pattern - URL pattern
 * @param {string} path - Actual path
 * @returns {boolean} True if matches
 */
function matchesPath(pattern, path) {
  return extractPathParams(pattern, path) !== null;
}

/**
 * Get status code category
 * @param {number} status - HTTP status code
 * @returns {string} Category: 'informational', 'success', 'redirect', 'client_error', 'server_error'
 */
function getStatusCategory(status) {
  if (status >= 100 && status < 200) return "informational";
  if (status >= 200 && status < 300) return "success";
  if (status >= 300 && status < 400) return "redirect";
  if (status >= 400 && status < 500) return "client_error";
  if (status >= 500 && status < 600) return "server_error";
  return "unknown";
}

/**
 * Check if status is error
 * @param {number} status - HTTP status code
 * @returns {boolean} True if error status
 */
function isErrorStatus(status) {
  return status >= 400;
}

/**
 * Check if status is success
 * @param {number} status - HTTP status code
 * @returns {boolean} True if success status
 */
function isSuccessStatus(status) {
  return status >= 200 && status < 300;
}

/**
 * Build query string from object
 * @param {Object} params - Query parameters
 * @returns {string} Query string (without leading '?')
 */
function buildQueryString(params) {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach((v) => searchParams.append(key, v));
    } else if (value !== null && value !== undefined) {
      searchParams.append(key, value);
    }
  });
  return searchParams.toString();
}

/**
 * Parse query string to object
 * @param {string} queryString - Query string (with or without leading '?')
 * @returns {Object} Query parameters object
 */
function parseQueryString(queryString) {
  const cleaned = queryString.startsWith("?") ? queryString.slice(1) : queryString;
  const params = {};
  const searchParams = new URLSearchParams(cleaned);

  for (const [key, value] of searchParams.entries()) {
    if (params[key]) {
      // Convert to array if multiple values
      if (Array.isArray(params[key])) {
        params[key].push(value);
      } else {
        params[key] = [params[key], value];
      }
    } else {
      params[key] = value;
    }
  }

  return params;
}

/**
 * Detect if a request is HTTPS based on multiple indicators
 * 
 * This function checks various sources to determine if a request came through HTTPS:
 * 1. URL already contains https:// (most reliable)
 * 2. Request metadata indicates it came through HTTPS tunnel (HIGH PRIORITY)
 * 3. req.secure flag (Express sets this for HTTPS)
 * 4. req.protocol === 'https'
 * 5. req.socket.encrypted or req.connection.encrypted
 * 6. x-forwarded-proto header === 'https'
 * 7. x-forwarded-ssl header === 'on'
 * 8. Host header contains port 443
 * 9. URL string contains port 443
 * 
 * @param {Object} options - Detection options
 * @param {string} options.url - Request URL (may be full URL or path)
 * @param {string} options.protocol - Request protocol from req.protocol
 * @param {boolean} options.secure - Request secure flag from req.secure
 * @param {Object} options.headers - Request headers
 * @param {Object} options.socket - Request socket object
 * @param {Object} options.connection - Request connection object
 * @param {Object} options.metadata - Request metadata (may contain cameThroughHttpsTunnel flag)
 * @returns {Object} Detection result with isHttps boolean and reason
 * 
 * @example
 * const result = detectHttps({
 *   url: 'http://example.com/path',
 *   protocol: 'http',
 *   secure: false,
 *   headers: { host: 'example.com' },
 *   metadata: { cameThroughHttpsTunnel: true }
 * });
 * // Returns: { isHttps: true, reason: 'https_tunnel_detected', confidence: 'high' }
 */
function detectHttps(options = {}) {
  const {
    url = '',
    protocol = 'http',
    secure = false,
    headers = {},
    socket = {},
    connection = {},
    metadata = {},
  } = options;

  // Priority 1: URL already contains https:// (most reliable)
  if (url && typeof url === 'string' && url.startsWith('https://')) {
    return {
      isHttps: true,
      reason: 'url_contains_https',
      confidence: 'high',
    };
  }

  // Priority 2: Request came through HTTPS CONNECT tunnel (HIGH PRIORITY)
  // If a request came through an HTTPS tunnel (CONNECT method to port 443), it's definitely HTTPS
  // This is checked via metadata which is set when CONNECT to port 443 is detected
  if (metadata?.cameThroughHttpsTunnel === true || metadata?.isHttpsTunnel === true) {
    return {
      isHttps: true,
      reason: 'https_tunnel_detected',
      confidence: 'high',
    };
  }
  
  // Priority 2b: Heuristic - If URL has http:// but we detect it might be HTTPS from other indicators
  // This handles cases where the URL was incorrectly set to http:// but came through HTTPS tunnel
  // We check this by looking at the URL and seeing if it matches patterns that suggest HTTPS
  // For example, if the URL is http:// but the host matches a known HTTPS target
  // OR if x-forwarded-proto is https, treat as HTTPS even if URL says http://
  if (url && typeof url === 'string' && url.startsWith('http://') && !url.startsWith('https://')) {
    // If x-forwarded-proto is https, the request came through HTTPS (even if URL says http://)
    const xForwardedProto = headers['x-forwarded-proto'] || headers['X-Forwarded-Proto'];
    if (xForwardedProto === 'https') {
      return {
        isHttps: true,
        reason: 'x_forwarded_proto_https_but_url_http',
        confidence: 'high',
      };
    }
  }

  // Priority 3: req.secure flag (Express sets this for HTTPS connections)
  if (secure === true) {
    return {
      isHttps: true,
      reason: 'req_secure_flag',
      confidence: 'high',
    };
  }

  // Priority 4: req.protocol === 'https'
  if (protocol === 'https') {
    return {
      isHttps: true,
      reason: 'req_protocol_https',
      confidence: 'high',
    };
  }

  // Priority 5: Socket or connection encrypted flag
  if (socket?.encrypted === true || connection?.encrypted === true) {
    return {
      isHttps: true,
      reason: 'socket_encrypted',
      confidence: 'medium',
    };
  }

  // Priority 6: x-forwarded-proto header
  const xForwardedProto = headers['x-forwarded-proto'] || headers['X-Forwarded-Proto'];
  if (xForwardedProto === 'https') {
    return {
      isHttps: true,
      reason: 'x_forwarded_proto_header',
      confidence: 'medium',
    };
  }

  // Priority 7: x-forwarded-ssl header
  const xForwardedSsl = headers['x-forwarded-ssl'] || headers['X-Forwarded-Ssl'];
  if (xForwardedSsl === 'on') {
    return {
      isHttps: true,
      reason: 'x_forwarded_ssl_header',
      confidence: 'medium',
    };
  }

  // Priority 8: Host header contains port 443
  const hostHeader = headers.host || headers.Host || '';
  if (hostHeader.includes(':443')) {
    return {
      isHttps: true,
      reason: 'host_header_port_443',
      confidence: 'medium',
    };
  }

  // Priority 9: URL string contains port 443
  if (url && typeof url === 'string' && (url.includes(':443') || url.includes('443'))) {
    return {
      isHttps: true,
      reason: 'url_contains_port_443',
      confidence: 'low',
    };
  }

  // Priority 10: Socket remote port is 443 (for CONNECT requests)
  if (socket?.remotePort === 443 || connection?.remotePort === 443) {
    return {
      isHttps: true,
      reason: 'socket_remote_port_443',
      confidence: 'low',
    };
  }

  // Default: not HTTPS
  return {
    isHttps: false,
    reason: 'no_https_indicators',
    confidence: 'high',
  };
}

module.exports = {
  parseContentType,
  isJsonContent,
  isFormContent,
  normalizeHeaderName,
  normalizeHeaders,
  getHeader,
  setHeader,
  removeHeader,
  parseUrl,
  buildUrl,
  extractPathParams,
  matchesPath,
  getStatusCategory,
  isErrorStatus,
  isSuccessStatus,
  buildQueryString,
  parseQueryString,
  detectHttps,
};
