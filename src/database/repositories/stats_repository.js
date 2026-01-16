/**
 * Statistics Repository
 *
 * Manages performance statistics and metrics aggregation.
 * Tracks request counts, success rates, and response times.
 */

const db = require("../connection");
const logger = require("../../utils/logger");
const { getLocalISOString } = require("../../utils/datetimeUtils");

class StatsRepository {
  /**
   * Record a single request in statistics
   * @param {string} endpointPath - Endpoint path
   * @param {string} appEnvironment - Environment
   * @param {string} appPlatform - Platform
   * @param {number} responseStatus - HTTP response status
   * @param {number} responseLength - Response body length
   * @param {number} latencyMs - Response latency
   * @param {string} method - HTTP method (GET, POST, PUT, DELETE, PATCH)
   * @param {string} host - Request host
   * @param {string} appVersion - App version
   */
  recordRequest(
    endpointPath,
    appEnvironment,
    appPlatform,
    responseStatus,
    responseLength,
    latencyMs,
    method = "GET",
    host = "unknown",
    appVersion = "unknown"
  ) {
    try {
      const database = db.getDatabase();
      const createdAt = getLocalISOString();
      const stmt = database.prepare(`
        INSERT INTO stats (
          host,
          endpoint_path,
          method,
          app_platform,
          app_version,
          app_environment,
          response_status,
          response_length,
          latency_ms,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(host, endpointPath, method, appPlatform, appVersion, appEnvironment, responseStatus, responseLength, latencyMs, createdAt);
    } catch (error) {
      logger.error("Failed to record request statistics:", error);
      // Don't throw - stats recording should not break main flow
    }
  }

  /**
   * Get statistics for a specific date range
   * @param {Object} filters - Filter parameters
   * @returns {Array} Statistics records
   */
  getStats(filters = {}) {
    try {
      const database = db.getDatabase();
      let sql = "SELECT * FROM stats WHERE 1=1";
      const params = [];

      if (filters.endpointPath) {
        sql += " AND endpoint_path = ?";
        params.push(filters.endpointPath);
      }

      if (filters.appEnvironment) {
        sql += " AND app_environment = ?";
        params.push(filters.appEnvironment);
      }

      if (filters.appPlatform) {
        sql += " AND app_platform = ?";
        params.push(filters.appPlatform);
      }

      if (filters.startDate) {
        sql += " AND created_at >= ?";
        // Extract just the date part from ISO timestamp (YYYY-MM-DD)
        const startDateStr = filters.startDate.split("T")[0];
        params.push(startDateStr);
      }

      if (filters.endDate) {
        sql += " AND created_at < date(?, '+1 day')";
        // Extract just the date part from ISO timestamp (YYYY-MM-DD)
        const endDateStr = filters.endDate.split("T")[0];
        params.push(endDateStr);
      }

      sql += " ORDER BY created_at DESC, endpoint_path";

      const stmt = database.prepare(sql);
      return stmt.all(...params);
    } catch (error) {
      logger.error("Failed to get statistics:", error);
      throw error;
    }
  }

  /**
   * Get aggregated statistics across all endpoints
   * @param {Object} filters - Filter parameters
   * @returns {Object} Aggregated stats
   */
  getAggregatedStats(filters = {}) {
    try {
      const database = db.getDatabase();
      let sql = `
        SELECT 
          COUNT(*) as total_requests,
          SUM(CASE WHEN response_status >= 200 AND response_status < 300 THEN 1 ELSE 0 END) as successful_requests,
          SUM(CASE WHEN response_status < 200 OR response_status >= 300 THEN 1 ELSE 0 END) as failed_requests,
          CAST(AVG(latency_ms) AS INTEGER) as avg_duration_ms
        FROM stats WHERE 1=1
      `;
      const params = [];

      // For short time windows (<=4h), use full ISO timestamp comparison for consistency with time series data
      // For longer windows, use date-based comparison for better performance
      const shortTimeWindows = ["15m", "30m", "1h", "2h", "4h", "8h"];
      const useFullTimestamp = shortTimeWindows.includes(filters.timeWindow);

      if (filters.startDate) {
        if (useFullTimestamp) {
          // Use full ISO timestamp for precise matching
          sql += " AND created_at >= ?";
          params.push(filters.startDate); // Full: "2026-01-09T15:31:34-05:00"
        } else {
          // Use date only for longer windows (optimization)
          sql += " AND created_at >= ?";
          const startDateStr = filters.startDate.split("T")[0]; // Extract: "2026-01-09"
          params.push(startDateStr);
        }
      }

      if (filters.endDate) {
        if (useFullTimestamp) {
          // Use full ISO timestamp for precise matching
          sql += " AND created_at < ?";
          params.push(filters.endDate); // Full: "2026-01-09T16:31:34-05:00"
        } else {
          // Use date arithmetic for longer windows (optimization)
          sql += " AND created_at < date(?, '+1 day')";
          const endDateStr = filters.endDate.split("T")[0]; // Extract: "2026-01-09"
          params.push(endDateStr);
        }
      }

      if (filters.mobileEnvironment) {
        sql += " AND app_environment = ?";
        params.push(filters.mobileEnvironment);
      }

      if (filters.mobilePlatform) {
        sql += " AND app_platform = ?";
        params.push(filters.mobilePlatform);
      }

      const stmt = database.prepare(sql);
      const result = stmt.get(...params);

      return {
        total_requests: result.total_requests || 0,
        successful_requests: result.successful_requests || 0,
        failed_requests: result.failed_requests || 0,
        success_rate: result.total_requests > 0 ? ((result.successful_requests / result.total_requests) * 100).toFixed(2) : 0,
        avg_duration_ms: result.avg_duration_ms || 0,
      };
    } catch (error) {
      logger.error("Failed to get aggregated statistics:", error);
      throw error;
    }
  }

  /**
   * Get statistics grouped by endpoint
   * @param {Object} filters - Filter parameters
   * @returns {Array} Stats grouped by endpoint
   */
  getStatsByEndpoint(filters = {}) {
    try {
      const database = db.getDatabase();
      let sql = `
        SELECT 
          endpoint_path,
          method,
          COUNT(*) as total_requests,
          SUM(CASE WHEN response_status >= 200 AND response_status < 300 THEN 1 ELSE 0 END) as successful_requests,
          SUM(CASE WHEN response_status < 200 OR response_status >= 300 THEN 1 ELSE 0 END) as failed_requests,
          CAST(AVG(latency_ms) AS INTEGER) as avg_duration_ms
        FROM stats WHERE 1=1
      `;
      const params = [];

      // Use full timestamp for short windows, date-only for longer windows
      const shortTimeWindows = ["15m", "30m", "1h", "2h", "4h"];
      const useFullTimestamp = shortTimeWindows.includes(filters.timeWindow);

      if (filters.startDate) {
        if (useFullTimestamp) {
          sql += " AND created_at >= ?";
          params.push(filters.startDate);
        } else {
          sql += " AND created_at >= ?";
          const startDateStr = filters.startDate.split("T")[0];
          params.push(startDateStr);
        }
      }

      if (filters.endDate) {
        if (useFullTimestamp) {
          sql += " AND created_at < ?";
          params.push(filters.endDate);
        } else {
          sql += " AND created_at < date(?, '+1 day')";
          const endDateStr = filters.endDate.split("T")[0];
          params.push(endDateStr);
        }
      }

      if (filters.appEnvironment) {
        sql += " AND app_environment = ?";
        params.push(filters.appEnvironment);
      }

      if (filters.appPlatform) {
        sql += " AND app_platform = ?";
        params.push(filters.appPlatform);
      }

      sql += " GROUP BY endpoint_path, method ORDER BY total_requests DESC";

      const stmt = database.prepare(sql);
      return stmt.all(...params);
    } catch (error) {
      logger.error("Failed to get stats by endpoint:", error);
      throw error;
    }
  }

  /**
   * Get statistics grouped by platform
   * @param {Object} filters - Filter parameters
   * @returns {Object} Stats by platform
   */
  getStatsByPlatform(filters = {}) {
    try {
      let sql = `
        SELECT 
          app_platform,
          COUNT(*) as total_requests,
          SUM(CASE WHEN response_status >= 200 AND response_status < 300 THEN 1 ELSE 0 END) as successful_requests,
          SUM(CASE WHEN response_status < 200 OR response_status >= 300 THEN 1 ELSE 0 END) as failed_requests
        FROM stats WHERE 1=1
      `;
      const params = [];

      // Use full timestamp for short windows, date-only for longer windows
      const shortTimeWindows = ["15m", "30m", "1h", "2h", "4h"];
      const useFullTimestamp = shortTimeWindows.includes(filters.timeWindow);

      if (filters.startDate) {
        if (useFullTimestamp) {
          sql += " AND created_at >= ?";
          params.push(filters.startDate);
        } else {
          sql += " AND created_at >= ?";
          const startDateStr = filters.startDate.split("T")[0];
          params.push(startDateStr);
        }
      }

      if (filters.endDate) {
        if (useFullTimestamp) {
          sql += " AND created_at < ?";
          params.push(filters.endDate);
        } else {
          sql += " AND created_at < date(?, '+1 day')";
          const endDateStr = filters.endDate.split("T")[0];
          params.push(endDateStr);
        }
      }

      sql += " GROUP BY app_platform";

      const database = db.getDatabase();
      const stmt = database.prepare(sql);
      const results = stmt.all(...params);

      // Return as array for easier consumption in frontend
      return results.map((row) => ({
        app_platform: row.app_platform,
        total_requests: row.total_requests,
        successful_requests: row.successful_requests,
        failed_requests: row.failed_requests,
      }));
    } catch (error) {
      logger.error("Failed to get stats by platform:", error);
      throw error;
    }
  }

  /**
   * Get statistics grouped by environment
   * @param {Object} filters - Filter parameters
   * @returns {Array} Stats by environment
   */
  getStatsByEnvironment(filters = {}) {
    try {
      let sql = `
        SELECT 
          app_environment,
          COUNT(*) as total_requests,
          SUM(CASE WHEN response_status >= 200 AND response_status < 300 THEN 1 ELSE 0 END) as successful_requests,
          SUM(CASE WHEN response_status < 200 OR response_status >= 300 THEN 1 ELSE 0 END) as failed_requests
        FROM stats WHERE 1=1
      `;
      const params = [];

      // Use full timestamp for short windows, date-only for longer windows
      const shortTimeWindows = ["15m", "30m", "1h", "2h", "4h"];
      const useFullTimestamp = shortTimeWindows.includes(filters.timeWindow);

      if (filters.startDate) {
        if (useFullTimestamp) {
          sql += " AND created_at >= ?";
          params.push(filters.startDate);
        } else {
          sql += " AND created_at >= ?";
          const startDateStr = filters.startDate.split("T")[0];
          params.push(startDateStr);
        }
      }

      if (filters.endDate) {
        if (useFullTimestamp) {
          sql += " AND created_at < ?";
          params.push(filters.endDate);
        } else {
          sql += " AND created_at < date(?, '+1 day')";
          const endDateStr = filters.endDate.split("T")[0];
          params.push(endDateStr);
        }
      }

      sql += " GROUP BY app_environment";

      const database = db.getDatabase();
      const stmt = database.prepare(sql);
      const results = stmt.all(...params);

      // Return as array for easier consumption in frontend
      return results.map((row) => ({
        app_environment: row.app_environment,
        total_requests: row.total_requests,
        successful_requests: row.successful_requests,
        failed_requests: row.failed_requests,
      }));
    } catch (error) {
      logger.error("Failed to get stats by environment:", error);
      throw error;
    }
  }

  /**
   * Get time series data for requests over a time period
   * Aggregates request data by time intervals from stats table
   * @param {Object} options - Time series options
   * @param {string} options.timeWindow - Time window (15m, 30m, 1h, 3h, 6h, 12h, 1d, 3d, 7d)
   * @param {string} options.startDate - Optional start date filter
   * @param {string} options.endDate - Optional end date filter
   * @returns {Array} Time series data points
   */
  getTimeSeriesData(options = {}) {
    try {
      const { timeWindow = "1h", startDate, endDate } = options;

      // Define time window durations in minutes and expected data points per window
      const windowConfig = {
        "15m": { durationMinutes: 15, points: 30 },
        "30m": { durationMinutes: 30, points: 30 },
        "1h": { durationMinutes: 60, points: 30 },
        "2h": { durationMinutes: 120, points: 24 },
        "4h": { durationMinutes: 240, points: 24 },
        "8h": { durationMinutes: 480, points: 24 },
        "1d": { durationMinutes: 1440, points: 24 },
        "3d": { durationMinutes: 4320, points: 36 },
        "7d": { durationMinutes: 10080, points: 28 },
        "15d": { durationMinutes: 21600, points: 30 },
        "30d": { durationMinutes: 43200, points: 30 },
      };

      const config = windowConfig[timeWindow] || windowConfig["1h"];
      const windowMinutes = config.durationMinutes;
      const expectedPoints = config.points;
      const intervalMinutes = Math.max(1, Math.floor(windowMinutes / expectedPoints));

      // Calculate time range
      const now = new Date();
      const startTime = startDate ? new Date(startDate) : new Date(now.getTime() - windowMinutes * 60 * 1000);
      const endTime = endDate ? new Date(endDate) : now;

      // Query requests from stats table within time range
      let sql = `
        SELECT 
          created_at,
          app_platform,
          response_status
        FROM stats
        WHERE datetime(created_at) >= datetime(?) AND datetime(created_at) <= datetime(?)
        ORDER BY created_at ASC
      `;
      const params = [startTime.toISOString(), endTime.toISOString()];

      const database = db.getDatabase();
      const stmt = database.prepare(sql);
      const rawData = stmt.all(...params);

      // Aggregate data into time intervals
      const intervals = [];
      let currentTime = startTime.getTime();
      const intervalMs = intervalMinutes * 60 * 1000;

      while (currentTime <= endTime.getTime()) {
        const intervalEnd = currentTime + intervalMs;

        const intervalData = {
          time: new Date(currentTime).toISOString(),
          android_success: 0,
          android_failed: 0,
          ios_success: 0,
          ios_failed: 0,
        };

        // Aggregate data for this interval
        rawData.forEach((row) => {
          const rowTime = new Date(row.created_at).getTime();

          if (rowTime >= currentTime && rowTime < intervalEnd) {
            // Handle null app_platform
            const platform = row.app_platform ? row.app_platform.toLowerCase() : "unknown";
            const isSuccess = row.response_status >= 200 && row.response_status < 300;

            if (platform === "android") {
              if (isSuccess) {
                intervalData.android_success += 1;
              } else {
                intervalData.android_failed += 1;
              }
            } else if (platform === "ios") {
              if (isSuccess) {
                intervalData.ios_success += 1;
              } else {
                intervalData.ios_failed += 1;
              }
            }
          }
        });

        intervals.push(intervalData);
        currentTime += intervalMs;
      }

      return intervals;
    } catch (error) {
      logger.error("Failed to get time series data:", error);
      throw error;
    }
  }

  /**
   * Delete old statistics records
   * @param {number} daysToKeep - Number of days to keep
   * @returns {number} Number of deleted records
   */
  cleanupOldStats(daysToKeep = 90) {
    try {
      const database = db.getDatabase();
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
      const cutoffDateStr = cutoffDate.toISOString().split("T")[0];

      const stmt = database.prepare("DELETE FROM stats WHERE stat_date < ?");
      const result = stmt.run(cutoffDateStr);

      logger.info(`Cleaned up ${result.changes} old statistics records`);
      return result.changes;
    } catch (error) {
      logger.error("Failed to cleanup old stats:", error);
      throw error;
    }
  }

  /**
   * Get today's date in YYYY-MM-DD format
   * @returns {string} Today's date
   */
  getTodayDate() {
    return new Date().toISOString().split("T")[0];
  }
}

module.exports = new StatsRepository();
