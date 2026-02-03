/**
 * Body Serialization Utilities
 *
 * Common functions for serializing request/response bodies
 * Handles Buffer, Object, and String types correctly
 * Decompresses gzip/deflate/br response bodies for storage/display
 */

const zlib = require("zlib");

/**
 * Decompress response body when Content-Encoding is gzip, deflate, or br
 * @param {Buffer} buffer - Raw response body buffer
 * @param {string} contentEncoding - Value of Content-Encoding header (e.g. 'gzip', 'deflate', 'br')
 * @returns {Buffer|null} Decompressed buffer or null on failure
 */
function decompressResponseBody(buffer, contentEncoding) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0 || !contentEncoding) {
    return buffer;
  }
  const encoding = String(contentEncoding).trim().toLowerCase();
  try {
    if (encoding === "gzip" || encoding === "gunzip") {
      return zlib.gunzipSync(buffer);
    }
    if (encoding === "deflate") {
      return zlib.inflateSync(buffer);
    }
    if (encoding === "br") {
      return zlib.brotliDecompressSync(buffer);
    }
  } catch (e) {
    return buffer;
  }
  return buffer;
}

/**
 * Serialize body to JSON string for database storage
 * Handles Buffer, Object, and String types correctly
 *
 * @param {*} body - Request or response body
 * @returns {string|null} JSON string or null
 *
 * @example
 * // Buffer containing JSON
 * serializeBody(Buffer.from('{"test":"data"}')) // returns '{"test":"data"}'
 *
 * // Object
 * serializeBody({test: "data"}) // returns '{"test":"data"}'
 *
 * // String (plain text or HTML)
 * serializeBody('plain text') // returns 'plain text' (as-is)
 * serializeBody('<!DOCTYPE html>...') // returns '<!DOCTYPE html>...' (as-is, not forced to JSON)
 */
function serializeBody(body) {
  if (!body) return null;

  // If body is a Buffer, convert to string first
  if (Buffer.isBuffer(body)) {
    try {
      const bodyStr = body.toString("utf8");
      // Try to parse as JSON to detect if it's JSON
      try {
        const bodyObj = JSON.parse(bodyStr);
        // It's valid JSON, so stringify for consistency
        return JSON.stringify(bodyObj);
      } catch (e) {
        // Not valid JSON, return the string as-is (could be HTML, plain text, etc.)
        return bodyStr;
      }
    } catch (e) {
      // Buffer conversion failed, return null
      return null;
    }
  }

  // If body is already an object, stringify it
  if (typeof body === "object") {
    try {
      return JSON.stringify(body);
    } catch (e) {
      // Stringify failed (circular reference?), return null
      return null;
    }
  }

  // If body is a string, DON'T force it to be JSON
  // Return as-is to preserve plain text, HTML, or other string content
  if (typeof body === "string") {
    return body;
  }

  // For other types, convert to string
  return String(body);
}

module.exports = {
  serializeBody,
  decompressResponseBody,
};
