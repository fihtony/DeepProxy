/**
 * Statistics Routes
 *
 * Provides API endpoints for statistics data used by the Web UI dashboard
 *
 * Routes:
 * - GET    /api/stats              - Get overall statistics with breakdowns
 * - GET    /api/stats/endpoint/:name - Get statistics for specific endpoint
 */

const express = require("express");
const router = express.Router();
const logger = require("../../utils/logger");
const statsRepository = require("../../database/repositories/stats_repository");
const { getLocalISOString } = require("../../utils/datetimeUtils");
const { getEndpointType } = require("../../utils/endpoint_utils");

/**
 * Initialize routes
 * @param {Object} db - Database connection
 * @returns {express.Router} Express router
 */
function initializeRoutes(db) {
  /**
   * GET /api/stats
   * Get overall statistics with breakdowns
   *
   * Query Parameters:
   * - time_window: 'today' | 'week' | 'month' | 'all' (default: 'today')
   * - start_date: YYYY-MM-DD (optional)
   * - end_date: YYYY-MM-DD (optional)
   * - environment: sit | stage | dev | prod (optional)
   * - platform: android | ios (optional)
   */
  router.get("/", async (req, res) => {
    try {
      const { time_window = "today", start_date, end_date, environment, platform, endpoint_type } = req.query;

      // Calculate date range based on time_window
      let startDate, endDate;
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      switch (time_window) {
        case "15m":
          endDate = new Date();
          startDate = new Date(endDate);
          startDate.setMinutes(endDate.getMinutes() - 15);
          break;
        case "30m":
          endDate = new Date();
          startDate = new Date(endDate);
          startDate.setMinutes(endDate.getMinutes() - 30);
          break;
        case "1h":
          endDate = new Date();
          startDate = new Date(endDate);
          startDate.setHours(endDate.getHours() - 1);
          break;
        case "2h":
          endDate = new Date();
          startDate = new Date(endDate);
          startDate.setHours(endDate.getHours() - 2);
          break;
        case "4h":
          endDate = new Date();
          startDate = new Date(endDate);
          startDate.setHours(endDate.getHours() - 4);
          break;
        case "8h":
          endDate = new Date();
          startDate = new Date(endDate);
          startDate.setHours(endDate.getHours() - 8);
          break;
        case "1d":
        case "today":
          endDate = new Date();
          startDate = new Date(endDate);
          startDate.setHours(endDate.getHours() - 24);
          break;
        case "3d":
          endDate = new Date();
          startDate = new Date(endDate);
          startDate.setDate(endDate.getDate() - 3);
          startDate.setHours(0, 0, 0, 0); // Start of day 3 days ago
          break;
        case "7d":
        case "week":
          endDate = new Date();
          startDate = new Date(endDate);
          startDate.setDate(endDate.getDate() - 7);
          startDate.setHours(0, 0, 0, 0); // Start of day 7 days ago
          break;
        case "15d":
          endDate = new Date();
          startDate = new Date(endDate);
          startDate.setDate(endDate.getDate() - 15);
          startDate.setHours(0, 0, 0, 0); // Start of day 15 days ago
          break;
        case "30d":
        case "month":
          endDate = new Date();
          startDate = new Date(endDate);
          startDate.setMonth(endDate.getMonth() - 1);
          startDate.setHours(0, 0, 0, 0); // Start of day 1 month ago
          break;
        case "all":
          startDate = null;
          endDate = null;
          break;
        default:
          startDate = start_date ? new Date(start_date) : today;
          endDate = end_date ? new Date(end_date) : new Date();
      }

      // Format dates as YYYY-MM-DD (for logging/debugging)
      const startDateStr = startDate ? startDate.toISOString().split("T")[0] : null;
      const endDateStr = endDate ? endDate.toISOString().split("T")[0] : null;

      // Log date ranges for debugging
      logger.debug("Stats API date range", {
        time_window,
        startDate: startDate ? getLocalISOString(startDate) : null,
        endDate: endDate ? getLocalISOString(endDate) : null,
        startDateStr,
        endDateStr,
      });

      // Build filters (using the correct parameter names for stats_repository)
      // Use local timezone ISO format for date comparisons (timezone-aware)
      const filters = {};
      if (startDate) filters.startDate = getLocalISOString(startDate);
      if (endDate) filters.endDate = getLocalISOString(endDate);
      if (environment) filters.appEnvironment = environment;
      if (platform) filters.appPlatform = platform;
      // Pass time_window to repository for precision decision
      filters.timeWindow = time_window;

      // Get aggregated statistics
      const aggregatedStats = statsRepository.getAggregatedStats(filters);

      // Transform data for Web UI
      const summary = {
        totalRequests: aggregatedStats.total_requests || 0,
        successfulRequests: aggregatedStats.successful_requests || 0,
        failedRequests: aggregatedStats.failed_requests || 0,
        avgDurationMs: aggregatedStats.avg_duration_ms || 0,
        successRate: aggregatedStats.success_rate || "0.00",
      };

      // Get breakdowns
      const byEndpoint = statsRepository.getStatsByEndpoint(filters) || [];
      const byPlatform = statsRepository.getStatsByPlatform(filters) || [];
      const byEnvironment = statsRepository.getStatsByEnvironment(filters) || [];

      // Transform endpoint data with type classification
      let transformedEndpoints = byEndpoint.map((ep) => {
        const epType = getEndpointType(ep.endpoint_path || "");
        const successRate = ep.total_requests > 0 ? ((ep.successful_requests / ep.total_requests) * 100).toFixed(2) : "0.00";
        return {
          endpoint_path: ep.endpoint_path || "",
          method: ep.method || "",
          endpoint_type: epType,
          total_requests: ep.total_requests || 0,
          successful_requests: ep.successful_requests || 0,
          failed_requests: ep.failed_requests || 0,
          success_rate: successRate,
          avg_duration_ms: ep.avg_duration_ms || 0,
        };
      });

      // Filter by endpoint_type if specified
      if (endpoint_type && endpoint_type !== "all") {
        transformedEndpoints = transformedEndpoints.filter((ep) => ep.endpoint_type === endpoint_type);
      }

      // Transform platform data
      const transformedPlatforms = byPlatform.map((p) => ({
        app_platform: p.app_platform || "",
        total_requests: p.total_requests || 0,
        successful_requests: p.successful_requests || 0,
        failed_requests: p.failed_requests || 0,
        avg_duration_ms: p.avg_duration_ms || 0,
      }));

      // Transform environment data
      const transformedEnvironments = byEnvironment.map((e) => ({
        app_environment: e.app_environment || "",
        total_requests: e.total_requests || 0,
        successful_requests: e.successful_requests || 0,
        failed_requests: e.failed_requests || 0,
        avg_duration_ms: e.avg_duration_ms || 0,
      }));

      // Get time series data (for charts)
      // Generate 30-50 data points based on time window
      const timeSeriesData = [];
      if (startDate && endDate) {
        const db = require("../../database/connection");
        const database = db.getDatabase();

        // Use the actual startDate and endDate objects directly
        // startDate is already set correctly (midnight for longer periods, current time minus window for shorter)
        const start = new Date(startDate);
        // Use current time as end (not end of day) to ensure last point is exactly current time
        const end = new Date(endDate);
        // Don't set to end of day - use actual current time so last point matches current time

        // Log the actual date range being used for time series
        logger.debug("Time series date range", {
          time_window,
          start: getLocalISOString(start),
          end: getLocalISOString(end),
          startTime: start.getTime(),
          endTime: end.getTime(),
        });

        // Determine number of points and interval based on time window
        let numPoints = 30;
        let intervalMs = 0;

        switch (time_window) {
          case "15m":
            numPoints = 30;
            intervalMs = 30 * 1000; // 30 seconds
            break;
          case "30m":
            numPoints = 30;
            intervalMs = 60 * 1000; // 1 minute
            break;
          case "1h":
            numPoints = 30;
            intervalMs = 2 * 60 * 1000; // 2 minutes
            break;
          case "2h":
            numPoints = 24;
            intervalMs = 5 * 60 * 1000; // 5 minutes
            break;
          case "4h":
            numPoints = 24;
            intervalMs = 10 * 60 * 1000; // 10 minutes
            break;
          case "8h":
            numPoints = 32;
            intervalMs = 15 * 60 * 1000; // 15 minutes
            break;
          case "1d":
          case "today":
            numPoints = 24;
            intervalMs = 1 * 60 * 1000; // 1 hour
            break;
          case "3d":
            numPoints = 36;
            intervalMs = 2 * 60 * 60 * 1000; // 2 hours
            break;
          case "7d":
          case "week":
            numPoints = 28;
            intervalMs = 6 * 60 * 60 * 1000; // 6 hours
            break;
          case "15d":
            numPoints = 30;
            intervalMs = 12 * 60 * 60 * 1000; // 12 hours
            break;
          case "30d":
          case "month":
            numPoints = 30;
            intervalMs = 24 * 60 * 60 * 1000; // 24 hours (1 day)
            break;
          default:
            const timeWindowMs = end.getTime() - start.getTime();
            numPoints = Math.min(50, Math.max(30, Math.floor(timeWindowMs / (60 * 60 * 1000))));
            intervalMs = timeWindowMs / numPoints;
        }

        // Generate time series data from oldest (left) to newest (right)
        // Use stats table with created_at timestamp for precise time window calculations
        // Each point represents statistics for a specific time interval (e.g., 30 seconds for "15m")
        // Generate intervals backward from end time (current time) to ensure last point is exactly current time
        const endTime = end.getTime();
        const startTime = start.getTime();
        const totalTimeMs = endTime - startTime;

        // Calculate actual interval based on total time and number of points
        // This ensures intervals fit exactly within the time window
        const actualIntervalMs = totalTimeMs / numPoints;

        // Generate points backward from end time (current time) to start time
        // Similar to frontend generateTimeSeriesData: for (let i = intervals - 1; i >= 0; i--)
        // This ensures the last point (i=0) is exactly at current time
        for (let i = numPoints - 1; i >= 0; i--) {
          // Calculate time point: endTime - (i * actualIntervalMs)
          // For i = numPoints - 1: endTime - ((numPoints - 1) * actualIntervalMs) = startTime + actualIntervalMs
          // For i = 0: endTime - 0 = endTime (current time) ✓
          const pointTime = endTime - i * actualIntervalMs;

          // Calculate interval boundaries for this point
          // Interval covers [pointTime - actualIntervalMs, pointTime]
          const intervalStartTime = Math.max(startTime, pointTime - actualIntervalMs);
          const intervalEndTime = pointTime;

          const intervalStart = new Date(intervalStartTime);
          const intervalEnd = new Date(intervalEndTime);

          // For the last point (i === 0), ensure it ends exactly at current time
          if (i === 0) {
            intervalEnd.setTime(endTime);
          }

          // Query stats table for requests within this exact time interval
          // Use created_at timestamp for precise time window matching
          // Note: SQLite stores datetime as TEXT, so we compare as strings for timezone-aware formats
          // For timezone-aware strings, we can compare directly or use datetime() function
          let sql = `
            SELECT 
              app_platform,
              response_status,
              COUNT(*) as request_count
            FROM stats
            WHERE created_at >= ?
              AND created_at < ?
          `;
          // Use local timezone ISO format for comparison (SQLite will handle string comparison)
          const params = [getLocalISOString(intervalStart), getLocalISOString(intervalEnd)];

          // Apply filters if provided
          if (environment) {
            sql += " AND app_environment = ?";
            params.push(environment);
          }
          if (platform) {
            sql += " AND app_platform = ?";
            params.push(platform);
          }

          sql += " GROUP BY app_platform, response_status";

          const stmt = database.prepare(sql);
          const intervalResults = stmt.all(...params);

          // Aggregate results by platform and success/failure
          // Success: status 200-299, Failure: all other status codes
          let androidSuccess = 0;
          let androidFailed = 0;
          let iosSuccess = 0;
          let iosFailed = 0;

          intervalResults.forEach((row) => {
            const platform = (row.app_platform || "").toLowerCase();
            const count = row.request_count || 0;
            const status = row.response_status || 0;
            const isSuccessful = status >= 200 && status < 300;

            if (platform === "android") {
              if (isSuccessful) {
                androidSuccess += count;
              } else {
                androidFailed += count;
              }
            } else if (platform === "ios") {
              if (isSuccessful) {
                iosSuccess += count;
              } else {
                iosFailed += count;
              }
            }
          });

          // Store interval start time in local timezone format (ISO 8601 with timezone offset)
          // The time represents the start of the interval window
          // Store the interval end time (which is the point's timestamp) for display
          timeSeriesData.push({
            time: getLocalISOString(intervalEnd), // Store interval end time (the point's timestamp)
            android_success: androidSuccess,
            android_failed: androidFailed,
            ios_success: iosSuccess,
            ios_failed: iosFailed,
          });
        }

        // Ensure data is sorted by time (oldest first, newest last)
        // This ensures leftmost point is oldest (start time), rightmost point is newest (current time)
        timeSeriesData.sort((a, b) => new Date(a.time) - new Date(b.time));
      }

      res.json({
        success: true,
        data: {
          summary,
          breakdown: [], // Deprecated, use byEndpoint instead
          byEndpoint: transformedEndpoints,
          byPlatform: transformedPlatforms,
          byEnvironment: transformedEnvironments,
          timeSeriesData,
        },
      });
    } catch (error) {
      logger.error("Failed to get statistics", { error: error.message });
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * GET /api/stats/endpoint/:endpointName
   * Get statistics for a specific endpoint
   */
  router.get("/endpoint/:endpointName", async (req, res) => {
    try {
      const { endpointName } = req.params;
      const { start_date, end_date, environment, platform } = req.query;

      const filters = {
        endpointPath: endpointName,
        ...(start_date && { startDate: start_date }),
        ...(end_date && { endDate: end_date }),
        ...(environment && { mobileEnvironment: environment }),
        ...(platform && { mobilePlatform: platform }),
      };

      const stats = statsRepository.getAggregatedStats(filters);

      res.json({
        success: true,
        data: stats,
      });
    } catch (error) {
      logger.error("Failed to get endpoint statistics", {
        error: error.message,
        endpoint: req.params.endpointName,
      });
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  return router;
}

module.exports = initializeRoutes;
