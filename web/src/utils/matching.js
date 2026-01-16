/**
 * Matching utilities for version, language, platform comparisons
 */

// Compare semantic versions
export const compareSemver = (v1, v2) => {
  const normalize = (v) => {
    if (!v) return [0, 0, 0];
    const parts = v.replace(/^v/, "").split(".");
    return [parseInt(parts[0]) || 0, parseInt(parts[1]) || 0, parseInt(parts[2]) || 0];
  };

  const [major1, minor1, patch1] = normalize(v1);
  const [major2, minor2, patch2] = normalize(v2);

  if (major1 !== major2) return major1 - major2;
  if (minor1 !== minor2) return minor1 - minor2;
  return patch1 - patch2;
};

// Calculate version distance
export const versionDistance = (v1, v2) => {
  const normalize = (v) => {
    if (!v) return [0, 0, 0];
    const parts = v.replace(/^v/, "").split(".");
    return [parseInt(parts[0]) || 0, parseInt(parts[1]) || 0, parseInt(parts[2]) || 0];
  };

  const [major1, minor1, patch1] = normalize(v1);
  const [major2, minor2, patch2] = normalize(v2);

  // Weight: major=10000, minor=100, patch=1
  return Math.abs((major1 - major2) * 10000 + (minor1 - minor2) * 100 + (patch1 - patch2));
};

// Find closest version from a list
export const findClosestVersion = (targetVersion, versionList) => {
  if (!targetVersion || !versionList || versionList.length === 0) {
    return null;
  }

  let closest = versionList[0];
  let minDistance = versionDistance(targetVersion, closest);

  for (let i = 1; i < versionList.length; i++) {
    const distance = versionDistance(targetVersion, versionList[i]);
    if (distance < minDistance) {
      minDistance = distance;
      closest = versionList[i];
    }
  }

  return closest;
};

// Check if version matches exactly
export const isExactVersionMatch = (v1, v2) => {
  const normalize = (v) => v?.replace(/^v/, "").toLowerCase() || "";
  return normalize(v1) === normalize(v2);
};

// Match language with fallback
export const matchLanguage = (requestLang, availableResponses) => {
  if (!requestLang || !availableResponses || availableResponses.length === 0) {
    return null;
  }

  const normalizeLang = (lang) => lang?.toLowerCase().replace(/[-_]/g, "") || "";
  const targetLang = normalizeLang(requestLang);

  // Try exact match first
  let match = availableResponses.find((res) => normalizeLang(res.language) === targetLang);

  if (match) return match;

  // Try language code only (e.g., 'en' from 'en-US')
  const langCode = requestLang.split(/[-_]/)[0].toLowerCase();
  match = availableResponses.find((res) => res.language?.toLowerCase().startsWith(langCode));

  if (match) return match;

  // Fallback to 'en' or first available
  match = availableResponses.find((res) => res.language?.toLowerCase().startsWith("en"));
  return match || availableResponses[0];
};

// Match platform
export const matchPlatform = (requestPlatform, availableResponses, exactMatch = true) => {
  if (!requestPlatform || !availableResponses || availableResponses.length === 0) {
    return null;
  }

  const normalizePlatform = (p) => p?.toLowerCase() || "";
  const targetPlatform = normalizePlatform(requestPlatform);

  // Exact match
  const exactMatches = availableResponses.filter((res) => normalizePlatform(res.platform) === targetPlatform);

  if (exactMatches.length > 0) {
    return exactMatches[0];
  }

  // If exact match required, return null
  if (exactMatch) {
    return null;
  }

  // Fallback to any platform
  return availableResponses[0];
};

