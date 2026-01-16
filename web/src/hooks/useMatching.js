import { useCallback } from "react";
import {
  findClosestVersion,
  matchLanguage,
  matchPlatform,
  matchEnvironment,
  matchQueryParams,
  matchHeaders,
  calculateMatchScore,
  findBestMatch,
} from "../utils/matching";

/**
 * Custom hook for matching logic
 */
export const useMatching = () => {
  // Find closest version
  const getClosestVersion = useCallback((targetVersion, versionList) => {
    return findClosestVersion(targetVersion, versionList);
  }, []);

  // Match language with fallback
  const getLanguageMatch = useCallback((requestLang, availableResponses) => {
    return matchLanguage(requestLang, availableResponses);
  }, []);

  // Match platform
  const getPlatformMatch = useCallback((requestPlatform, availableResponses, exactMatch = true) => {
    return matchPlatform(requestPlatform, availableResponses, exactMatch);
  }, []);

  // Match environment
  const getEnvironmentMatch = useCallback((requestEnv, availableResponses, fallbackStrategy = "Exact") => {
    return matchEnvironment(requestEnv, availableResponses, fallbackStrategy);
  }, []);

  // Check query params match
  const checkQueryParamsMatch = useCallback((requestParams, configParams, responseParams) => {
    return matchQueryParams(requestParams, configParams, responseParams);
  }, []);

  // Check headers match
  const checkHeadersMatch = useCallback((requestHeaders, configHeaders, responseHeaders) => {
    return matchHeaders(requestHeaders, configHeaders, responseHeaders);
  }, []);

  // Calculate match score
  const getMatchScore = useCallback((request, response, config) => {
    return calculateMatchScore(request, response, config);
  }, []);

  // Find best match from available responses
  const getBestMatch = useCallback((request, availableResponses, config) => {
    return findBestMatch(request, availableResponses, config);
  }, []);

  // Filter responses by matching criteria
  const filterByMatching = useCallback((request, responses, config, threshold = 50) => {
    if (!responses || responses.length === 0) {
      return [];
    }

    return responses
      .map((response) => ({
        response,
        score: calculateMatchScore(request, response, config),
      }))
      .filter((item) => item.score >= threshold)
      .sort((a, b) => b.score - a.score)
      .map((item) => item.response);
  }, []);

  // Test if a response would match a request
  const testMatch = useCallback((request, response, config) => {
    const score = calculateMatchScore(request, response, config);
    return {
      matches: score >= 50, // 50% threshold
      score,
      reasons: {
        version: config.match_by_version ? request.version === response.version : null,
        platform: config.match_by_platform ? request.platform === response.platform : null,
        language: config.match_by_language ? request.language === response.language : null,
        environment: config.match_by_env ? request.environment === response.environment : null,
        queryParams: config.match_by_query_params
          ? matchQueryParams(request.queryParams, config.match_by_query_params, response.queryParams)
          : null,
        headers: config.match_by_headers ? matchHeaders(request.headers, config.match_by_headers, response.headers) : null,
      },
    };
  }, []);

  return {
    getClosestVersion,
    getLanguageMatch,
    getPlatformMatch,
    getEnvironmentMatch,
    checkQueryParamsMatch,
    checkHeadersMatch,
    getMatchScore,
    getBestMatch,
    filterByMatching,
    testMatch,
  };
};

export default useMatching;
