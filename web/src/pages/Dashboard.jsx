import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useSelector } from "react-redux";
import {
  Box,
  Grid,
  Card,
  CardContent,
  Typography,
  CircularProgress,
  Alert,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  ToggleButton,
  ToggleButtonGroup,
  IconButton,
} from "@mui/material";
import {
  CheckCircle as SuccessIcon,
  Error as ErrorIcon,
  Speed as SpeedIcon,
  Storage as StorageIcon,
  Refresh as RefreshIcon,
  Assessment as AssessmentIcon,
} from "@mui/icons-material";
import MethodTag from "../components/MethodTag";
import {
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  ComposedChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { getStats } from "../services/api";
import axios from "axios";
import { applyTagsToEndpoint, getEndpointTypeTag } from "../utils/endpointTagUtils";

// Format large numbers with K/M suffixes
const formatNumber = (num) => {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + "M";
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1) + "K";
  }
  return num.toString();
};

const COLORS = {
  android: "#4CAF50", // Green for Android
  ios: "#2196F3", // Blue for iOS
  successColor: "#4CAF50", // Green for success
  failureColor: "#FF9800", // Orange for failures
};

const TIME_WINDOWS = [
  { value: "15m", label: "Last 15 min" },
  { value: "30m", label: "Last 30 min" },
  { value: "1h", label: "1 hour" },
  { value: "2h", label: "2 hours" },
  { value: "4h", label: "4 hours" },
  { value: "8h", label: "8 hours" },
  { value: "1d", label: "1 day" },
  { value: "3d", label: "3 days" },
  { value: "7d", label: "7 days" },
  { value: "15d", label: "15 days" },
  { value: "30d", label: "30 days" },
];

