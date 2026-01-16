import React, { useEffect, useState, useMemo } from "react";
import { useDispatch, useSelector } from "react-redux";
import {
  Box,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Button,
  TextField,
  Typography,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  FormControl,
  InputLabel,
  InputAdornment,
  Select,
  MenuItem,
  Alert,
  Switch,
  Tooltip,
  Autocomplete,
  Grid,
  Chip,
} from "@mui/material";
import {
  Edit as EditIcon,
  Delete as DeleteIcon,
  Add as AddIcon,
  Refresh as RefreshIcon,
  PlayArrow as ReplayIcon,
  FiberManualRecord as RecordIcon,
  Search as SearchIcon,
  Clear as ClearIcon,
} from "@mui/icons-material";
import {
  fetchConfigs,
  fetchAvailableEndpoints,
  createConfig,
  updateConfig,
  toggleConfig,
  deleteConfig,
  selectConfigs,
  selectAvailableEndpoints,
  selectEndpointsLoading,
  selectEndpointsError,
} from "../store/slices/endpointSlice";
import MethodTag from "../components/MethodTag";

const EndpointManagement = () => {
  const dispatch = useDispatch();
  const configs = useSelector(selectConfigs);
  const availableEndpoints = useSelector(selectAvailableEndpoints);
  const loading = useSelector(selectEndpointsLoading);
  const error = useSelector(selectEndpointsError);

  // Extract unique methods from available endpoints
  const availableMethods = useMemo(() => {
    const methods = new Set(availableEndpoints.map((ep) => ep.method));
    return Array.from(methods).sort();
  }, [availableEndpoints]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogType, setDialogType] = useState("replay"); // 'replay' or 'recording'
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteTargetConfig, setDeleteTargetConfig] = useState(null);
  const [selectedConfig, setSelectedConfig] = useState(null);
  const [endpointFilter, setEndpointFilter] = useState(""); // Endpoint text filter for table
  const [formData, setFormData] = useState({
    http_method: "",
    endpoint_pattern: "",
    match_query_params: "",
    match_version: false,
    match_language: true,
    match_platform: true,
    match_environment: "exact",
    match_headers: "",
    match_body: "",
    match_response_status: "2xx",
    priority: 10,
    enabled: true,
    type: "replay",
  });

  // Track initialization to prevent double fetch in StrictMode
  const initializedRef = React.useRef(false);

  useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true;
      dispatch(fetchConfigs());
      dispatch(fetchAvailableEndpoints());
    }
  }, [dispatch]);

  // Filter endpoints based on selected method
  const filteredEndpoints = useMemo(() => {
    if (!formData.http_method) {
      return availableEndpoints;
    }
    return availableEndpoints.filter((ep) => ep.method === formData.http_method);
  }, [availableEndpoints, formData.http_method]);

  // Filter methods based on selected endpoint
  const filteredMethods = useMemo(() => {
    if (!formData.endpoint_pattern) {
      return availableMethods;
    }
    const endpointMethods = availableEndpoints.filter((ep) => ep.endpoint_path === formData.endpoint_pattern).map((ep) => ep.method);
    return [...new Set(endpointMethods)].sort();
  }, [availableEndpoints, availableMethods, formData.endpoint_pattern]);

  // Filter configs based on endpoint text filter (case-insensitive partial matching)
  const filteredConfigs = useMemo(() => {
    if (!endpointFilter.trim()) {
      return configs;
    }
    const filterLower = endpointFilter.toLowerCase();
    return configs.filter((config) => config.endpoint_pattern.toLowerCase().includes(filterLower));
  }, [configs, endpointFilter]);

  const handleOpenDialog = (config = null, ruleType = "replay") => {
    if (config) {
      // Editing existing config
      const configType = config.type || "replay";
      setDialogType(configType);
      setSelectedConfig(config);
      setFormData({
        http_method: config.http_method || "",
        endpoint_pattern: config.endpoint_pattern || "",
        match_query_params: config.match_query_params ? JSON.parse(config.match_query_params).join(", ") : "",
        match_version: config.match_version === 1,
        match_language: config.match_language === 1,
        match_platform: config.match_platform === 1,
        match_environment: config.match_environment || "exact",
        match_headers: config.match_headers ? JSON.parse(config.match_headers).join(", ") : "",
        match_body: config.match_body ? JSON.parse(config.match_body).join(", ") : "",
        match_response_status: config.match_response_status || "2xx",
        priority: config.priority !== null && config.priority !== undefined ? config.priority : 10,
        enabled: config.enabled === 1,
        type: configType,
      });
    } else {
      // Adding new config
      setDialogType(ruleType);
      setSelectedConfig(null);
      setFormData({
        http_method: "",
        endpoint_pattern: "",
        match_query_params: "",
        match_version: ruleType === "recording" ? true : false, // Default to Exact for recording
        match_language: true,
        match_platform: true,
        match_environment: "exact",
        match_headers: "",
        match_body: "",
        match_response_status: "2xx",
        priority: 10,
        enabled: true,
        type: ruleType,
      });
    }
    // Remove redundant API call - data is already loaded on page init
    setDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
    setSelectedConfig(null);
    setDialogType("replay");
  };

  const handleSave = async () => {
    const data = {
      http_method: formData.http_method,
      endpoint_pattern: formData.endpoint_pattern,
      match_query_params: formData.match_query_params
        ? JSON.stringify(
            formData.match_query_params
              .split(",")
              .map((s) => s.trim())
              .filter((s) => s)
          )
        : null,
      match_version: formData.match_version,
      match_language: formData.match_language,
      match_platform: formData.match_platform,
      match_environment: formData.match_environment,
      match_headers: formData.match_headers
        ? JSON.stringify(
            formData.match_headers
              .split(",")
              .map((s) => s.trim())
              .filter((s) => s)
          )
        : null,
      match_body: formData.match_body
        ? JSON.stringify(
            formData.match_body
              .split(",")
              .map((s) => s.trim())
              .filter((s) => s)
          )
        : null,
      match_response_status: dialogType === "recording" ? "2xx" : formData.match_response_status,
      priority: formData.priority !== "" && !isNaN(parseInt(formData.priority, 10)) ? parseInt(formData.priority, 10) : 10,
      enabled: formData.enabled,
      type: dialogType,
    };

    if (selectedConfig) {
      await dispatch(updateConfig({ id: selectedConfig.id, data }));
    } else {
      await dispatch(createConfig(data));
    }
    handleCloseDialog();
    dispatch(fetchConfigs());
  };

  const handleToggle = async (id, currentEnabled) => {
    await dispatch(toggleConfig({ id, enabled: !currentEnabled }));
  };

  const handleDelete = (config) => {
    setDeleteTargetConfig(config);
    setDeleteConfirmOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (deleteTargetConfig) {
      await dispatch(deleteConfig(deleteTargetConfig.id));
      setDeleteConfirmOpen(false);
      setDeleteTargetConfig(null);
    }
  };

  const handleCancelDelete = () => {
    setDeleteConfirmOpen(false);
    setDeleteTargetConfig(null);
  };

  const handleMethodChange = (method) => {
    setFormData({ ...formData, http_method: method });
    // No need to fetch - data is already loaded and filtered via useMemo
  };

  const handleEndpointChange = (endpoint) => {
    setFormData({ ...formData, endpoint_pattern: endpoint });
    // Methods are automatically filtered via filteredMethods useMemo
  };

  // Parse JSON array to display string
  const parseJsonArray = (jsonStr) => {
    if (!jsonStr) return "-";
    try {
      const arr = JSON.parse(jsonStr);
      return arr.length > 0 ? arr.join(", ") : "-";
    } catch {
      return jsonStr;
    }
  };

  // Truncate long array display with smart logic:
  // - If can fit all values: show all
  // - If can't fit but can show "item1 & N more": show that
  // - Otherwise: show "N items"
  const formatArrayDisplay = (jsonStr) => {
    if (!jsonStr) return "-";
    try {
      const arr = JSON.parse(jsonStr);
      if (arr.length === 0) return "-";

      // Column min width is 60px, at 0.75rem font (~12px line height, ~7-8px per char)
      // Practical display limit is around 15-16 characters to avoid overflow
      const maxCharsAvailable = 20;

      // Try to show all items
      const fullDisplay = arr.join(", ");
      if (fullDisplay.length <= maxCharsAvailable) {
        return fullDisplay;
      }

      // Try to show first item + "& N more" format
      if (arr.length > 1) {
        const firstItem = arr[0];
        const remaining = arr.length - 1;
        const shortFormat = `${firstItem} & ${remaining} more`;
        if (shortFormat.length <= maxCharsAvailable) {
          return shortFormat;
        }
      }

      // Fall back to "N items" format
      return `${arr.length} items`;
    } catch {
      return jsonStr;
    }
  };

  // Format match settings for display
  const formatMatchSetting = (value, trueLabel, falseLabel) => {
    return value === 1 ? trueLabel : falseLabel;
  };

  // Truncate endpoint path: keep the end, add ... at the beginning if truncated
  const truncateEndpointPath = (path, maxLength = 45) => {
    if (path.length <= maxLength) {
      return path;
    }
    const ellipsis = "...";
    const remaining = maxLength - ellipsis.length;
    return ellipsis + path.slice(-remaining);
  };

  const tableHeaderStyle = {
    fontWeight: "bold",
    fontSize: "0.85rem",
    padding: "4px 8px",
    whiteSpace: "nowrap",
    backgroundColor: "#f5f5f5",
  };

  const tableCellStyle = {
    fontSize: "0.85rem",
    padding: "4px 8px",
    whiteSpace: "nowrap",
    textAlign: "center",
  };

  // Smaller font for array fields (Query Params, Headers, Body) - matches Timestamp in PublicServices
  const arrayFieldCellStyle = {
    ...tableCellStyle,
    fontSize: "0.75rem",
  };

  // Get dialog title based on type and edit mode
  const getDialogTitle = () => {
    if (selectedConfig) {
      return dialogType === "recording" ? "Edit Recording Rule" : "Edit Replay Rule";
    }
    return dialogType === "recording" ? "Add Recording Rule" : "Add Replay Rule";
  };

  // Check if a field should be disabled for recording rules
  const isRecordingDisabledField = (fieldName) => {
    if (dialogType !== "recording") return false;
    const disabledFields = ["match_platform", "match_version", "match_environment", "match_language", "match_headers"];
    return disabledFields.includes(fieldName);
  };

  return (
    <Box p={3}>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3} gap={2}>
        <Box display="flex" alignItems="center" gap={1} flex={1}>
          <Typography variant="h4" sx={{ whiteSpace: "nowrap" }}>
            Endpoint Matching Rules
          </Typography>
        </Box>
      </Box>

      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3} gap={2}>
        <TextField
          placeholder="Filter endpoints..."
          value={endpointFilter}
          onChange={(e) => setEndpointFilter(e.target.value)}
          size="small"
          variant="outlined"
          sx={{
            flex: 1,
            maxWidth: "500px",
            "& .MuiInputBase-input": { fontSize: "0.9rem" },
          }}
          InputProps={{
            startAdornment: <SearchIcon sx={{ mr: 1, color: "action.active" }} />,
            endAdornment: endpointFilter && (
              <InputAdornment position="end">
                <IconButton size="small" onClick={() => setEndpointFilter("")} edge="end" sx={{ p: 0.5 }} title="Clear filter">
                  <ClearIcon sx={{ fontSize: "1rem" }} />
                </IconButton>
              </InputAdornment>
            ),
          }}
        />
        <Box display="flex" gap={1} justifyContent="flex-end">
          <Tooltip title="Refresh">
            <IconButton onClick={() => dispatch(fetchConfigs())} size="small" sx={{ mr: 1 }}>
              <RefreshIcon />
            </IconButton>
          </Tooltip>
          <Button
            variant="outlined"
            startIcon={<RecordIcon sx={{ color: "#d32f2f" }} />}
            onClick={() => handleOpenDialog(null, "recording")}
            sx={{
              mr: 1,
              borderColor: "#d32f2f",
              color: "#d32f2f",
              "&:hover": { borderColor: "#b71c1c", backgroundColor: "rgba(211, 47, 47, 0.04)" },
            }}
          >
            Add Recording Rule
          </Button>
          <Button variant="contained" startIcon={<ReplayIcon />} onClick={() => handleOpenDialog(null, "replay")}>
            Add Replay Rule
          </Button>
        </Box>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {typeof error === "string" ? error : error.error || "An error occurred"}
        </Alert>
      )}

      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow sx={{ height: "36px" }}>
              <TableCell sx={{ ...tableHeaderStyle, minWidth: "50px", textAlign: "center" }}>Type</TableCell>
              <TableCell sx={{ ...tableHeaderStyle, minWidth: "50px", textAlign: "center" }}>Method</TableCell>
              <TableCell sx={{ ...tableHeaderStyle, minWidth: "400px", maxWidth: "600px" }}>Endpoint Path</TableCell>
              <TableCell sx={{ ...tableHeaderStyle, minWidth: "60px", textAlign: "center" }}>Query Params</TableCell>
              <TableCell sx={{ ...tableHeaderStyle, minWidth: "50px", textAlign: "center" }}>Version</TableCell>
              <TableCell sx={{ ...tableHeaderStyle, minWidth: "50px", textAlign: "center" }}>Language</TableCell>
              <TableCell sx={{ ...tableHeaderStyle, minWidth: "50px", textAlign: "center" }}>Platform</TableCell>
              <TableCell sx={{ ...tableHeaderStyle, minWidth: "50px", textAlign: "center" }}>Env</TableCell>
              <TableCell sx={{ ...tableHeaderStyle, minWidth: "60px", textAlign: "center" }}>Headers</TableCell>
              <TableCell sx={{ ...tableHeaderStyle, minWidth: "60px", textAlign: "center" }}>Body</TableCell>
              <TableCell sx={{ ...tableHeaderStyle, minWidth: "50px", textAlign: "center" }}>Response</TableCell>
              <TableCell sx={{ ...tableHeaderStyle, minWidth: "50px", textAlign: "center" }}>Priority</TableCell>
              <TableCell sx={{ ...tableHeaderStyle, minWidth: "50px", textAlign: "center" }}>Enabled</TableCell>
              <TableCell sx={{ ...tableHeaderStyle, minWidth: "50px" }} align="center">
                Actions
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={12} align="center">
                  Loading...
                </TableCell>
              </TableRow>
            ) : filteredConfigs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={14} align="center">
                  {endpointFilter
                    ? "No matching configurations found."
                    : 'No configurations found. Click "Add Replay Rule" or "Add Recording Rule" to create one.'}
                </TableCell>
              </TableRow>
            ) : (
              filteredConfigs.map((config) => {
                const isRecording = config.type === "recording";
                return (
                  <TableRow
                    key={config.id}
                    hover
                    sx={{
                      height: "32px",
                      backgroundColor: isRecording ? "inherit" : "rgba(26, 244, 70, 0.1)",
                      "&:hover": {
                        backgroundColor: isRecording ? undefined : "rgba(26, 244, 70, 0.2) !important",
                      },
                    }}
                  >
                    <TableCell sx={{ ...tableCellStyle, textAlign: "center", padding: "4px" }}>
                      <Tooltip title={isRecording ? "Recording Rule" : "Replay Rule"} arrow>
                        <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center" }}>
                          {isRecording ? (
                            <RecordIcon sx={{ color: "#d32f2f", fontSize: "1.2rem" }} />
                          ) : (
                            <ReplayIcon sx={{ color: "#1976d2", fontSize: "1.2rem" }} />
                          )}
                        </Box>
                      </Tooltip>
                    </TableCell>
                    <TableCell sx={tableCellStyle}>
                      <MethodTag method={config.http_method} fontSize="0.65rem" />
                    </TableCell>
                    <TableCell
                      sx={{
                        ...tableCellStyle,
                        textAlign: "left",
                        maxWidth: "140px",
                        overflow: "hidden",
                        whiteSpace: "nowrap",
                      }}
                    >
                      <Tooltip title={config.endpoint_pattern}>
                        <span style={{ fontFamily: "monospace", fontSize: "0.85rem", display: "inline-block" }}>
                          {truncateEndpointPath(config.endpoint_pattern)}
                        </span>
                      </Tooltip>
                    </TableCell>
                    <TableCell sx={arrayFieldCellStyle}>
                      <Tooltip title={parseJsonArray(config.match_query_params)}>
                        <span>{formatArrayDisplay(config.match_query_params)}</span>
                      </Tooltip>
                    </TableCell>
                    <TableCell sx={tableCellStyle}>{formatMatchSetting(config.match_version, "Exact", "Closest")}</TableCell>
                    <TableCell sx={tableCellStyle}>{formatMatchSetting(config.match_language, "Exact", "Any")}</TableCell>
                    <TableCell sx={tableCellStyle}>{formatMatchSetting(config.match_platform, "Exact", "Any")}</TableCell>
                    <TableCell sx={tableCellStyle}>
                      {config.match_environment === "exact" ? "Exact" : config.match_environment.toUpperCase()}
                    </TableCell>
                    <TableCell sx={arrayFieldCellStyle}>
                      <Tooltip title={parseJsonArray(config.match_headers)}>
                        <span>{formatArrayDisplay(config.match_headers)}</span>
                      </Tooltip>
                    </TableCell>
                    <TableCell sx={arrayFieldCellStyle}>
                      <Tooltip title={parseJsonArray(config.match_body)}>
                        <span>{formatArrayDisplay(config.match_body)}</span>
                      </Tooltip>
                    </TableCell>
                    <TableCell sx={tableCellStyle}>{isRecording ? "-" : config.match_response_status || "2xx"}</TableCell>
                    <TableCell sx={tableCellStyle} align="center">
                      {config.priority}
                    </TableCell>
                    <TableCell sx={tableCellStyle} align="center">
                      <Switch size="small" checked={config.enabled === 1} onChange={() => handleToggle(config.id, config.enabled === 1)} />
                    </TableCell>
                    <TableCell sx={tableCellStyle} align="center">
                      <Tooltip title="Edit">
                        <IconButton size="small" onClick={() => handleOpenDialog(config)}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Delete">
                        <IconButton size="small" color="error" onClick={() => handleDelete(config)}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onClose={handleCloseDialog} maxWidth="md" fullWidth>
        <DialogTitle>{getDialogTitle()}</DialogTitle>
        <DialogContent>
          <Box pt={2}>
            <Grid container spacing={2}>
              {/* HTTP Method */}
              <Grid item xs={12} sm={4}>
                <FormControl fullWidth size="small">
                  <InputLabel>HTTP Method *</InputLabel>
                  <Select value={formData.http_method} label="HTTP Method *" onChange={(e) => handleMethodChange(e.target.value)}>
                    <MenuItem value="">
                      <em>Select Method</em>
                    </MenuItem>
                    {(filteredMethods.length > 0 ? filteredMethods : availableMethods).map((method) => (
                      <MenuItem key={method} value={method}>
                        {method}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>

              {/* Endpoint Path */}
              <Grid item xs={12} sm={8}>
                <Autocomplete
                  freeSolo
                  size="small"
                  options={filteredEndpoints.map((ep) => ep.endpoint_path)}
                  value={formData.endpoint_pattern || ""}
                  onChange={(e, value) => handleEndpointChange(value || "")}
                  onInputChange={(e, value) => handleEndpointChange(value || "")}
                  filterOptions={(options, { inputValue }) => {
                    const filterValue = inputValue.toLowerCase();
                    return options.filter((option) => option.toLowerCase().includes(filterValue));
                  }}
                  noOptionsText="No endpoints found"
                  renderInput={(params) => <TextField {...params} label="Endpoint Path *" placeholder="Type to search..." />}
                />
              </Grid>

              {/* Query Params */}
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  size="small"
                  label="Query Params (comma-separated keys)"
                  value={formData.match_query_params}
                  onChange={(e) => setFormData({ ...formData, match_query_params: e.target.value })}
                  placeholder="e.g., userId, deviceId (empty = exact match all)"
                  helperText="Leave empty to match all query params exactly"
                />
              </Grid>

              {/* Platform */}
              <Grid item xs={12} sm={6}>
                <FormControl fullWidth size="small" disabled={isRecordingDisabledField("match_platform")}>
                  <InputLabel>Platform Matching</InputLabel>
                  <Select
                    value={formData.match_platform ? "exact" : "any"}
                    label="Platform Matching"
                    onChange={(e) => setFormData({ ...formData, match_platform: e.target.value === "exact" })}
                  >
                    <MenuItem value="exact">Exact</MenuItem>
                    <MenuItem value="any">Any</MenuItem>
                  </Select>
                </FormControl>
              </Grid>

              {/* App Version */}
              <Grid item xs={12} sm={6}>
                <FormControl fullWidth size="small" disabled={isRecordingDisabledField("match_version")}>
                  <InputLabel>App Version Matching</InputLabel>
                  <Select
                    value={formData.match_version ? "exact" : "closest"}
                    label="App Version Matching"
                    onChange={(e) => setFormData({ ...formData, match_version: e.target.value === "exact" })}
                  >
                    <MenuItem value="closest">Closest</MenuItem>
                    <MenuItem value="exact">Exact</MenuItem>
                  </Select>
                </FormControl>
              </Grid>

              {/* Environment */}
              <Grid item xs={12} sm={6}>
                <FormControl fullWidth size="small" disabled={isRecordingDisabledField("match_environment")}>
                  <InputLabel>Environment Matching</InputLabel>
                  <Select
                    value={formData.match_environment}
                    label="Environment Matching"
                    onChange={(e) => setFormData({ ...formData, match_environment: e.target.value })}
                  >
                    <MenuItem value="exact">Exact</MenuItem>
                    <MenuItem value="dev">Dev</MenuItem>
                    <MenuItem value="sit">Sit</MenuItem>
                    <MenuItem value="stage">Stage</MenuItem>
                  </Select>
                </FormControl>
              </Grid>

              {/* Language */}
              <Grid item xs={12} sm={6}>
                <FormControl fullWidth size="small" disabled={isRecordingDisabledField("match_language")}>
                  <InputLabel>Language Matching</InputLabel>
                  <Select
                    value={formData.match_language ? "exact" : "any"}
                    label="Language Matching"
                    onChange={(e) => setFormData({ ...formData, match_language: e.target.value === "exact" })}
                  >
                    <MenuItem value="exact">Exact</MenuItem>
                    <MenuItem value="any">Any</MenuItem>
                  </Select>
                </FormControl>
              </Grid>

              {/* Headers */}
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  size="small"
                  label="Headers (comma-separated keys)"
                  value={formData.match_headers}
                  onChange={(e) => setFormData({ ...formData, match_headers: e.target.value })}
                  placeholder="e.g., x-correlation-id, x-traceability-id (empty = no header matching)"
                  helperText="Leave empty to skip additional header matching"
                  disabled={isRecordingDisabledField("match_headers")}
                />
              </Grid>

              {/* Body */}
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  size="small"
                  label="Body (comma-separated field paths)"
                  value={formData.match_body}
                  onChange={(e) => setFormData({ ...formData, match_body: e.target.value })}
                  placeholder="e.g., clientId, memberId, planNumber, address.city (empty = no body field matching)"
                  helperText="Supports nested fields with dot notation (e.g., user.profile.memberId). Field order = priority."
                />
              </Grid>

              {/* Response Status - only show for replay rules */}
              {dialogType === "replay" && (
                <Grid item xs={12} sm={4}>
                  <Autocomplete
                    freeSolo
                    size="small"
                    options={["2xx", "error", "200", "201", "400", "401", "403", "404", "500", "502", "503"]}
                    value={formData.match_response_status}
                    onChange={(e, value) => setFormData({ ...formData, match_response_status: value || "2xx" })}
                    onInputChange={(e, value) => setFormData({ ...formData, match_response_status: value || "2xx" })}
                    renderInput={(params) => <TextField {...params} label="Response Status" placeholder="2xx, error, or code" />}
                  />
                </Grid>
              )}

              {/* Priority */}
              <Grid item xs={12} sm={dialogType === "replay" ? 4 : 6}>
                <TextField
                  fullWidth
                  size="small"
                  type="number"
                  label="Priority"
                  value={formData.priority}
                  onChange={(e) => {
                    const val = e.target.value;
                    const numVal = val === "" ? 10 : parseInt(val, 10);
                    setFormData({ ...formData, priority: isNaN(numVal) ? 10 : numVal });
                  }}
                  inputProps={{ min: 0, step: 1 }}
                  helperText="Lower value = higher priority (0, 1, 2, ...)"
                />
              </Grid>

              {/* Enabled */}
              <Grid item xs={12} sm={dialogType === "replay" ? 4 : 6}>
                <Box display="flex" alignItems="center" height="100%">
                  <Typography variant="body2" sx={{ mr: 2 }}>
                    Enabled:
                  </Typography>
                  <Switch checked={formData.enabled} onChange={(e) => setFormData({ ...formData, enabled: e.target.checked })} />
                </Box>
              </Grid>
            </Grid>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDialog}>Cancel</Button>
          <Button onClick={handleSave} variant="contained" disabled={!formData.http_method || !formData.endpoint_pattern}>
            Save
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteConfirmOpen} onClose={handleCancelDelete}>
        <DialogTitle>Delete Configuration</DialogTitle>
        <DialogContent>
          <Box sx={{ mb: 2 }}>
            <Typography variant="body2" color="textSecondary">
              Are you sure you want to delete this endpoint configuration? This action cannot be undone.
            </Typography>
          </Box>
          {deleteTargetConfig && (
            <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 1 }}>
              <MethodTag method={deleteTargetConfig.http_method} fontSize="0.8rem" />
              <Typography variant="caption" sx={{ fontFamily: "monospace", color: "#d32f2f", wordBreak: "break-all" }}>
                {deleteTargetConfig.endpoint_pattern}
              </Typography>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCancelDelete}>Cancel</Button>
          <Button onClick={handleConfirmDelete} variant="contained" color="error">
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default EndpointManagement;
