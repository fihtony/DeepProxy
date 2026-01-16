/**
 * DateTime Utilities
 * 
 * Provides functions for consistent datetime handling with local timezone support.
 * All timestamps stored in the database should use local timezone with timezone offset.
 */

/**
 * Get current datetime in ISO 8601 format with local timezone offset
 * Example: "2025-12-15T10:30:00-05:00" (instead of UTC "2025-12-15T10:30:00.000Z")
 * 
 * @param {Date} date - Optional date object (defaults to current time)
 * @returns {string} ISO 8601 datetime string with timezone offset
 */
function getLocalISOString(date = new Date()) {
  const tzOffset = -date.getTimezoneOffset();
  const sign = tzOffset >= 0 ? '+' : '-';
  const absOffset = Math.abs(tzOffset);
  const hours = Math.floor(absOffset / 60);
  const minutes = absOffset % 60;
  const offsetStr = `${sign}${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  
  // Format: YYYY-MM-DDTHH:mm:ss+/-HH:mm
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours24 = String(date.getHours()).padStart(2, '0');
  const mins = String(date.getMinutes()).padStart(2, '0');
  const secs = String(date.getSeconds()).padStart(2, '0');
  
  return `${year}-${month}-${day}T${hours24}:${mins}:${secs}${offsetStr}`;
}

/**
 * Convert a Date object or ISO string to local timezone ISO format
 * 
 * @param {Date|string} date - Date object or ISO string
 * @returns {string} ISO 8601 datetime string with timezone offset
 */
function toLocalISOString(date) {
  const dateObj = date instanceof Date ? date : new Date(date);
  return getLocalISOString(dateObj);
}

/**
 * Parse a local timezone ISO string back to Date object
 * Handles both UTC (Z) and timezone offset formats
 * 
 * @param {string} isoString - ISO 8601 datetime string
 * @returns {Date} Date object
 */
function parseLocalISOString(isoString) {
  return new Date(isoString);
}

module.exports = {
  getLocalISOString,
  toLocalISOString,
  parseLocalISOString,
};

