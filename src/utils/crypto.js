/**
 * Cryptography Utilities
 *
 * Provides encryption/decryption for sensitive data and hashing utilities.
 * Uses AES-256-GCM for encryption (authenticated encryption).
 *
 * Security: All sensitive data (cookies, tokens) should be encrypted before storage.
 */

const crypto = require("crypto");
const config = require("../config");

// Constants
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16; // 128 bits
const SALT_LENGTH = 64;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32; // 256 bits

/**
 * Derive encryption key from config
 * @returns {Buffer} Encryption key
 */
function getEncryptionKey() {
  // Convert hex string to buffer
  const keyHex = config.security.encryptionKey;
  if (keyHex.length !== 64) {
    throw new Error("Encryption key must be 64 hex characters (32 bytes)");
  }
  return Buffer.from(keyHex, "hex");
}

/**
 * Encrypt data using AES-256-GCM
 * @param {string} plaintext - Data to encrypt
 * @returns {string} Encrypted data (base64 encoded)
 */
function encrypt(plaintext) {
  if (!plaintext) {
    return null;
  }

  try {
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(IV_LENGTH);

    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(plaintext, "utf8", "hex");
    encrypted += cipher.final("hex");

    const authTag = cipher.getAuthTag();

    // Combine IV + AuthTag + Encrypted data
    const combined = Buffer.concat([iv, authTag, Buffer.from(encrypted, "hex")]);

    return combined.toString("base64");
  } catch (error) {
    throw new Error(`Encryption failed: ${error.message}`);
  }
}

/**
 * Decrypt data using AES-256-GCM
 * @param {string} ciphertext - Encrypted data (base64 encoded)
 * @returns {string} Decrypted data
 */
function decrypt(ciphertext) {
  if (!ciphertext) {
    return null;
  }

  try {
    const key = getEncryptionKey();
    const combined = Buffer.from(ciphertext, "base64");

    // Extract IV, AuthTag, and encrypted data
    const iv = combined.slice(0, IV_LENGTH);
    const authTag = combined.slice(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const encrypted = combined.slice(IV_LENGTH + TAG_LENGTH);

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, undefined, "utf8");
    decrypted += decipher.final("utf8");

    return decrypted;
  } catch (error) {
    throw new Error(`Decryption failed: ${error.message}`);
  }
}

/**
 * Hash data using SHA-256
 * @param {string} data - Data to hash
 * @returns {string} Hash (hex string)
 */
function hash(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

/**
 * Hash data with salt using PBKDF2
 * @param {string} data - Data to hash
 * @param {string} salt - Salt (optional, will generate if not provided)
 * @returns {Object} { hash, salt }
 */
function hashWithSalt(data, salt = null) {
  if (!salt) {
    salt = crypto.randomBytes(SALT_LENGTH).toString("hex");
  }

  const hashedData = crypto.pbkdf2Sync(data, salt, 100000, 64, "sha512").toString("hex");

  return {
    hash: hashedData,
    salt,
  };
}

/**
 * Verify hashed data
 * @param {string} data - Original data
 * @param {string} hashedData - Hashed data to verify against
 * @param {string} salt - Salt used for hashing
 * @returns {boolean} True if data matches
 */
function verifyHash(data, hashedData, salt) {
  const result = hashWithSalt(data, salt);
  return result.hash === hashedData;
}

/**
 * Generate random token
 * @param {number} length - Token length in bytes (default 32)
 * @returns {string} Random token (hex string)
 */
function generateToken(length = 32) {
  return crypto.randomBytes(length).toString("hex");
}

/**
 * Generate UUID v4
 * @returns {string} UUID
 */
function generateUUID() {
  return crypto.randomUUID();
}

/**
 * Generate user session cookie value
 * Mimics the format of real session cookies (long base64 string)
 * @returns {string} Session cookie value
 */
function generateSessionCookie() {
  // Generate 128 random bytes for session cookie (similar to real session token length)
  const randomBytes = crypto.randomBytes(128);
  return randomBytes.toString("base64");
}

/**
 * Hash response body for deduplication
 * @param {Object} responseBody - Response body object
 * @returns {string} Hash of response body
 */
function hashResponseBody(responseBody) {
  if (!responseBody) {
    return null;
  }

  // Convert to stable JSON string (sorted keys)
  const normalized = JSON.stringify(responseBody, Object.keys(responseBody).sort());
  return hash(normalized);
}

/**
 * Constant-time string comparison (prevents timing attacks)
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {boolean} True if strings match
 */
function constantTimeCompare(a, b) {
  if (typeof a !== "string" || typeof b !== "string") {
    return false;
  }

  if (a.length !== b.length) {
    return false;
  }

  return crypto.timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

/**
 * Sanitize sensitive data for logging
 * @param {Object} data - Data object
 * @param {Array} sensitiveFields - Field names to mask
 * @returns {Object} Sanitized data
 */
function sanitizeForLogging(data, sensitiveFields = []) {
  if (!data || typeof data !== "object") {
    return data;
  }

  const defaultSensitiveFields = [
    "password",
    "token",
    "authorization",
    "cookie",
    "session",
    "secret",
    "apiKey",
    "api_key",
    "access_token",
    "refresh_token",
    "bearer",
  ];

  const fieldsToMask = [...defaultSensitiveFields, ...sensitiveFields];

  const sanitized = { ...data };

  Object.keys(sanitized).forEach((key) => {
    const lowerKey = key.toLowerCase();

    if (fieldsToMask.some((field) => lowerKey.includes(field.toLowerCase()))) {
      sanitized[key] = "***";
    } else if (typeof sanitized[key] === "object" && sanitized[key] !== null) {
      sanitized[key] = sanitizeForLogging(sanitized[key], sensitiveFields);
    }
  });

  return sanitized;
}

module.exports = {
  encrypt,
  decrypt,
  hash,
  hashWithSalt,
  verifyHash,
  generateToken,
  generateUUID,
  generateSessionCookie,
  hashResponseBody,
  constantTimeCompare,
  sanitizeForLogging,
};
