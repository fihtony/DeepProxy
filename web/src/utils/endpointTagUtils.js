/**
 * Endpoint Tag Utilities
 *
 * Utilities for applying endpoint classification tags to service endpoints.
 * Handles pattern matching and tag application based on configured rules.
 */

/**
 * Get tags for a specific endpoint path
 * @param {string} path - The endpoint path (e.g., "/api/user/123")
 * @param {Object} endpointConfig - The endpoint configuration with tags array
 * @returns {Array} Array of matching tags with name and color
 */
export function getEndpointTags(path, endpointConfig) {
  if (!endpointConfig || !endpointConfig.tags || !Array.isArray(endpointConfig.tags)) {
    return [];
  }

  return endpointConfig.tags.filter((tag) => {
    try {
      const regex = new RegExp(tag.pattern);
      return regex.test(path);
    } catch (error) {
      console.warn(`Invalid regex pattern for tag "${tag.name}": ${tag.pattern}`, error);
      return false;
    }
  });
}

/**
 * Apply tags to a list of endpoints
 * @param {Array} endpoints - Array of endpoint objects with name/path property
 * @param {Object} endpointConfig - The endpoint configuration with tags
 * @param {string} pathProperty - Property name that contains the endpoint path (default: "name")
 * @returns {Array} Endpoints with applied tags
 */
export function applyTagsToEndpoints(endpoints, endpointConfig, pathProperty = "name") {
  if (!Array.isArray(endpoints)) {
    return [];
  }

  return endpoints.map((endpoint) => {
    const path = endpoint[pathProperty];
    if (!path) {
      return endpoint;
    }

    const tags = getEndpointTags(path, endpointConfig);
    return {
      ...endpoint,
      tags,
      // Add a flag to indicate if tags have been applied
      tagsApplied: true,
    };
  });
}

/**
 * Apply tags to a single endpoint object
 * @param {Object} endpoint - Single endpoint object
 * @param {Object} endpointConfig - The endpoint configuration with tags
 * @param {string} pathProperty - Property name that contains the endpoint path
 * @returns {Object} Endpoint with applied tags
 */
export function applyTagsToEndpoint(endpoint, endpointConfig, pathProperty = "name") {
  if (!endpoint || !endpointConfig) {
    return endpoint;
  }

  const path = endpoint[pathProperty];
  if (!path) {
    return endpoint;
  }

  const tags = getEndpointTags(path, endpointConfig);
  return {
    ...endpoint,
    tags,
    tagsApplied: true,
  };
}

/**
 * Get endpoint type for a path based on type rules
 * @param {string} path - The endpoint path
 * @param {Object} endpointConfig - The endpoint configuration with types array
 * @returns {string} The endpoint type name (e.g., "secure", "public")
 */
export function getEndpointType(path, endpointConfig) {
  if (!endpointConfig || !endpointConfig.types || !Array.isArray(endpointConfig.types)) {
    return endpointConfig?.fallback || "public";
  }

  // Sort by priority
  const sortedTypes = [...endpointConfig.types].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));

  for (const type of sortedTypes) {
    if (!type.patterns || !Array.isArray(type.patterns)) {
      continue;
    }

    for (const pattern of type.patterns) {
      try {
        const regex = new RegExp(pattern);
        if (regex.test(path)) {
          return type.name;
        }
      } catch (error) {
        console.warn(`Invalid regex pattern for type "${type.name}": ${pattern}`, error);
      }
    }
  }

  return endpointConfig?.fallback || "public";
}

/**
 * Get the first matching tag (as type) for a path, or return default type
 * @param {string} path - The endpoint path
 * @param {Object} endpointConfig - The endpoint configuration with tags and types
 * @param {string} defaultType - The default type to use if no tag matches (e.g., 'public', 'secure')
 * @returns {Object} Tag object with name and color, or default type object
 */
export function getEndpointTypeTag(path, endpointConfig, defaultType = "public") {
  // First, check if there's a matching tag rule
  if (path && endpointConfig && endpointConfig.tags && Array.isArray(endpointConfig.tags)) {
    for (const tag of endpointConfig.tags) {
      try {
        const regex = new RegExp(tag.pattern);
        if (regex.test(path)) {
          return {
            name: tag.name,
            color: tag.color || "#999999",
          };
        }
      } catch (error) {
        console.warn(`Invalid regex pattern for tag "${tag.name}": ${tag.pattern}`, error);
      }
    }
  }

  // If no tag matches, use the provided defaultType
  const defaultColors = {
    secure: "#942fd3",
    public: "#4CAF50",
  };

  return {
    name: defaultType,
    color: defaultColors[defaultType] || "#4CAF50",
  };
}

/**
 * Create a tag chip object for UI rendering
 * @param {Object} tag - Tag object with name and color
 * @returns {Object} Tag chip object for UI
 */
export function createTagChip(tag) {
  if (!tag) {
    return null;
  }

  return {
    label: tag.name,
    color: tag.color || "#999999",
    key: `${tag.name}-${tag.pattern}`,
  };
}

/**
 * Format tags for display (comma-separated string)
 * @param {Array} tags - Array of tag objects
 * @returns {string} Comma-separated tag names
 */
export function formatTagsForDisplay(tags) {
  if (!Array.isArray(tags) || tags.length === 0) {
    return "-";
  }

  return tags.map((tag) => tag.name).join(", ");
}

export default {
  getEndpointTags,
  getEndpointTypeTag,
  applyTagsToEndpoints,
  applyTagsToEndpoint,
  getEndpointType,
  createTagChip,
  formatTagsForDisplay,
};