function Dashboard({ mode }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // Initialize timeWindow from localStorage to avoid async state changes triggering multiple API calls
  const [timeWindow, setTimeWindow] = useState(() => {
    const saved = localStorage.getItem("dproxy_timeline_filter");
    return saved || "1d";
  });
  const [showAnimation, setShowAnimation] = useState(false);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [endpointType, setEndpointType] = useState("all");
  const [sortConfig, setSortConfig] = useState(null);
  const viewportRef = React.useRef(null);
  const scrollPositionRef = React.useRef(0);
  const initializedRef = React.useRef(false);
  const abortControllerRef = React.useRef(null);

  // Get endpoint config from Redux to apply tags
  const endpointConfig = useSelector((state) => state.config?.endpointConfig);

  // Memoize topEndpoints sorting logic
  const topEndpoints = useMemo(() => {
    const rawTopEndpoints = stats?.topEndpoints || [];
    if (!sortConfig) {
      // No sorting: return top 20 by total_requests (default)
      return [...rawTopEndpoints].sort((a, b) => b.total_requests - a.total_requests).slice(0, 20);
    }

    const sorted = [...rawTopEndpoints].sort((a, b) => {
      let aVal = a[sortConfig.field];
      let bVal = b[sortConfig.field];

      // Handle success_rate as string
      if (sortConfig.field === "success_rate") {
        aVal = parseFloat(aVal) || 0;
        bVal = parseFloat(bVal) || 0;
      }

      if (sortConfig.direction === "asc") {
        return aVal - bVal;
      } else {
        return bVal - aVal;
      }
    });

    return sorted.slice(0, 20);
  }, [stats?.topEndpoints, sortConfig]);

  // Timeline filter loading is now done synchronously from localStorage in useState initializer
  // Keeping a stub for syncing with database (async operation in background)
  const syncTimelineFilterWithDatabase = async () => {
    try {
      const { getTimelineFilter } = await import("../services/api");
      const savedFilter = await getTimelineFilter();
      // Only update localStorage if database has a newer value
      if (savedFilter) {
        localStorage.setItem("dproxy_timeline_filter", savedFilter);
        // Don't call setTimeWindow here as it would trigger unnecessary API calls
        // The value is already loaded from localStorage on mount
      }
    } catch (error) {
      console.error("Failed to sync timeline filter:", error);
    }
  };

  // Save timeline filter to localStorage and database whenever it changes
  // Use useCallback to memoize the function and prevent unnecessary re-renders
  const handleTimeWindowChange = useCallback(async (newWindow) => {
    if (newWindow !== null) {
      setTimeWindow(newWindow);
      // Save to localStorage immediately for synchronous access on next mount
      localStorage.setItem("dproxy_timeline_filter", newWindow);

      // Also save to database for persistence across devices
      try {
        const { saveTimelineFilter } = await import("../services/api");
        await saveTimelineFilter(newWindow);
      } catch (error) {
        console.error("Failed to save timeline filter:", error);
      }
    }
  }, []);

  const formatTime = (date, window) => {
    if (window.includes("h") || window.includes("m")) {
      return date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
    } else {
      return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    }
  };

  const generateTimeSeriesData = (window) => {
    // Generate mock time-series data with 20-30 time slots for smooth graphs
    const points = [];
    const now = new Date();

    let intervals = 30;
    let intervalMs = 60 * 60 * 1000; // 1 hour

    switch (window) {
      case "15m":
        intervals = 30;
        intervalMs = 30 * 1000; // 30 seconds
        break;
      case "30m":
        intervals = 30;
        intervalMs = 1 * 60 * 1000; // 1 minute
        break;
      case "1h":
        intervals = 30;
        intervalMs = 2 * 60 * 1000; // 2 minutes
        break;
      case "2h":
        intervals = 24;
        intervalMs = 5 * 60 * 1000; // 5 minutes
        break;
      case "4h":
        intervals = 24;
        intervalMs = 10 * 60 * 1000; // 10 minutes
        break;
      case "8h":
        intervals = 24;
        intervalMs = 20 * 60 * 1000; // 20 minutes
        break;
      case "1d":
        intervals = 24;
        intervalMs = 60 * 60 * 1000; // 1 hour
        break;
      case "3d":
        intervals = 36;
        intervalMs = 2 * 60 * 60 * 1000; // 2 hours
        break;
      case "7d":
        intervals = 28;
        intervalMs = 6 * 60 * 60 * 1000; // 6 hours
        break;
      case "15d":
        intervals = 30;
        intervalMs = 12 * 60 * 60 * 1000; // 12 hours
        break;
      case "30d":
        intervals = 30;
        intervalMs = 24 * 60 * 60 * 1000; // 1 day
        break;
    }

    // Generate more realistic test data with variations
    const baselineAndroidSuccess = 80;
    const baselineAndroidFailed = 5;
    const baselineIosSuccess = 95;
    const baselineIosFailed = 8;

    for (let i = intervals - 1; i >= 0; i--) {
      const time = new Date(now.getTime() - i * intervalMs);

      // Format time with proper granularity
      let timeStr;
      if (window === "15m" || window === "30m") {
        timeStr = time.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      } else if (window.includes("h") || window === "1d") {
        timeStr = time.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
      } else if (window === "3d") {
        timeStr = time.toLocaleString("en-US", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
      } else {
        timeStr = time.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      }

      // Generate test data with variation to show trends
      const androidSuccess = Math.max(10, baselineAndroidSuccess + Math.floor(Math.sin(i / 5) * 30) + Math.floor(Math.random() * 20));
      const androidFailed = Math.max(1, baselineAndroidFailed + Math.floor(Math.cos(i / 7) * 3) + Math.floor(Math.random() * 4));
      const iosSuccess = Math.max(15, baselineIosSuccess + Math.floor(Math.sin(i / 6) * 25) + Math.floor(Math.random() * 15));
      const iosFailed = Math.max(2, baselineIosFailed + Math.floor(Math.cos(i / 8) * 4) + Math.floor(Math.random() * 5));

      points.push({
        time: timeStr,
        android_success: androidSuccess,
        android_failed: androidFailed,
        ios_success: iosSuccess,
        ios_failed: iosFailed,
      });
    }

    return points;
  };

  const loadStats = async (forceAnimation = false, isPeriodicRefresh = false, skipLoadingState = false) => {
    try {
      // Cancel any previous in-flight request to prevent duplicate data processing
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      // Create new abort controller for this request
      const controller = new AbortController();
      abortControllerRef.current = controller;

      // Only show loading spinner on initial load, not on periodic refreshes or filter changes
      if (!isPeriodicRefresh && !skipLoadingState) {
        setLoading(true);
      }
      setError(null);
      setShowAnimation(false); // Never show pie chart animation

      const response = await getStats(
        {
          time_window: timeWindow,
          endpoint_type: endpointType,
        },
        {
          signal: controller.signal, // Pass abort signal in config, not as query param
        }
      );
      // API returns { success: true, data: { summary: {...}, breakdown: [...], byEndpoint: [...], byPlatform: [...], timeSeriesData: [...] } }
      const apiData = response?.data || {};
      const summaryData = apiData.summary || {};
      const endpointData = apiData.byEndpoint || [];
      const platformData = apiData.byPlatform || [];
      const environmentData = apiData.byEnvironment || [];

      // Transform endpoint data for display
      const topEndpoints = endpointData
        .map((ep) => ({
          endpoint_path: ep.endpoint_path,
          endpoint_type: ep.endpoint_type || "public",
          method: ep.method || "", // Keep empty string if method is null/undefined
          total_requests: ep.total_requests,
          successful_requests: ep.successful_requests,
          failed_requests: ep.failed_requests,
          avg_duration_ms: ep.avg_duration_ms,
          success_rate:
            ep.success_rate || (ep.total_requests > 0 ? ((ep.successful_requests / ep.total_requests) * 100).toFixed(2) : "0.00"),
        }))
        .sort((a, b) => b.total_requests - a.total_requests);

      // Transform platform data for pie chart - exactly 4 segments
      // Aggregate: Android Success, Android Failed, iOS Success, iOS Failed
      const platformBreakdown = [];

      // Find Android and iOS data
      const androidData = platformData.find((p) => p.app_platform === "android") || {
        successful_requests: 0,
        failed_requests: 0,
        total_requests: 0,
      };
      const iosData = platformData.find((p) => p.app_platform === "ios") || {
        successful_requests: 0,
        failed_requests: 0,
        total_requests: 0,
      };

      // Always add exactly 4 segments
      const androidSuccessActual = androidData.successful_requests || 0;
      const androidFailedActual = androidData.failed_requests || 0;
      const iosSuccessActual = iosData.successful_requests || 0;
      const iosFailedActual = iosData.failed_requests || 0;

      // Calculate total to determine minimum display value (0.5% of total)
      const totalActual = androidSuccessActual + androidFailedActual + iosSuccessActual + iosFailedActual;
      const minDisplayValue = totalActual > 0 ? totalActual * 0.005 : 0; // 0.5% of total

      // Helper function to calculate display value with minimum portion for small values
      const getDisplayValue = (actualValue) => {
        // If actual value is 0, show 0
        if (actualValue === 0) return 0;
        // If actual value is very small (< 0.5%), show minimum of 0.5% of total
        return Math.max(actualValue, minDisplayValue);
      };

      platformBreakdown.push({
        name: "Android (Success)",
        value: getDisplayValue(androidSuccessActual),
        actualValue: androidSuccessActual,
        platform: "Android",
        type: "success",
        successful: androidSuccessActual,
        failed: androidFailedActual,
        total: androidData.total_requests || 0,
      });

      platformBreakdown.push({
        name: "Android (Failed)",
        value: getDisplayValue(androidFailedActual),
        actualValue: androidFailedActual,
        platform: "Android",
        type: "failed",
        successful: androidSuccessActual,
        failed: androidFailedActual,
        total: androidData.total_requests || 0,
      });

      platformBreakdown.push({
        name: "iOS (Success)",
        value: getDisplayValue(iosSuccessActual),
        actualValue: iosSuccessActual,
        platform: "iOS",
        type: "success",
        successful: iosSuccessActual,
        failed: iosFailedActual,
        total: iosData.total_requests || 0,
      });

      platformBreakdown.push({
        name: "iOS (Failed)",
        value: getDisplayValue(iosFailedActual),
        actualValue: iosFailedActual,
        platform: "iOS",
        type: "failed",
        successful: iosSuccessActual,
        failed: iosFailedActual,
        total: iosData.total_requests || 0,
      });

      // Use real time-series data from API (format timestamps for display)
      // Data should be sorted from oldest (left) to newest (right)
      // Leftmost point = start time (now - timeWindow), Rightmost point = current time (now)
      const rawTimeSeriesData = apiData.timeSeriesData || [];

      // Ensure data is sorted by time (oldest first, newest last)
      const sortedTimeSeriesData = [...rawTimeSeriesData].sort((a, b) => new Date(a.time) - new Date(b.time));

      // Calculate expected start and end times for the time window
      const now = new Date();
      let expectedStartTime = new Date(now);
      switch (timeWindow) {
        case "15m":
          expectedStartTime.setMinutes(now.getMinutes() - 15);
          break;
        case "30m":
          expectedStartTime.setMinutes(now.getMinutes() - 30);
          break;
        case "1h":
          expectedStartTime.setHours(now.getHours() - 1);
          break;
        case "2h":
          expectedStartTime.setHours(now.getHours() - 2);
          break;
        case "4h":
          expectedStartTime.setHours(now.getHours() - 4);
          break;
        case "8h":
          expectedStartTime.setHours(now.getHours() - 8);
          break;
        case "1d":
        case "today":
          expectedStartTime.setDate(now.getDate() - 1);
          break;
        case "3d":
          expectedStartTime.setDate(now.getDate() - 3);
          break;
        case "7d":
        case "week":
          expectedStartTime.setDate(now.getDate() - 7);
          break;
        case "15d":
          expectedStartTime.setDate(now.getDate() - 15);
          break;
        case "30d":
        case "month":
          expectedStartTime.setMonth(now.getMonth() - 1);
          break;
      }

      // Helper function to format time based on time window
      const formatTimeForDisplay = (date) => {
        if (timeWindow === "15m" || timeWindow === "30m") {
          return date.toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            timeZone: undefined,
          });
        } else if (timeWindow === "1h" || timeWindow === "2h" || timeWindow === "4h" || timeWindow === "8h" || timeWindow === "1d") {
          return date.toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
            timeZone: undefined,
          });
        } else if (timeWindow === "3d") {
          return date.toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            timeZone: undefined,
          });
        } else if (timeWindow === "7d" || timeWindow === "15d") {
          return date.toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            timeZone: undefined,
          });
        } else if (timeWindow === "30d") {
          return date.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            timeZone: undefined,
          });
        } else {
          return date.toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            timeZone: undefined,
          });
        }
      };

      const timeSeriesData = sortedTimeSeriesData.map((point, index) => {
        // Convert ISO timestamp from database to local time
        const date = new Date(point.time);
        let timeStr = formatTimeForDisplay(date);

        // Override first and last labels to show exact start and end times
        if (index === 0) {
          // First point: show start time (now - timeWindow)
          timeStr = formatTimeForDisplay(expectedStartTime);
        } else if (index === sortedTimeSeriesData.length - 1) {
          // Last point: show end time (now)
          timeStr = formatTimeForDisplay(now);
        }

        return {
          time: timeStr,
          rawTime: point.time, // Store original ISO timestamp for reference
          android_success: point.android_success || 0,
          android_failed: point.android_failed || 0,
          ios_success: point.ios_success || 0,
          ios_failed: point.ios_failed || 0,
        };
      });

      const transformedStats = {
        total_requests: summaryData.totalRequests || 0,
        successful_requests: summaryData.successfulRequests || 0,
        failed_requests: summaryData.failedRequests || 0,
        avg_duration_ms: summaryData.avgDurationMs || 0,
        success_rate: summaryData.successRate || "0.00",
        by_platform: {},
        by_environment: {},
        topEndpoints,
        platformBreakdown,
        rawPlatformData: platformData, // Store original data for breakdown display
        timeSeriesData,
      };

      // Calculate platform and environment distributions
      platformData.forEach((p) => {
        if (p.app_platform === "android" || p.app_platform === "ios") {
          const name = p.app_platform === "android" ? "Android" : "iOS";
          transformedStats.by_platform[name] = p.total_requests;
        }
      });

      environmentData.forEach((e) => {
        transformedStats.by_environment[e.app_environment] = e.total_requests;
      });

      setStats(transformedStats);
      setError(null);
      if (isInitialLoad) {
        setIsInitialLoad(false);
        setShowAnimation(true);
      }
    } catch (err) {
      // Ignore cancellation errors from canceled requests (expected when React.StrictMode remounts or rapid filter changes)
      // Check multiple ways axios might indicate cancellation
      const isCanceled =
        axios.isCancel?.(err) ||
        err.name === "CanceledError" ||
        err.code === "ERR_CANCELED" ||
        err.name === "AbortError" ||
        (err.message && err.message.toLowerCase().includes("canceled"));

      if (isCanceled) {
        // Silently ignore canceled requests - they're expected behavior
        return;
      }

      console.error("Failed to load stats:", err);
      const errorMessage = err?.response?.data?.error || err?.message || "Failed to load statistics";
      setError(errorMessage);
      // Set empty stats to prevent blank page
      setStats({
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        successRate: "0.00",
        avgDurationMs: 0,
        topEndpoints: [],
        platformBreakdown: [],
        byEnvironment: {},
        timeSeriesData: [],
      });
    } finally {
      setLoading(false);
    }
  };

  // Handle sorting for top endpoints with useCallback to prevent unnecessary re-renders
  const handleSort = useCallback((field) => {
    setSortConfig((prevConfig) => {
      if (prevConfig?.field === field) {
        // Cycle through: desc -> asc -> none
        if (prevConfig.direction === "desc") {
          return { field, direction: "asc" };
        } else {
          return null;
        }
      } else {
        // First click: descending
        return { field, direction: "desc" };
      }
    });
  }, []);

  // Handle endpoint type change with useCallback to prevent unnecessary re-renders
  const handleEndpointTypeChange = useCallback((event, newType) => {
    if (newType !== null) {
      setEndpointType(newType);
    }
  }, []);

  useEffect(() => {
    // Single unified effect for initialization and filter changes
    if (!initializedRef.current) {
      // Initialization: first mount only
      initializedRef.current = true;
      // Load stats with the timeWindow value from localStorage
      loadStats(false, false, false);
      // Sync timeline filter with database in background (non-blocking)
      syncTimelineFilterWithDatabase();
    } else {
      // Filter change: reload stats when timeWindow or endpointType changes
      // Pass skipLoadingState=true to prevent loading spinner from showing during filter changes
      loadStats(false, false, true);
    }

    // Set up periodic refresh interval - this will only update data, not re-render the page
    const interval = setInterval(() => {
      // Only update stats data without triggering full page re-render
      // Pass isPeriodicRefresh=true to prevent loading spinner from showing
      loadStats(false, true, false);
    }, 30000); // Refresh every 30s

    return () => clearInterval(interval);
  }, [timeWindow, endpointType]);

  // Restore scroll position after state update completes
  useEffect(() => {
    if (viewportRef.current && scrollPositionRef.current !== undefined && scrollPositionRef.current > 0) {
      // Restore immediately without setTimeout to avoid jarring scroll behavior
      viewportRef.current.scrollTop = scrollPositionRef.current;
    }
  }, [stats]);

  const handleRefresh = () => {
    setShowAnimation(true);
    loadStats(true);
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return <Alert severity="error">{error}</Alert>;
  }

  const StatCard = ({ title, value, icon, color }) => (
    <Card>
      <CardContent>
        <Box display="flex" alignItems="center" justifyContent="space-between">
          <Box>
            <Typography color="textSecondary" gutterBottom variant="body2">
              {title}
            </Typography>
            <Typography variant="h4">{value}</Typography>
          </Box>
          <Box sx={{ color }}>{icon}</Box>
        </Box>
      </CardContent>
    </Card>
  );

  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      return (
        <Paper sx={{ p: 1.5, backgroundColor: "rgba(255, 255, 255, 0.97)", border: "1px solid #e0e0e0", boxShadow: 2 }}>
          <Typography variant="caption" sx={{ fontWeight: "bold", color: "#424242", fontSize: "0.75rem" }}>
            {label}
          </Typography>
          {payload.map((entry, index) => (
            <Typography key={index} variant="caption" sx={{ color: entry.color, fontSize: "0.7rem", display: "block", fontWeight: 500 }}>
              {entry.name}: {entry.value}
            </Typography>
          ))}
        </Paper>
      );
    }
    return null;
  };

  // Calculate max Y-axis value (at least 10% more than highest value)
  const calculateYAxisMax = () => {
    if (!timeSeriesData || timeSeriesData.length === 0) return 100;
    let maxValue = 0;
    timeSeriesData.forEach((point) => {
      maxValue = Math.max(maxValue, point.android_success || 0, point.ios_success || 0, point.android_failed || 0, point.ios_failed || 0);
    });
    // Ensure at least 10% more than the highest value, minimum of 10
    const calculatedMax = Math.ceil(maxValue * 1.1);
    return Math.max(calculatedMax, 10);
  };

  // Calculate max Y-axis value for right axis (failed requests)
  const calculateRightYAxisMax = () => {
    if (!timeSeriesData || timeSeriesData.length === 0) return 10;
    let maxValue = 0;
    timeSeriesData.forEach((point) => {
      maxValue = Math.max(maxValue, point.android_failed || 0, point.ios_failed || 0);
    });
    // Ensure at least 10% more than the highest value, minimum of 10
    const calculatedMax = Math.ceil(maxValue * 1.1);
    return Math.max(calculatedMax, 10);
  };

  // Calculate optimal interval for X-axis labels to prevent overlap
  // Returns interval value for Recharts (0 = show all, 1 = show every other, etc.)
  // Recharts will show labels at positions: 0, interval+1, 2*(interval+1), etc.
  // CustomXAxisTick will ensure first and last are always shown
  const calculateXAxisInterval = () => {
    if (!timeSeriesData || timeSeriesData.length === 0) return 0;

    // Estimate label width (approximate based on time format)
    // For time labels like "09:53 PM" or "Dec 15, 09:53", estimate ~80-100px width
    const estimatedLabelWidth = 90;
    // Estimate chart width (ResponsiveContainer will fill available space, estimate ~800px for md=9 grid)
    const estimatedChartWidth = 800;
    // Calculate how many labels can fit without overlap (with some padding)
    const maxLabels = Math.floor(estimatedChartWidth / estimatedLabelWidth);

    // If we have fewer data points than max labels, show all
    if (timeSeriesData.length <= maxLabels) {
      return 0; // Show all labels, CustomXAxisTick will handle duplicates
    }

    // Calculate interval: we want approximately maxLabels labels total
    // Since first and last are always shown, we need (maxLabels - 2) intermediate labels
    // interval in Recharts: if interval=1, shows every other (positions 0, 2, 4...)
    // So interval = Math.ceil((dataLength - 1) / (maxLabels - 1)) - 1
    const intermediateLabels = Math.max(1, maxLabels - 2); // At least 1 intermediate label
    const interval = Math.max(0, Math.ceil((timeSeriesData.length - 1) / (intermediateLabels + 1)) - 1);

    return interval;
  };

  // Custom X-axis label to always show first and last labels, remove duplicates, and prevent overlap
  const CustomXAxisTick = ({ x, y, payload }) => {
    if (!timeSeriesData || timeSeriesData.length === 0) return null;

    const currentIndex = timeSeriesData.findIndex((d) => d.time === payload.value);
    if (currentIndex === -1) return null;

    const isFirst = currentIndex === 0;
    const isLast = currentIndex === timeSeriesData.length - 1;

    // Always show first and last labels (they already have correct start/end times)
    if (isFirst || isLast) {
      return (
        <text x={x} y={y} textAnchor="middle" fill="#666" fontSize={9} dy={10}>
          {payload.value}
        </text>
      );
    }

    // For intermediate labels, check for duplicates and spacing
    const currentLabel = payload.value;
    let currentDatePart = currentLabel;
    if (timeWindow === "7d" || timeWindow === "15d" || timeWindow === "30d") {
      const parts = currentLabel.split(" ");
      currentDatePart = parts.slice(0, 2).join(" ");
    }

    // Check if previous entry has the same date part
    if (currentIndex > 0) {
      const prevLabel = timeSeriesData[currentIndex - 1].time;
      let prevDatePart = prevLabel;
      if (timeWindow === "7d" || timeWindow === "15d" || timeWindow === "30d") {
        const parts = prevLabel.split(" ");
        prevDatePart = parts.slice(0, 2).join(" ");
      }

      if (prevDatePart === currentDatePart) {
        return null; // Don't show duplicate date labels
      }
    }

    // Show the label
    return (
      <text x={x} y={y} textAnchor="middle" fill="#666" fontSize={9} dy={10}>
        {currentLabel}
      </text>
    );
  };

  const PieTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
      const data = payload[0];
      const isAndroid = data.payload.name === "Android";
      // Use actualValue from payload if available (for display purposes), otherwise use value
      const displayValue = data.payload.actualValue !== undefined ? data.payload.actualValue : data.value;
      return (
        <Paper sx={{ p: 1.5, backgroundColor: "rgba(255, 255, 255, 0.97)", border: "1px solid #e0e0e0", boxShadow: 2 }}>
          <Typography variant="caption" sx={{ color: "#424242", fontSize: "0.75rem", display: "block", fontWeight: "bold" }}>
            {data.payload.name} Requests: {displayValue}
          </Typography>
          <Typography variant="caption" sx={{ color: COLORS.successColor, fontSize: "0.7rem", display: "block", fontWeight: 500 }}>
            ✓ Successful: {data.payload.successful}
          </Typography>
          <Typography variant="caption" sx={{ color: COLORS.failureColor, fontSize: "0.7rem", display: "block", fontWeight: 500 }}>
            ✗ Failed: {data.payload.failed}
          </Typography>
        </Paper>
      );
    }
    return null;
  };

  const platformData = stats?.platformBreakdown || [];
  const timeSeriesData = stats?.timeSeriesData || [];

  return (
    <Box ref={viewportRef} sx={{ overflow: "hidden", height: "flex", display: "flex", flexDirection: "column" }}>
      <Box sx={{ p: 2, flex: 1, overflow: "auto" }}>
        {/* Dashboard Header */}
        <Box display="flex" alignItems="center" justifyContent="space-between" mb={3}>
          <Typography variant="h4">Dashboard</Typography>
          <IconButton onClick={handleRefresh} size="small" title="Refresh with data" sx={{ ml: 1 }}>
            <RefreshIcon />
          </IconButton>
        </Box>

        {/* Summary Stats - Show in all modes */}
        <Grid container spacing={2} mb={3}>
          <Grid item xs={12} sm={6} md={2.4}>
            <StatCard
              title="Success Rate"
              value={`${stats?.success_rate || 0}%`}
              icon={<AssessmentIcon sx={{ fontSize: 40 }} />}
              color="#4cafadff"
            />
          </Grid>

          <Grid item xs={12} sm={6} md={2.4}>
            <StatCard
              title="Total Requests"
              value={stats?.total_requests?.toLocaleString() || 0}
              icon={<StorageIcon sx={{ fontSize: 40 }} />}
              color="#1976d2"
            />
          </Grid>

          <Grid item xs={12} sm={6} md={2.4}>
            <StatCard
              title="Successful"
              value={stats?.successful_requests?.toLocaleString() || 0}
              icon={<SuccessIcon sx={{ fontSize: 40 }} />}
              color="#4CAF50"
            />
          </Grid>

          <Grid item xs={12} sm={6} md={2.4}>
            <StatCard
              title="Failed"
              value={stats?.failed_requests?.toLocaleString() || 0}
              icon={<ErrorIcon sx={{ fontSize: 40 }} />}
              color="#ff4d00ff"
            />
          </Grid>

          <Grid item xs={12} sm={6} md={2.4}>
            <StatCard
              title="Avg Latency"
              value={`${stats?.avg_duration_ms || 0}ms`}
              icon={<SpeedIcon sx={{ fontSize: 40 }} />}
              color="#ff9800"
            />
          </Grid>
        </Grid>

        {/* Platform Distribution & Request Trend Side-by-Side */}
        <Grid container spacing={3} mb={3}>
          {/* Platform Distribution - 1/4 width (md=3) - Vertical Layout */}
          <Grid item xs={12} md={3}>
            <Card sx={{ height: "100%" }}>
              <CardContent sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
                <Typography variant="h6" gutterBottom>
                  By Platform
                </Typography>

                {/* Vertical Layout: Pie Chart on top (flex-grow), Breakdown at bottom (fixed) */}
                <Box display="flex" flexDirection="column" flex={1} gap={0.5}>
                  {/* Pie Chart - Takes all available space */}
                  {(() => {
                    // Check if all metrics have 0 actual values
                    const hasAnyData = platformData.some((entry) => (entry.actualValue || 0) > 0);
                    return hasAnyData ? (
                      <Box sx={{ width: "100%", flex: 1, minHeight: 0 }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={platformData}
                              cx="50%"
                              cy="50%"
                              labelLine={false}
                              outerRadius="100%"
                              fill="#8884d8"
                              dataKey="value"
                              isAnimationActive={false}
                            >
                              {platformData.map((entry, index) => {
                                let color;
                                if (entry.type === "success") {
                                  // Green for success (same as time series)
                                  color = entry.platform === "Android" ? "#4CAF50" : "#2196F3";
                                } else {
                                  // Orange/Red for failed (same as time series)
                                  color = entry.platform === "Android" ? "#ef9b34ff" : "#e66051ff";
                                }
                                return <Cell key={`cell-${index}`} fill={color} />;
                              })}
                            </Pie>
                            <Tooltip content={<PieTooltip />} />
                          </PieChart>
                        </ResponsiveContainer>
                      </Box>
                    ) : (
                      <Box sx={{ width: "100%", flex: 1, minHeight: 0 }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <svg
                            viewBox="0 0 200 200"
                            style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}
                          >
                            {/* Grey circle with thin border, no fill - radius same as pie chart (100px) */}
                            <circle cx="100" cy="100" r="95" fill="none" stroke="#bdbdbd" strokeWidth="0.5" />
                            {/* "No Data" text in center */}
                            <text
                              x="100"
                              y="100"
                              textAnchor="middle"
                              dominantBaseline="central"
                              fontSize="14"
                              fill="#9e9e9e"
                              fontFamily="Roboto, Helvetica, Arial, sans-serif"
                            >
                              No Data
                            </text>
                          </svg>
                        </ResponsiveContainer>
                      </Box>
                    );
                  })()}

                  {/* Breakdown Info - Fixed at bottom, compact */}
                  <Box sx={{ borderTop: "1px solid #e0e0e0", pt: 0.5, mt: "auto" }}>
                    <Grid container spacing={0.5}>
                      {["Android", "iOS"].map((platformName) => {
                        // Get data from raw platformData (from API)
                        // Convert app_platform to display name: "android" -> "Android", "ios" -> "iOS", "" -> null
                        const apiPlatform = stats?.rawPlatformData?.find((p) => {
                          const platformLabel = p.app_platform === "android" ? "Android" : p.app_platform === "ios" ? "iOS" : null;
                          return platformLabel === platformName;
                        }) || {
                          app_platform: platformName.toLowerCase(),
                          total_requests: 0,
                          successful_requests: 0,
                          failed_requests: 0,
                        };

                        return (
                          <Grid item xs={12} key={platformName}>
                            <Box
                              sx={{
                                p: 0.5,
                                borderRadius: "3px",
                                backgroundColor: platformName === "Android" ? "rgba(76, 175, 80, 0.08)" : "rgba(33, 150, 243, 0.08)",
                                border: `1px solid ${platformName === "Android" ? "rgba(76, 175, 80, 0.3)" : "rgba(33, 150, 243, 0.3)"}`,
                              }}
                            >
                              <Box display="flex" justifyContent="space-between" alignItems="center">
                                <Typography
                                  variant="caption"
                                  sx={{
                                    fontWeight: "bold",
                                    color: platformName === "Android" ? COLORS.android : COLORS.ios,
                                    fontSize: "0.6rem",
                                  }}
                                >
                                  {platformName}
                                </Typography>
                                <Box display="flex" gap={1.2}>
                                  {/* Total - Fixed width container for label and value */}
                                  <Box display="flex" gap={0.3} alignItems="center" sx={{ minWidth: "56px" }}>
                                    <Typography variant="caption" sx={{ color: "#757575", fontSize: "0.5rem", flexShrink: 0 }}>
                                      Total:
                                    </Typography>
                                    <Typography
                                      variant="caption"
                                      sx={{ fontWeight: "bold", fontSize: "0.55rem", textAlign: "left", flex: 1 }}
                                    >
                                      {formatNumber(apiPlatform.total_requests)}
                                    </Typography>
                                  </Box>
                                  {/* Success - Fixed width container for label and value */}
                                  <Box display="flex" gap={0.3} alignItems="center" sx={{ minWidth: "48px" }}>
                                    <Typography variant="caption" sx={{ color: COLORS.successColor, fontSize: "0.5rem", flexShrink: 0 }}>
                                      ✓:
                                    </Typography>
                                    <Typography
                                      variant="caption"
                                      sx={{
                                        color: COLORS.successColor,
                                        fontWeight: "bold",
                                        fontSize: "0.55rem",
                                        textAlign: "left",
                                        flex: 1,
                                      }}
                                    >
                                      {formatNumber(apiPlatform.successful_requests)}
                                    </Typography>
                                  </Box>
                                  {/* Failed - Fixed width container for label and value */}
                                  <Box display="flex" gap={0.3} alignItems="center" sx={{ minWidth: "48px" }}>
                                    <Typography variant="caption" sx={{ color: COLORS.failureColor, fontSize: "0.5rem", flexShrink: 0 }}>
                                      ✗:
                                    </Typography>
                                    <Typography
                                      variant="caption"
                                      sx={{
                                        color: COLORS.failureColor,
                                        fontWeight: "bold",
                                        fontSize: "0.55rem",
                                        textAlign: "left",
                                        flex: 1,
                                      }}
                                    >
                                      {formatNumber(apiPlatform.failed_requests)}
                                    </Typography>
                                  </Box>
                                </Box>
                              </Box>
                            </Box>
                          </Grid>
                        );
                      })}
                    </Grid>
                  </Box>
                </Box>
              </CardContent>
            </Card>
          </Grid>

          {/* Request Trend - 3/4 width (md=9) */}
          <Grid item xs={12} md={9}>
            <Card sx={{ height: "100%" }}>
              <CardContent sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
                <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                  <Typography variant="h6">Timeline</Typography>
                  <ToggleButtonGroup
                    value={timeWindow}
                    exclusive
                    onChange={(event, newWindow) => handleTimeWindowChange(newWindow)}
                    size="small"
                    sx={{
                      "& .MuiToggleButton-root": {
                        fontSize: "0.525rem",
                        padding: "3px 6px",
                      },
                    }}
                  >
                    {TIME_WINDOWS.map((window) => (
                      <ToggleButton key={window.value} value={window.value} sx={{ fontSize: "0.525rem" }}>
                        {window.label}
                      </ToggleButton>
                    ))}
                  </ToggleButtonGroup>
                </Box>

                {timeSeriesData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={350}>
                    <ComposedChart data={timeSeriesData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="time" tick={<CustomXAxisTick />} interval={calculateXAxisInterval()} height={25} />
                      <YAxis
                        yAxisId="left"
                        label={{ value: "Successful", angle: -90, position: "insideLeft", fontSize: 11 }}
                        tick={{ fontSize: 10 }}
                        domain={[0, calculateYAxisMax()]}
                      />
                      <YAxis
                        yAxisId="right"
                        orientation="right"
                        label={{ value: "Failed", angle: 90, position: "insideRight", fontSize: 11 }}
                        tick={{ fontSize: 10 }}
                        domain={[0, calculateRightYAxisMax()]}
                      />
                      <Tooltip content={<CustomTooltip />} />
                      <Legend wrapperStyle={{ fontSize: "0.85rem" }} />

                      {/* Successful Requests - Green and Blue Columns */}
                      <Bar
                        yAxisId="left"
                        dataKey="android_success"
                        fill={COLORS.android}
                        name="Android Success"
                        opacity={0.8}
                        isAnimationActive={false}
                      />
                      <Bar
                        yAxisId="left"
                        dataKey="ios_success"
                        fill={COLORS.ios}
                        name="iOS Success"
                        opacity={0.8}
                        isAnimationActive={false}
                      />

                      {/* Failed Requests - Dark Orange and Dark Red Lines */}
                      <Line
                        yAxisId="right"
                        type="monotone"
                        dataKey="android_failed"
                        stroke="#ef9b34ff"
                        strokeWidth={2.5}
                        name="Android Failed"
                        isAnimationActive={false}
                      />
                      <Line
                        yAxisId="right"
                        type="monotone"
                        dataKey="ios_failed"
                        stroke="#e66051ff"
                        strokeWidth={2.5}
                        name="iOS Failed"
                        isAnimationActive={false}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                ) : (
                  <Typography color="textSecondary">No time-series data available</Typography>
                )}
              </CardContent>
            </Card>
          </Grid>
        </Grid>

        {/* Top Endpoints Table */}
        <Grid container spacing={3}>
          <Grid item xs={12}>
            <Card>
              <CardContent>
                <Box display="flex" alignItems="center" justifyContent="space-between" mb={2}>
                  <Typography variant="h6">Top Endpoints</Typography>
                  <ToggleButtonGroup value={endpointType} exclusive onChange={handleEndpointTypeChange} size="small">
                    <ToggleButton value="all" sx={{ fontSize: "0.6rem", px: 2, py: 0.3 }}>
                      All
                    </ToggleButton>
                    <ToggleButton value="public" sx={{ fontSize: "0.6rem", px: 2, py: 0.3 }}>
                      Public
                    </ToggleButton>
                    <ToggleButton value="secure" sx={{ fontSize: "0.6rem", px: 2, py: 0.3 }}>
                      Secure
                    </ToggleButton>
                  </ToggleButtonGroup>
                </Box>
                <TableContainer sx={{ overflowX: "auto", overflowY: "visible" }}>
                  <Table>
                    <TableHead>
                      <TableRow sx={{ backgroundColor: "#f5f5f5" }}>
                        <TableCell sx={{ fontWeight: "bold", minWidth: "300px", flex: 1 }}>Endpoint Path</TableCell>
                        <TableCell align="center" sx={{ fontWeight: "bold", minWidth: "70px", whiteSpace: "nowrap" }}>
                          Method
                        </TableCell>
                        <TableCell align="center" sx={{ fontWeight: "bold", minWidth: "80px", whiteSpace: "nowrap" }}>
                          Type
                        </TableCell>
                        <TableCell
                          align="center"
                          sx={{
                            fontWeight: "bold",
                            minWidth: "110px",
                            whiteSpace: "nowrap",
                            cursor: "pointer",
                            userSelect: "none",
                            "&:hover": { backgroundColor: "#e0e0e0" },
                            backgroundColor: sortConfig?.field === "total_requests" ? "#e8e8e8" : "inherit",
                          }}
                          onClick={() => handleSort("total_requests")}
                        >
                          Total Requests {sortConfig?.field === "total_requests" && (sortConfig.direction === "asc" ? "↑" : "↓")}
                        </TableCell>
                        <TableCell
                          align="center"
                          sx={{
                            fontWeight: "bold",
                            minWidth: "100px",
                            whiteSpace: "nowrap",
                            cursor: "pointer",
                            userSelect: "none",
                            "&:hover": { backgroundColor: "#e0e0e0" },
                            backgroundColor: sortConfig?.field === "successful_requests" ? "#e8e8e8" : "inherit",
                          }}
                          onClick={() => handleSort("successful_requests")}
                        >
                          Successful {sortConfig?.field === "successful_requests" && (sortConfig.direction === "asc" ? "↑" : "↓")}
                        </TableCell>
                        <TableCell
                          align="center"
                          sx={{
                            fontWeight: "bold",
                            minWidth: "80px",
                            whiteSpace: "nowrap",
                            cursor: "pointer",
                            userSelect: "none",
                            "&:hover": { backgroundColor: "#e0e0e0" },
                            backgroundColor: sortConfig?.field === "failed_requests" ? "#e8e8e8" : "inherit",
                          }}
                          onClick={() => handleSort("failed_requests")}
                        >
                          Failed {sortConfig?.field === "failed_requests" && (sortConfig.direction === "asc" ? "↑" : "↓")}
                        </TableCell>
                        <TableCell
                          align="center"
                          sx={{
                            fontWeight: "bold",
                            minWidth: "110px",
                            whiteSpace: "nowrap",
                            cursor: "pointer",
                            userSelect: "none",
                            "&:hover": { backgroundColor: "#e0e0e0" },
                            backgroundColor: sortConfig?.field === "success_rate" ? "#e8e8e8" : "inherit",
                          }}
                          onClick={() => handleSort("success_rate")}
                        >
                          Success Rate {sortConfig?.field === "success_rate" && (sortConfig.direction === "asc" ? "↑" : "↓")}
                        </TableCell>
                        <TableCell
                          align="center"
                          sx={{
                            fontWeight: "bold",
                            minWidth: "100px",
                            whiteSpace: "nowrap",
                            cursor: "pointer",
                            userSelect: "none",
                            "&:hover": { backgroundColor: "#e0e0e0" },
                            backgroundColor: sortConfig?.field === "avg_duration_ms" ? "#e8e8e8" : "inherit",
                          }}
                          onClick={() => handleSort("avg_duration_ms")}
                        >
                          Avg Latency {sortConfig?.field === "avg_duration_ms" && (sortConfig.direction === "asc" ? "↑" : "↓")}
                        </TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {topEndpoints && topEndpoints.length > 0 ? (
                        topEndpoints.map((endpoint, idx) => {
                          // Get endpoint type/tag from endpoint config, use endpoint_type as default
                          const typeTag = getEndpointTypeTag(endpoint.endpoint_path, endpointConfig, endpoint.endpoint_type || "public");

                          // Render type badge with custom tag or default type
                          const typeBadge = (
                            <Box
                              sx={{
                                display: "inline-block",
                                px: 1,
                                py: 0.5,
                                backgroundColor: typeTag.color,
                                color: "white",
                                borderRadius: "4px",
                                fontSize: "0.65rem",
                                fontWeight: "bold",
                              }}
                            >
                              {typeTag.name}
                            </Box>
                          );

                          return (
                            <TableRow key={idx} hover>
                              <TableCell sx={{ fontSize: "0.875rem" }}>{endpoint.endpoint_path}</TableCell>
                              <TableCell align="center">
                                <MethodTag method={endpoint.method} fontSize="0.65rem" />
                              </TableCell>
                              <TableCell align="center">{typeBadge}</TableCell>
                              <TableCell align="center">{endpoint.total_requests?.toLocaleString() || 0}</TableCell>
                              <TableCell align="center" sx={{ color: COLORS.successColor, fontWeight: "bold" }}>
                                {endpoint.successful_requests?.toLocaleString() || 0}
                              </TableCell>
                              <TableCell align="center" sx={{ color: COLORS.failureColor, fontWeight: "bold" }}>
                                {endpoint.failed_requests?.toLocaleString() || 0}
                              </TableCell>
                              <TableCell align="center">
                                <Typography
                                  variant="body2"
                                  sx={{
                                    color:
                                      endpoint.success_rate >= 95
                                        ? COLORS.successColor
                                        : endpoint.success_rate >= 90
                                        ? "#ff9800"
                                        : COLORS.failureColor,
                                    fontWeight: "bold",
                                  }}
                                >
                                  {endpoint.success_rate}%
                                </Typography>
                              </TableCell>
                              <TableCell align="center">{endpoint.avg_duration_ms}ms</TableCell>
                            </TableRow>
                          );
                        })
                      ) : (
                        <TableRow>
                          <TableCell colSpan={7} align="center" sx={{ py: 3 }}>
                            <Typography color="textSecondary">No endpoint data available</Typography>
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </TableContainer>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      </Box>
    </Box>
  );
}

export default Dashboard;
