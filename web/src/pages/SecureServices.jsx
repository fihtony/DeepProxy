import React, { useState, useEffect, useMemo } from "react";
import { useSelector } from "react-redux";
import {
  Box,
  Card,
  CardContent,
  Typography,
  TextField,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Dialog,
  DialogContent,
  DialogTitle,
  Grid,
  CircularProgress,
  Alert,
  Paper,
  Chip,
  Tooltip,
  FormControlLabel,
  Checkbox,
  IconButton,
  InputAdornment,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import ClearIcon from "@mui/icons-material/Clear";
import { getSecureServices, getSecureServiceDetail } from "../services/api";
import { getEndpointTypeTag } from "../utils/endpointTagUtils";
import { compareVersions } from "../utils/versionComparison";
import MethodTag from "../components/MethodTag";
import JsonDisplay from "../components/JsonDisplay";
import SectionWithCopy from "../components/SectionWithCopy";
import { getDisplayType } from "../utils/endpointTypeUtils";
import { getFilterOptionsFromServices } from "../utils/filterOptions";

const COLORS = {
  success: "#4CAF50",
  transmit: "#FF6B35",
  secure: "#942fd3",
  public: "#4CAF50",
};

function SecureServices() {
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedService, setSelectedService] = useState(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);

  // Get endpoint config from Redux to apply tags
  const endpointConfig = useSelector((state) => state.config?.endpointConfig);

  // Filter states (platform/language/environment: "" = ALL, default)
  const [filters, setFilters] = useState({
    endpoint: "",
    user_id: "",
    version: "",
    platform: "",
    language: "",
    environment: "",
  });

  // Sorting state: null for no sort, {column, direction}
  const [sortState, setSortState] = useState(null);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const RECORDS_PER_PAGE = 50;

  // Track initialization to prevent double fetch in StrictMode
  const initializedRef = React.useRef(false);

  // Fetch services - accepts optional filters parameter to avoid state race conditions
  const fetchServices = async (filterOverride = null) => {
    setLoading(true);
    setError(null);
    try {
      const activeFilters = filterOverride || filters;
      const params = {};
      if (activeFilters.user_id) params.user_id = activeFilters.user_id;
      if (activeFilters.version) params.version = activeFilters.version;
      if (activeFilters.platform) params.platform = activeFilters.platform;
      if (activeFilters.language) params.language = activeFilters.language;
      if (activeFilters.environment) params.environment = activeFilters.environment;

      const response = await getSecureServices(params);
      setServices(response.data || []);
    } catch (err) {
      setError(err.message || "Failed to fetch services");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Only fetch on initial mount, not during StrictMode remounts
    if (!initializedRef.current) {
      initializedRef.current = true;
      fetchServices();
    }
  }, []);

  const handleFilterChange = (e) => {
    const { name, value } = e.target;
    setFilters((prev) => ({
      ...prev,
      [name]: value,
    }));
    setCurrentPage(1); // Reset to first page when filters change
  };

  const handleFilterKeyDown = (e) => {
    if (e.key === "Enter") {
      // Just clear the Enter key, filtering now happens automatically via useMemo
    }
  };

  const handleResetFilters = () => {
    const clearedFilters = {
      endpoint: "",
      user_id: "",
      version: "",
      platform: "",
      language: "",
      environment: "",
    };
    setFilters(clearedFilters);
    setCurrentPage(1); // Reset to first page when filters are cleared
  };

  const handleViewDetails = async (service) => {
    setDetailOpen(true);
    setDetailLoading(true);
    try {
      // Use response_id instead of id (request_id) to get unique request/response pair
      const response = await getSecureServiceDetail(service.response_id);
      setSelectedService(response.data);
    } catch (err) {
      setError(err.message);
      setDetailOpen(false);
    } finally {
      setDetailLoading(false);
    }
  };

  const handleCloseDetail = () => {
    setDetailOpen(false);
    setSelectedService(null);
  };

  const parseJSON = (str) => {
    try {
      return typeof str === "string" ? JSON.parse(str) : str;
    } catch {
      return str;
    }
  };

  // Helper functions for timestamps and latest filtering
  const formatLocalDateTime = (isoString) => {
    if (!isoString) return "";
    const date = new Date(isoString);
    // Explicitly use local timezone (timeZone: undefined means browser's local timezone)
    return date.toLocaleString("en-US", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      timeZone: undefined,
    });
  };

  // Find latest endpoint by specific combination
  const getLatestEndpoints = (servicesList) => {
    const latestMap = new Map();
    servicesList.forEach((service) => {
      // Key: user_id + endpoint_name + platform + version + language + environment
      const key = `${service.user_id}|${service.endpoint_name}|${service.app_platform}|${service.app_version}|${service.app_language}|${service.app_environment}`;
      const existing = latestMap.get(key);
      if (!existing || new Date(service.created_at) > new Date(existing.created_at)) {
        latestMap.set(key, service);
      }
    });
    return latestMap;
  };

  // Derive platform/language/environment filter options from list response (distinct app_platform, app_language, app_environment)
  const filterOptions = useMemo(() => getFilterOptionsFromServices(services), [services]);

  // Filter services based on endpoint name
  const endpointFilteredServices = useMemo(() => {
    if (!services) return services;
    return services.filter((service) => {
      // Endpoint filter (partial match)
      if (filters.endpoint && !(service.endpoint_name || "").toLowerCase().includes(filters.endpoint.toLowerCase())) {
        return false;
      }
      // User ID filter (partial match)
      if (filters.user_id && !(service.user_identifier || service.user_id || "").toString().includes(filters.user_id)) {
        return false;
      }
      // Version filter (partial match)
      if (filters.version && !(service.app_version || "").includes(filters.version)) {
        return false;
      }
      // Platform filter (exact match)
      if (filters.platform && service.app_platform !== filters.platform) {
        return false;
      }
      // Language filter (exact match)
      if (filters.language && service.app_language !== filters.language) {
        return false;
      }
      // Environment filter (exact match)
      if (filters.environment && service.app_environment !== filters.environment) {
        return false;
      }
      return true;
    });
  }, [services, filters]);

  // Filter services based on latestOnly toggle
  const filteredServices = useMemo(() => {
    if (!services) return endpointFilteredServices;
    const latestMap = getLatestEndpoints(endpointFilteredServices);
    return endpointFilteredServices;
  }, [endpointFilteredServices]);

  // Mark latest endpoints
  const latestEndpoints = useMemo(() => getLatestEndpoints(services), [services]);

  // Sort services
  const sortedServices = useMemo(() => {
    const toSort = [...filteredServices];
    if (!sortState) return toSort;

    toSort.sort((a, b) => {
      let aVal = a[sortState.column];
      let bVal = b[sortState.column];

      // Handle date columns (created_at, updated_at)
      if (sortState.column === "created_at" || sortState.column === "updated_at") {
        const aDate = new Date(aVal || 0).getTime();
        const bDate = new Date(bVal || 0).getTime();
        return sortState.direction === "asc" ? aDate - bDate : bDate - aDate;
      }

      // Handle version comparison (semantic versioning)
      if (sortState.column === "app_version") {
        const versionComparison = compareVersions(String(aVal || ""), String(bVal || ""));
        return sortState.direction === "asc" ? versionComparison : -versionComparison;
      }

      // Handle numeric values (including response_status)
      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortState.direction === "asc" ? aVal - bVal : bVal - aVal;
      }

      // Handle string values
      aVal = String(aVal || "").toLowerCase();
      bVal = String(bVal || "").toLowerCase();
      const comparison = aVal.localeCompare(bVal);
      return sortState.direction === "asc" ? comparison : -comparison;
    });

    return toSort;
  }, [filteredServices, sortState]);

  // Pagination calculation
  const totalRecords = sortedServices.length;
  const totalPages = Math.ceil(totalRecords / RECORDS_PER_PAGE);
  const startIndex = (currentPage - 1) * RECORDS_PER_PAGE;
  const endIndex = startIndex + RECORDS_PER_PAGE;
  const paginatedServices = sortedServices.slice(startIndex, endIndex);

  // Handle pagination
  const handlePreviousPage = () => {
    if (currentPage > 1) {
      setCurrentPage(currentPage - 1);
    }
  };

  const handleNextPage = () => {
    if (currentPage < totalPages) {
      setCurrentPage(currentPage + 1);
    }
  };

  // Handle column header click for sorting
  const handleColumnClick = (column) => {
    const columnsStartWithDesc = ["updated_at", "response_status", "app_version"];
    const startsWithDesc = columnsStartWithDesc.includes(column);

    if (sortState?.column === column) {
      if (startsWithDesc) {
        // For these columns: desc -> asc -> none
        if (sortState.direction === "desc") {
          setSortState({ column, direction: "asc" });
        } else {
          setSortState(null);
        }
      } else {
        // For other columns: asc -> desc -> none
        if (sortState.direction === "asc") {
          setSortState({ column, direction: "desc" });
        } else {
          setSortState(null);
        }
      }
    } else {
      const startDirection = startsWithDesc ? "desc" : "asc";
      setSortState({ column, direction: startDirection });
    }
    setCurrentPage(1); // Reset to first page when sorting changes
  };

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h5" gutterBottom>
        🔒 Secure Services
      </Typography>
      <Typography variant="caption" color="textSecondary">
        (Includes Transmit/Authentication Endpoints)
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {/* Filters */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Grid container spacing={1.5} alignItems="flex-end">
            <Grid item xs={12} sm={6} md={1.8}>
              <TextField
                fullWidth
                label="Endpoint"
                name="endpoint"
                value={filters.endpoint}
                onChange={handleFilterChange}
                onKeyDown={handleFilterKeyDown}
                placeholder="Filter by endpoint"
                size="small"
                InputLabelProps={{ shrink: true }}
                InputProps={{
                  endAdornment: filters.endpoint ? (
                    <InputAdornment position="end">
                      <IconButton
                        size="small"
                        onClick={() => {
                          setFilters((prev) => ({ ...prev, endpoint: "" }));
                          setCurrentPage(1);
                        }}
                        onMouseDown={(e) => e.preventDefault()}
                        edge="end"
                        aria-label="Clear endpoint"
                        sx={{ padding: "4px", color: "action.disabled" }}
                      >
                        <ClearIcon sx={{ fontSize: "1rem" }} />
                      </IconButton>
                    </InputAdornment>
                  ) : null,
                }}
                sx={{ "& .MuiInputBase-input": { fontSize: "0.85rem" }, "& .MuiInputLabel-root": { fontSize: "0.85rem" } }}
              />
            </Grid>
            <Grid item xs={12} sm={6} md={1.5}>
              <TextField
                fullWidth
                label="User ID"
                name="user_id"
                value={filters.user_id}
                onChange={handleFilterChange}
                onKeyDown={handleFilterKeyDown}
                placeholder="e.g., user1"
                size="small"
                InputLabelProps={{ shrink: true }}
                InputProps={{
                  endAdornment: filters.user_id ? (
                    <InputAdornment position="end">
                      <IconButton
                        size="small"
                        onClick={() => {
                          setFilters((prev) => ({ ...prev, user_id: "" }));
                          setCurrentPage(1);
                        }}
                        onMouseDown={(e) => e.preventDefault()}
                        edge="end"
                        aria-label="Clear user ID"
                        sx={{ padding: "4px", color: "action.disabled" }}
                      >
                        <ClearIcon sx={{ fontSize: "1rem" }} />
                      </IconButton>
                    </InputAdornment>
                  ) : null,
                }}
                sx={{ "& .MuiInputBase-input": { fontSize: "0.85rem" }, "& .MuiInputLabel-root": { fontSize: "0.85rem" } }}
              />
            </Grid>
            <Grid item xs={12} sm={6} md={1.5}>
              <TextField
                fullWidth
                label="Version"
                name="version"
                value={filters.version}
                onChange={handleFilterChange}
                onKeyDown={handleFilterKeyDown}
                placeholder="e.g., 1.0.0"
                size="small"
                InputLabelProps={{ shrink: true }}
                InputProps={{
                  endAdornment: filters.version ? (
                    <InputAdornment position="end">
                      <IconButton
                        size="small"
                        onClick={() => {
                          setFilters((prev) => ({ ...prev, version: "" }));
                          setCurrentPage(1);
                        }}
                        onMouseDown={(e) => e.preventDefault()}
                        edge="end"
                        aria-label="Clear version"
                        sx={{ padding: "4px", color: "action.disabled" }}
                      >
                        <ClearIcon sx={{ fontSize: "1rem" }} />
                      </IconButton>
                    </InputAdornment>
                  ) : null,
                }}
                sx={{ "& .MuiInputBase-input": { fontSize: "0.85rem" }, "& .MuiInputLabel-root": { fontSize: "0.85rem" } }}
              />
            </Grid>
            <Grid item xs={12} sm={6} md={1.5}>
              <TextField
                fullWidth
                label="Platform"
                name="platform"
                value={filters.platform}
                onChange={handleFilterChange}
                select
                SelectProps={{
                  native: true,
                }}
                size="small"
                InputLabelProps={{ shrink: true }}
                sx={{ "& .MuiInputBase-input": { fontSize: "0.85rem" }, "& .MuiInputLabel-root": { fontSize: "0.85rem" } }}
              >
                {filterOptions.platformOptions.map((opt) => (
                  <option key={opt.value || "all"} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </TextField>
            </Grid>
            <Grid item xs={12} sm={6} md={1.5}>
              <TextField
                fullWidth
                label="Language"
                name="language"
                value={filters.language}
                onChange={handleFilterChange}
                select
                SelectProps={{
                  native: true,
                }}
                size="small"
                InputLabelProps={{ shrink: true }}
                sx={{ "& .MuiInputBase-input": { fontSize: "0.85rem" }, "& .MuiInputLabel-root": { fontSize: "0.85rem" } }}
              >
                {filterOptions.languageOptions.map((opt) => (
                  <option key={opt.value || "all"} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </TextField>
            </Grid>
            <Grid item xs={12} sm={6} md={1.5}>
              <TextField
                fullWidth
                label="Environment"
                name="environment"
                value={filters.environment}
                onChange={handleFilterChange}
                select
                SelectProps={{
                  native: true,
                }}
                size="small"
                InputLabelProps={{ shrink: true }}
                sx={{ "& .MuiInputBase-input": { fontSize: "0.85rem" }, "& .MuiInputLabel-root": { fontSize: "0.85rem" } }}
              >
                {filterOptions.environmentOptions.map((opt) => (
                  <option key={opt.value || "all"} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </TextField>
            </Grid>
            <Grid item xs={12} md="auto" sx={{ display: "flex", gap: 0.5, justifyContent: "flex-end", alignItems: "center", ml: "auto" }}>
              <Button variant="outlined" onClick={handleResetFilters} size="small" sx={{ fontSize: "0.85rem" }}>
                Reset
              </Button>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      {/* Services Table */}
      {loading ? (
        <Box sx={{ display: "flex", justifyContent: "center", p: 3 }}>
          <CircularProgress />
        </Box>
      ) : (
        <Card>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ backgroundColor: "#f5f5f5", height: "36px" }}>
                  <TableCell
                    onClick={() => handleColumnClick("endpoint_name")}
                    sx={{
                      fontWeight: "bold",
                      fontSize: "0.85rem",
                      padding: "4px 8px",
                      cursor: "pointer",
                      userSelect: "none",
                      backgroundColor: sortState?.column === "endpoint_name" ? "#e0e0e0" : "inherit",
                    }}
                  >
                    Endpoint {sortState?.column === "endpoint_name" && (sortState.direction === "asc" ? "↑" : "↓")}
                  </TableCell>
                  <TableCell
                    onClick={() => handleColumnClick("method")}
                    sx={{
                      fontWeight: "bold",
                      fontSize: "0.85rem",
                      padding: "4px 8px",
                      cursor: "pointer",
                      userSelect: "none",
                      textAlign: "center",
                      backgroundColor: sortState?.column === "method" ? "#e0e0e0" : "inherit",
                    }}
                  >
                    Method {sortState?.column === "method" && (sortState.direction === "asc" ? "↑" : "↓")}
                  </TableCell>
                  <TableCell sx={{ fontWeight: "bold", fontSize: "0.85rem", padding: "4px 8px", textAlign: "center" }}>Type</TableCell>
                  <TableCell
                    onClick={() => handleColumnClick("user_id")}
                    sx={{
                      fontWeight: "bold",
                      fontSize: "0.85rem",
                      padding: "4px 8px",
                      cursor: "pointer",
                      userSelect: "none",
                      textAlign: "center",
                      backgroundColor: sortState?.column === "user_id" ? "#e0e0e0" : "inherit",
                    }}
                  >
                    User {sortState?.column === "user_id" && (sortState.direction === "asc" ? "↑" : "↓")}
                  </TableCell>
                  <TableCell
                    onClick={() => handleColumnClick("app_platform")}
                    sx={{
                      fontWeight: "bold",
                      fontSize: "0.85rem",
                      padding: "4px 8px",
                      cursor: "pointer",
                      userSelect: "none",
                      textAlign: "center",
                      backgroundColor: sortState?.column === "app_platform" ? "#e0e0e0" : "inherit",
                    }}
                  >
                    Platform {sortState?.column === "app_platform" && (sortState.direction === "asc" ? "↑" : "↓")}
                  </TableCell>
                  <TableCell
                    onClick={() => handleColumnClick("app_version")}
                    sx={{
                      fontWeight: "bold",
                      fontSize: "0.85rem",
                      padding: "4px 8px",
                      cursor: "pointer",
                      userSelect: "none",
                      textAlign: "center",
                      backgroundColor: sortState?.column === "app_version" ? "#e0e0e0" : "inherit",
                    }}
                  >
                    Version {sortState?.column === "app_version" && (sortState.direction === "asc" ? "↑" : "↓")}
                  </TableCell>
                  <TableCell
                    onClick={() => handleColumnClick("app_language")}
                    sx={{
                      fontWeight: "bold",
                      fontSize: "0.85rem",
                      padding: "4px 8px",
                      cursor: "pointer",
                      userSelect: "none",
                      textAlign: "center",
                      backgroundColor: sortState?.column === "app_language" ? "#e0e0e0" : "inherit",
                    }}
                  >
                    Language {sortState?.column === "app_language" && (sortState.direction === "asc" ? "↑" : "↓")}
                  </TableCell>
                  <TableCell
                    onClick={() => handleColumnClick("app_environment")}
                    sx={{
                      fontWeight: "bold",
                      fontSize: "0.85rem",
                      padding: "4px 8px",
                      cursor: "pointer",
                      userSelect: "none",
                      textAlign: "center",
                      backgroundColor: sortState?.column === "app_environment" ? "#e0e0e0" : "inherit",
                    }}
                  >
                    Env {sortState?.column === "app_environment" && (sortState.direction === "asc" ? "↑" : "↓")}
                  </TableCell>
                  <TableCell
                    onClick={() => handleColumnClick("response_status")}
                    sx={{
                      fontWeight: "bold",
                      fontSize: "0.85rem",
                      padding: "4px 8px",
                      cursor: "pointer",
                      userSelect: "none",
                      textAlign: "center",
                      backgroundColor: sortState?.column === "response_status" ? "#e0e0e0" : "inherit",
                    }}
                  >
                    Status {sortState?.column === "response_status" && (sortState.direction === "asc" ? "↑" : "↓")}
                  </TableCell>
                  <TableCell
                    onClick={() => handleColumnClick("updated_at")}
                    sx={{
                      fontWeight: "bold",
                      fontSize: "0.85rem",
                      padding: "4px 8px",
                      cursor: "pointer",
                      userSelect: "none",
                      textAlign: "center",
                      backgroundColor: sortState?.column === "updated_at" ? "#e0e0e0" : "inherit",
                    }}
                  >
                    Timestamp {sortState?.column === "updated_at" && (sortState.direction === "asc" ? "↑" : "↓")}
                  </TableCell>
                  <TableCell sx={{ fontWeight: "bold", fontSize: "0.85rem", padding: "4px 8px" }} align="center">
                    Action
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {paginatedServices && paginatedServices.length > 0 ? (
                  paginatedServices.map((service, index) => {
                    const key = `${service.user_id}|${service.endpoint_name}|${service.app_platform}|${service.app_version}|${service.app_language}|${service.app_environment}`;
                    const isLatest = latestEndpoints.get(key)?.id === service.id;
                    return (
                      <TableRow key={`secure-${service.id}-${index}`} hover sx={{ height: "32px" }}>
                        <TableCell sx={{ fontSize: "0.9rem", padding: "4px 8px", maxWidth: "400px", overflow: "hidden" }}>
                          <Tooltip title={service.full_path}>
                            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {service.endpoint_name}
                                {service.query_params && (
                                  <>
                                    ?
                                    {Object.entries(JSON.parse(service.query_params || "{}")).map(([key, value], idx, arr) => (
                                      <span key={key}>
                                        {key}={value || ""}
                                        {idx < arr.length - 1 ? "&" : ""}
                                      </span>
                                    ))}
                                  </>
                                )}
                              </span>
                            </Box>
                          </Tooltip>
                        </TableCell>
                        <TableCell sx={{ fontSize: "0.9rem", padding: "4px 6px", minWidth: "40px", textAlign: "center" }}>
                          <MethodTag method={service.method} fontSize="0.65rem" />
                        </TableCell>
                        <TableCell sx={{ padding: "4px 8px", minWidth: "50px", textAlign: "center" }}>
                          {(() => {
                            const typeTag = getEndpointTypeTag(service.endpoint_path, endpointConfig, "secure");
                            return (
                              <Chip
                                label={typeTag.name}
                                size="small"
                                sx={{
                                  backgroundColor: typeTag.color,
                                  color: "white",
                                  fontSize: "0.65rem",
                                  height: "20px",
                                }}
                              />
                            );
                          })()}
                        </TableCell>
                        <TableCell
                          sx={{
                            fontSize: "0.9rem",
                            padding: "4px 6px",
                            minWidth: "120px",
                            textAlign: "center",
                            backgroundColor:
                              filters.user_id &&
                              (service.user_identifier?.includes(filters.user_id) || String(service.user_id).includes(filters.user_id))
                                ? "#fff3cd"
                                : "inherit",
                          }}
                        >
                          {service.user_identifier || service.user_id}
                        </TableCell>
                        <TableCell sx={{ fontSize: "0.9rem", padding: "4px 6px", minWidth: "60px", textAlign: "center" }}>
                          {service.app_platform}
                        </TableCell>
                        <TableCell
                          sx={{
                            fontSize: "0.9rem",
                            padding: "4px 6px",
                            minWidth: "50px",
                            textAlign: "center",
                            backgroundColor: filters.version && service.app_version.includes(filters.version) ? "#fff3cd" : "inherit",
                          }}
                        >
                          {service.app_version}
                        </TableCell>
                        <TableCell sx={{ fontSize: "0.9rem", padding: "4px 6px", minWidth: "50px", textAlign: "center" }}>
                          {service.app_language}
                        </TableCell>
                        <TableCell sx={{ fontSize: "0.9rem", padding: "4px 6px", minWidth: "50px", textAlign: "center" }}>
                          {service.app_environment}
                        </TableCell>
                        <TableCell sx={{ padding: "4px 6px", minWidth: "50px", textAlign: "center" }}>
                          <Chip
                            label={`${service.response_status}`}
                            size="small"
                            sx={{
                              backgroundColor: service.response_status >= 200 && service.response_status < 300 ? COLORS.success : "#FF9800",
                              color: "white",
                              fontSize: "0.65rem",
                              height: "20px",
                            }}
                          />
                        </TableCell>
                        <TableCell
                          sx={{
                            fontSize: "0.75rem",
                            padding: "4px 6px",
                            minWidth: "140px",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            textAlign: "center",
                          }}
                        >
                          <Tooltip
                            title={`Created: ${formatLocalDateTime(service.created_at)}\nUpdated: ${formatLocalDateTime(
                              service.updated_at
                            )}`}
                          >
                            <span>{formatLocalDateTime(service.updated_at || service.created_at)}</span>
                          </Tooltip>
                        </TableCell>
                        <TableCell align="center" sx={{ padding: "4px 4px" }}>
                          <Tooltip title="View Details">
                            <IconButton size="small" onClick={() => handleViewDetails(service)} sx={{ padding: "2px" }}>
                              <SearchIcon sx={{ fontSize: "1rem" }} />
                            </IconButton>
                          </Tooltip>
                        </TableCell>
                      </TableRow>
                    );
                  })
                ) : (
                  <TableRow>
                    <TableCell colSpan={11} align="center" sx={{ py: 3 }}>
                      No secure services found
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>

          {/* Pagination Controls */}
          {sortedServices.length > 0 && (
            <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", p: 1, backgroundColor: "transparent" }}>
              <Typography sx={{ fontSize: "0.75rem", color: "#666", fontWeight: "normal" }}>
                {totalRecords <= RECORDS_PER_PAGE
                  ? `${totalRecords} items`
                  : `${startIndex + 1} ~ ${Math.min(endIndex, totalRecords)} of ${totalRecords}`}
              </Typography>
              {totalRecords > RECORDS_PER_PAGE && (
                <Box sx={{ display: "flex", gap: 0.5, alignItems: "center" }}>
                  <Typography
                    onClick={handlePreviousPage}
                    disabled={currentPage === 1}
                    sx={{
                      fontSize: "0.75rem",
                      cursor: currentPage === 1 ? "default" : "pointer",
                      color: currentPage === 1 ? "#ccc" : "#666",
                      userSelect: "none",
                      fontWeight: "bold",
                      "&:hover": currentPage === 1 ? {} : { color: "#000" },
                    }}
                  >
                    &lt;
                  </Typography>
                  <Typography sx={{ fontSize: "0.75rem", color: "#666", fontWeight: "normal", margin: "0 4px" }}>
                    {currentPage} of {totalPages}
                  </Typography>
                  <Typography
                    onClick={handleNextPage}
                    disabled={currentPage === totalPages}
                    sx={{
                      fontSize: "0.75rem",
                      cursor: currentPage === totalPages ? "default" : "pointer",
                      color: currentPage === totalPages ? "#ccc" : "#666",
                      userSelect: "none",
                      fontWeight: "bold",
                      "&:hover": currentPage === totalPages ? {} : { color: "#000" },
                    }}
                  >
                    &gt;
                  </Typography>
                </Box>
              )}
            </Box>
          )}
        </Card>
      )}

      {/* Detail Dialog */}
      <Dialog open={detailOpen} onClose={handleCloseDetail} maxWidth="lg" fullWidth>
        <DialogTitle>Service Details</DialogTitle>
        <DialogContent>
          {detailLoading ? (
            <Box sx={{ display: "flex", justifyContent: "center", p: 3 }}>
              <CircularProgress />
            </Box>
          ) : selectedService ? (
            <Box sx={{ pt: 2 }}>
              <Grid container spacing={2}>
                <Grid item xs={12}>
                  <Paper sx={{ p: 2, backgroundColor: "#f5f5f5" }}>
                    <Typography variant="subtitle2" gutterBottom>
                      📍 Endpoint Information
                    </Typography>
                    <Typography variant="body2">
                      <strong>Name:</strong> {selectedService.endpoint_name}
                    </Typography>
                    <Typography variant="body2">
                      <strong>Path:</strong> {selectedService.full_path}
                    </Typography>
                    <Typography variant="body2">
                      <strong>Method:</strong> {selectedService.method}
                    </Typography>
                    <Typography variant="body2">
                      <strong>Type:</strong> {getDisplayType(selectedService.endpoint_path, selectedService.endpoint_type, "Secure")}
                    </Typography>
                    <Typography variant="body2">
                      <strong>User:</strong> {selectedService.user_identifier || selectedService.user_id}
                    </Typography>
                    <Typography variant="body2">
                      <strong>Created:</strong> {new Date(selectedService.created_at).toLocaleString()}
                    </Typography>
                    <Typography variant="body2">
                      <strong>Updated:</strong> {new Date(selectedService.updated_at || selectedService.created_at).toLocaleString()}
                    </Typography>
                  </Paper>
                </Grid>

                <Grid item xs={12}>
                  <Paper sx={{ p: 2, backgroundColor: "#f5f5f5" }}>
                    <Typography variant="subtitle2" gutterBottom>
                      📱 Request Details
                    </Typography>
                    {selectedService.request_headers && (
                      <SectionWithCopy title="Headers:" copyContent={selectedService.request_headers} copyLabel="Copy headers">
                        <JsonDisplay data={parseJSON(selectedService.request_headers)} maxHeight="200px" />
                      </SectionWithCopy>
                    )}
                    {selectedService.request_body && (
                      <SectionWithCopy title="Body:" copyContent={selectedService.request_body} copyLabel="Copy body">
                        <JsonDisplay data={parseJSON(selectedService.request_body)} maxHeight="200px" />
                      </SectionWithCopy>
                    )}
                  </Paper>
                </Grid>

                <Grid item xs={12}>
                  <Paper sx={{ p: 2, backgroundColor: "#f5f5f5" }}>
                    <Typography variant="subtitle2" gutterBottom>
                      ✅ Response Details
                    </Typography>
                    <Typography variant="body2">
                      <strong>Status:</strong> {selectedService.response_status}
                    </Typography>
                    {selectedService.response_headers && (
                      <SectionWithCopy title="Headers:" copyContent={selectedService.response_headers} copyLabel="Copy headers">
                        <JsonDisplay data={parseJSON(selectedService.response_headers)} maxHeight="200px" />
                      </SectionWithCopy>
                    )}
                    {selectedService.response_body && (
                      <SectionWithCopy title="Body:" copyContent={selectedService.response_body} copyLabel="Copy body">
                        <JsonDisplay data={parseJSON(selectedService.response_body)} maxHeight="300px" />
                      </SectionWithCopy>
                    )}
                  </Paper>
                </Grid>
              </Grid>
            </Box>
          ) : null}
        </DialogContent>
      </Dialog>
    </Box>
  );
}

export default SecureServices;