// Match environment with fallback logic
export const matchEnvironment = (requestEnv, availableResponses, fallbackStrategy = "Exact") => {
  if (!requestEnv || !availableResponses || availableResponses.length === 0) {
    return null;
  }

  const normalizeEnv = (env) => env?.toLowerCase() || "";
  const targetEnv = normalizeEnv(requestEnv);

  // Exact match
  const exactMatches = availableResponses.filter((res) => normalizeEnv(res.environment) === targetEnv);

  if (exactMatches.length > 0) {
    return exactMatches[0];
  }

  // Apply fallback strategy
  if (fallbackStrategy === "Exact") {
    return null;
  }

  const fallbackOrder = {
    sit: ["sit", "dev", "stage", "prod"],
    stage: ["stage", "sit", "dev", "prod"],
    prod: ["prod", "stage", "sit", "dev"],
    dev: ["dev", "sit", "stage", "prod"],
  };

  const order = fallbackOrder[targetEnv] || ["sit", "dev", "stage", "prod"];

  for (const env of order) {
    const match = availableResponses.find((res) => normalizeEnv(res.environment) === env);
    if (match) return match;
  }

  return availableResponses[0];
};

// Match query parameters
export const matchQueryParams = (requestParams, configParams, responseParams) => {
  if (!configParams || configParams.length === 0) {
    return true; // No query param matching required
  }

  const requestParamObj = requestParams || {};
  const responseParamObj = responseParams || {};

  // All configured params must match
  for (const param of configParams) {
    if (requestParamObj[param] !== responseParamObj[param]) {
      return false;
    }
  }

  return true;
};

// Match headers
export const matchHeaders = (requestHeaders, configHeaders, responseHeaders) => {
  if (!configHeaders || configHeaders.length === 0) {
    return true; // No header matching required
  }

  const normalizeKey = (key) => key?.toLowerCase() || "";

  const requestHeaderObj = requestHeaders || {};
  const responseHeaderObj = responseHeaders || {};

  // All configured headers must match
  for (const header of configHeaders) {
    const normalizedHeader = normalizeKey(header);

    const requestValue = Object.keys(requestHeaderObj).find((key) => normalizeKey(key) === normalizedHeader);
    const responseValue = Object.keys(responseHeaderObj).find((key) => normalizeKey(key) === normalizedHeader);

    if (!requestValue || !responseValue || requestHeaderObj[requestValue] !== responseHeaderObj[responseValue]) {
      return false;
    }
  }

  return true;
};

// Calculate matching score
export const calculateMatchScore = (request, response, config) => {
  let score = 0;
  let maxScore = 0;

  // Version matching (weight: 40)
  if (config.match_by_version) {
    maxScore += 40;
    if (request.version && response.version) {
      if (isExactVersionMatch(request.version, response.version)) {
        score += 40;
      } else {
        const distance = versionDistance(request.version, response.version);
        score += Math.max(0, 40 - distance);
      }
    }
  }

  // Platform matching (weight: 20)
  if (config.match_by_platform) {
    maxScore += 20;
    if (request.platform === response.platform) {
      score += 20;
    }
  }

  // Language matching (weight: 15)
  if (config.match_by_language) {
    maxScore += 15;
    if (request.language === response.language) {
      score += 15;
    }
  }

  // Environment matching (weight: 15)
  if (config.match_by_env) {
    maxScore += 15;
    if (request.environment === response.environment) {
      score += 15;
    }
  }

  // Query params matching (weight: 5)
  if (config.match_by_query_params && config.match_by_query_params.length > 0) {
    maxScore += 5;
    if (matchQueryParams(request.queryParams, config.match_by_query_params, response.queryParams)) {
      score += 5;
    }
  }

  // Headers matching (weight: 5)
  if (config.match_by_headers && config.match_by_headers.length > 0) {
    maxScore += 5;
    if (matchHeaders(request.headers, config.match_by_headers, response.headers)) {
      score += 5;
    }
  }

  return maxScore > 0 ? (score / maxScore) * 100 : 0;
};

// Find best matching response
export const findBestMatch = (request, availableResponses, config) => {
  if (!availableResponses || availableResponses.length === 0) {
    return null;
  }

  let bestMatch = null;
  let bestScore = -1;

  for (const response of availableResponses) {
    const score = calculateMatchScore(request, response, config);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = response;
    }
  }

  return bestMatch;
};

export default {
  compareSemver,
  versionDistance,
  findClosestVersion,
  isExactVersionMatch,
  matchLanguage,
  matchPlatform,
  matchEnvironment,
  matchQueryParams,
  matchHeaders,
  calculateMatchScore,
  findBestMatch,
};
