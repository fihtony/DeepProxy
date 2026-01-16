/**
 * Semantic Version Comparison Utilities
 *
 * Compares versions in semantic versioning format (major.minor.patch)
 * Examples:
 *   "6.9.0" < "6.10.0"  (minor: 9 < 10)
 *   "6.10.0" < "7.0.0"  (major: 6 < 7)
 *   "6.1" < "6.1.1"     (patch: 0 < 1)
 *   "6" < "6.0.1"       (missing patch: 0 < 1)
 */

/**
 * Parse version string into [major, minor, patch] array
 * @param {string} versionStr - Version string like "6.9.0", "6.9", or "6"
 * @returns {number[]} - [major, minor, patch] with defaults for missing parts
 */
export function parseVersion(versionStr) {
  if (!versionStr || typeof versionStr !== "string") {
    return [0, 0, 0];
  }

  const parts = versionStr.trim().split(".");
  const major = parseInt(parts[0], 10) || 0;
  const minor = parseInt(parts[1], 10) || 0;
  const patch = parseInt(parts[2], 10) || 0;

  return [major, minor, patch];
}

/**
 * Compare two semantic versions
 * @param {string} versionA - First version string
 * @param {string} versionB - Second version string
 * @returns {number} - -1 if A < B, 0 if A == B, 1 if A > B
 */
export function compareVersions(versionA, versionB) {
  const [aMajor, aMinor, aPatch] = parseVersion(versionA);
  const [bMajor, bMinor, bPatch] = parseVersion(versionB);

  // Compare major version
  if (aMajor !== bMajor) {
    return aMajor < bMajor ? -1 : 1;
  }

  // Compare minor version
  if (aMinor !== bMinor) {
    return aMinor < bMinor ? -1 : 1;
  }

  // Compare patch version
  if (aPatch !== bPatch) {
    return aPatch < bPatch ? -1 : 1;
  }

  return 0;
}

/**
 * Sort version strings in semantic version order
 * @param {string[]} versions - Array of version strings
 * @param {boolean} ascending - If true, sort ascending; if false, sort descending
 * @returns {string[]} - Sorted array (does not modify original)
 */
export function sortVersions(versions, ascending = true) {
  const sorted = [...versions];
  sorted.sort((a, b) => {
    const comparison = compareVersions(a, b);
    return ascending ? comparison : -comparison;
  });
  return sorted;
}
