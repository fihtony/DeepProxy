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
  Checkbox,
  Tooltip,
  Autocomplete,
  Grid,
  Chip,
  Divider,
  FormControlLabel,
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
  Help as HelpIcon,
  Sync as BothIcon,
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
import { getProxyConfig } from "../services/settingsService";

const EndpointManagement = () => {
  const dispatch = useDispatch();
  const configs = useSelector(selectConfigs);
  const availableEndpoints = useSelector(selectAvailableEndpoints);
  const loading = useSelector(selectEndpointsLoading);
  const error = useSelector(selectEndpointsError);

  // Default matching settings from proxy config
  const [replayDefaults, setReplayDefaults] = useState({
    match_version: 0, // 0 = Closest, 1 = Exact
    match_platform: 1, // 0 = Any, 1 = Exact
    match_environment: "exact",
    match_language: 1, // 0 = Any, 1 = Exact
  });

  // Extract unique methods from available endpoints
  const availableMethods = useMemo(() => {
    const methods = new Set(availableEndpoints.map((ep) => ep.method));
    return Array.from(methods).sort();
  }, [availableEndpoints]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteTargetConfig, setDeleteTargetConfig] = useState(null);
  const [selectedConfig, setSelectedConfig] = useState(null);
  const [endpointFilter, setEndpointFilter] = useState(""); // Endpoint text filter for table
  const [formData, setFormData] = useState({
    regex: false,
    http_method: "",
    endpoint_pattern: "",
    match_query_params: "",
    override: false,
    match_version: false,
    match_language: true,
    match_platform: true,
    match_environment: "exact",
    match_headers: "",
    match_body: "",
    match_response_status: "2xx",
    priority: 10,
    enabled: true,
    type: "both",
  });

  // Track initialization to prevent double fetch in StrictMode
  const initializedRef = React.useRef(false);

  useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true;
      dispatch(fetchConfigs());
      dispatch(fetchAvailableEndpoints());

      // Load proxy config for default matching settings
      getProxyConfig()
        .then((res) => {
          if (res.success && res.data?.replayDefaults) {
            setReplayDefaults(res.data.replayDefaults);
          }
        })
        .catch((err) => {
          console.error("Failed to load proxy config:", err);
        });
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

  // Method options for the HTTP Method Select: always include current value and "*" so the dropdown
  // shows the selected method when editing (e.g. regex rules or method "*" which may not be in availableEndpoints)
  const methodOptions = useMemo(() => {
    const base = filteredMethods.length > 0 ? filteredMethods : availableMethods;
    const allowed = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"];
    const withAllowed = [...new Set([...allowed, ...base])];
    const current = formData.http_method && !withAllowed.includes(formData.http_method) ? [formData.http_method, ...withAllowed] : withAllowed;
    return current;
  }, [filteredMethods, availableMethods, formData.http_method]);

  // Filter configs based on endpoint text filter (case-insensitive partial matching)
  const filteredConfigs = useMemo(() => {
    if (!endpointFilter.trim()) {
      return configs;
    }
    const filterLower = endpointFilter.toLowerCase();
    return configs.filter((config) => config.endpoint_pattern.toLowerCase().includes(filterLower));
  }, [configs, endpointFilter]);

  const handleOpenDialog = (config = null) => {
    if (config) {
      // Editing existing config
      const configType = config.type || "both";
      setSelectedConfig(config);
      setFormData({
        regex: config.regex === 1,
        http_method: config.http_method || "",
        endpoint_pattern: config.endpoint_pattern || "",
        match_query_params: config.match_query_params ? JSON.parse(config.match_query_params).join(", ") : "",
        override: config.override === 1,
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
      // Adding new config - default to "both" type
      setSelectedConfig(null);
      setFormData({
        regex: false,
        http_method: "",
        endpoint_pattern: "",
        match_query_params: "",
        override: false, // Default to inherit from proxy config
        // When override is false, these values won't be used; UI shows "Inherit" for "both" type
        match_version: replayDefaults.match_version === 1,
        match_language: replayDefaults.match_language === 1,
        match_platform: replayDefaults.match_platform === 1,
        match_environment: replayDefaults.match_environment,
        match_headers: "",
        match_body: "",
        match_response_status: "2xx",
        priority: 10,
        enabled: true,
        type: "both",
      });
    }
    // Defer opening so the click handler returns quickly (avoids long-task violation)
    // and so focus can move into the dialog before aria-hidden is applied to #root (avoids a11y violation)
    setTimeout(() => setDialogOpen(true), 0);
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
    setSelectedConfig(null);
  };

  const handleSave = async () => {
    const data = {
      regex: formData.regex,
      http_method: formData.http_method,
      endpoint_pattern: formData.endpoint_pattern,
      match_query_params: formData.match_query_params
        ? JSON.stringify(
            formData.match_query_params
              .split(",")
              .map((s) => s.trim())
              .filter((s) => s),
          )
        : null,
      override: formData.override,
      match_version: formData.match_version,
      match_language: formData.match_language,
      match_platform: formData.match_platform,
      match_environment: formData.match_environment,
      match_headers: formData.match_headers
        ? JSON.stringify(
            formData.match_headers
              .split(",")
              .map((s) => s.trim())
              .filter((s) => s),
          )
        : null,
      match_body: formData.match_body
        ? JSON.stringify(
            formData.match_body
              .split(",")
              .map((s) => s.trim())
              .filter((s) => s),
          )
        : null,
      match_response_status: formData.type === "recording" ? "2xx" : formData.match_response_status,
      priority: formData.priority !== "" && !isNaN(parseInt(formData.priority, 10)) ? parseInt(formData.priority, 10) : 10,
      enabled: formData.enabled,
      type: formData.type,
    };

    if (selectedConfig) {
      await dispatch(updateConfig({ id: selectedConfig.id, data }));
    } else {
      await dispatch(createConfig(data));
    }
    handleCloseDialog();
    dispatch(fetchConfigs());
  };

  // Handle rule type change
  const handleRuleTypeChange = (newType) => {
    const isRecording = newType === "recording";
    setFormData({
      ...formData,
      type: newType,
      // For recording: override is always false and disabled
      override: isRecording ? false : formData.override,
    });
  };

  // Handle override toggle
  const handleOverrideToggle = (checked) => {
    if (checked) {
      // Enable override: use replay defaults
      setFormData({
        ...formData,
        override: true,
        match_version: replayDefaults.match_version === 1,
        match_language: replayDefaults.match_language === 1,
        match_platform: replayDefaults.match_platform === 1,
        match_environment: replayDefaults.match_environment,
      });
    } else {
      // Disable override: values become "Inherit" (still store the replay defaults but UI shows Inherit)
      setFormData({
        ...formData,
        override: false,
      });
    }
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
  const truncateEndpointPath = (regex, path, maxLength = 45) => {
    if (regex) {
      maxLength -= 3; // Adjust for "RE: " prefix
    }

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

  // Get dialog title based on edit mode
  const getDialogTitle = () => {
    return selectedConfig ? "Edit Matching Rule" : "Add Matching Rule";
  };

  // Check if matching fields should be disabled (for recording type or when override is off)
  const isMatchingFieldDisabled = () => {
    return formData.type === "recording" || !formData.override;
  };

  // Get the display value for matching fields based on type and override
  // Returns { value, isInherit } for determining what to display
  const getMatchingFieldDisplay = (fieldName) => {
    if (formData.type === "recording") {
      return "Exact"; // Recording always uses exact match
    }
    if (!formData.override) {
      if (formData.type === "replay") {
        // Replay type without override: show replayDefaults values (greyed out)
        switch (fieldName) {
          case "match_version":
            return replayDefaults.match_version === 1 ? "exact" : "closest";
          case "match_language":
            return replayDefaults.match_language === 1 ? "exact" : "any";
          case "match_platform":
            return replayDefaults.match_platform === 1 ? "exact" : "any";
          case "match_environment":
            return replayDefaults.match_environment || "exact";
          default:
            return null;
        }
      }
      // "both" type without override: show Inherit
      return "Inherit";
    }
    return null; // Use actual form value
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
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => handleOpenDialog(null)}>
            Add Rule
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
                  {endpointFilter ? "No matching configurations found." : 'No configurations found. Click "Add Rule" to create one.'}
                </TableCell>
              </TableRow>
            ) : (
              filteredConfigs.map((config) => {
                const isRecording = config.type === "recording";
                const isBoth = config.type === "both";
                const isReplay = config.type === "replay";
                // Determine row background based on type
                const getRowBackground = () => {
                  if (isBoth) return "inherit";
                  if (isRecording) return "rgba(249, 145, 145, 0.08)"; // light red for recording
                  return "rgba(89, 181, 247, 0.1)"; // light blue for replay
                };
                return (
                  <TableRow
                    key={config.id}
                    hover
                    sx={{
                      height: "32px",
                      backgroundColor: getRowBackground(),
                      "&:hover": {
                        backgroundColor: "rgba(26, 244, 70, 0.2) !important",
                      },
                    }}
                  >
                    <TableCell sx={{ ...tableCellStyle, textAlign: "center", padding: "4px" }}>
                      <Tooltip title={isBoth ? "Both (Recording & Replay)" : isRecording ? "Recording Only" : "Replay Only"} arrow>
                        <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center" }}>
                          {isBoth ? (
                            <BothIcon sx={{ color: "#9c27b0", fontSize: "1.2rem" }} />
                          ) : isRecording ? (
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
                      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                        {config.regex === 1 && (
                          <Tooltip title="Regex matching enabled">
                            <Typography
                              component="span"
                              sx={{
                                fontSize: "0.6rem",
                                fontWeight: "bold",
                                color: "primary.contrastText",
                                backgroundColor: "primary.light",
                                px: 0.5,
                                py: 0.1,
                                borderRadius: 0.5,
                                opacity: 0.8,
                              }}
                            >
                              RE
                            </Typography>
                          </Tooltip>
                        )}
                        <Tooltip title={config.endpoint_pattern}>
                          <span style={{ fontFamily: "monospace", fontSize: "0.85rem", display: "inline-block" }}>
                            {truncateEndpointPath(config.regex, config.endpoint_pattern)}
                          </span>
                        </Tooltip>
                      </Box>
                    </TableCell>
                    <TableCell sx={arrayFieldCellStyle}>
                      <Tooltip title={parseJsonArray(config.match_query_params)}>
                        <span>{formatArrayDisplay(config.match_query_params)}</span>
                      </Tooltip>
                    </TableCell>
                    <TableCell sx={tableCellStyle}>
                      {config.override === 0 && isBoth ? "Inherit" : formatMatchSetting(config.match_version, "Exact", "Closest")}
                    </TableCell>
                    <TableCell sx={tableCellStyle}>
                      {config.override === 0 && isBoth ? "Inherit" : formatMatchSetting(config.match_language, "Exact", "Any")}
                    </TableCell>
                    <TableCell sx={tableCellStyle}>
                      {config.override === 0 && isBoth ? "Inherit" : formatMatchSetting(config.match_platform, "Exact", "Any")}
                    </TableCell>
                    <TableCell sx={tableCellStyle}>
                      {config.override === 0 && isBoth
                        ? "Inherit"
                        : config.match_environment === "exact"
                          ? "Exact"
                          : config.match_environment.toUpperCase()}
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

      {/* Add/Edit Dialog - open deferred in handleOpenDialog so click returns quickly and focus can move before aria-hidden */}
      <Dialog open={dialogOpen} onClose={handleCloseDialog} maxWidth="md" fullWidth>
        <DialogTitle>{getDialogTitle()}</DialogTitle>
        <DialogContent>
          <Box pt={2}>
            <Grid container spacing={2}>
              {/* Row 1: Rule Type, Priority, Enabled toggle */}
              <Grid item xs={12} sm={4}>
                <FormControl fullWidth size="small">
                  <InputLabel>Rule Type</InputLabel>
                  <Select value={formData.type} label="Rule Type" onChange={(e) => handleRuleTypeChange(e.target.value)}>
                    <MenuItem value="both">Both (Recording & Replay)</MenuItem>
                    <MenuItem value="recording">Recording Only</MenuItem>
                    <MenuItem value="replay">Replay Only</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} sm={4}>
                <Box display="flex" alignItems="center" gap={0.5}>
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
                  />
                  <Tooltip title="Lower value = higher priority (0, 1, 2, ...)" arrow>
                    <HelpIcon sx={{ color: "action.active", fontSize: "1.2rem", cursor: "help" }} />
                  </Tooltip>
                </Box>
              </Grid>
              <Grid item xs={12} sm={4}>
                <Box display="flex" alignItems="center" justifyContent="flex-end" height="100%">
                  <FormControlLabel
                    control={
                      <Switch checked={formData.enabled} onChange={(e) => setFormData({ ...formData, enabled: e.target.checked })} />
                    }
                    label="Enabled"
                    labelPlacement="end"
                    sx={{ ml: 0, mr: 1 }}
                  />
                </Box>
              </Grid>

              {/* HTTP Method */}
              <Grid item xs={12} sm={4}>
                <FormControl fullWidth size="small">
                  <InputLabel>HTTP Method *</InputLabel>
                  <Select value={formData.http_method} label="HTTP Method *" onChange={(e) => handleMethodChange(e.target.value)}>
                    <MenuItem value="">
                      <em>Select Method</em>
                    </MenuItem>
                    {methodOptions.map((method) => (
                      <MenuItem key={method} value={method}>
                        {method}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>

              {/* Query Params with help icon */}
              <Grid item xs={12} sm={8}>
                <Box display="flex" alignItems="flex-start" gap={0.5}>
                  <TextField
                    fullWidth
                    size="small"
                    label="Query Params (comma-separated keys)"
                    value={formData.match_query_params}
                    onChange={(e) => setFormData({ ...formData, match_query_params: e.target.value })}
                    placeholder="e.g., userId, deviceId"
                  />
                  <Tooltip title="Leave empty to match all query params exactly" arrow>
                    <HelpIcon sx={{ color: "action.active", fontSize: "1.2rem", cursor: "help", mt: 1 }} />
                  </Tooltip>
                </Box>
              </Grid>

              {/* Endpoint Path */}
              <Grid item xs={12} sm={1}>
                <Box display="flex" alignItems="left" height="100%" pl={0} pr={0}>
                  <Tooltip title="Use regex pattern matching instead of exact match" arrow>
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={formData.regex}
                          onChange={(e) => setFormData({ ...formData, regex: e.target.checked })}
                          size="small"
                        />
                      }
                      label="Regex"
                      sx={{ pr: 0 }}
                    />
                  </Tooltip>
                </Box>
              </Grid>
              <Grid item xs={12} sm={11}>
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
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      sx={{ ml: 2, pr: 2 }}
                      label={formData.regex ? "Endpoint Pattern (Regex) *" : "Endpoint Pattern *"}
                      placeholder={formData.regex ? "e.g., /api/users/[0-9]+" : "Type to search..."}
                    />
                  )}
                />
              </Grid>

              {/* Override toggle - only show for non-recording types */}
              {formData.type !== "recording" && (
                <Grid item xs={12}>
                  <Box display="flex" alignItems="center" gap={2}>
                    <FormControlLabel
                      control={<Switch checked={formData.override} onChange={(e) => handleOverrideToggle(e.target.checked)} />}
                      label="Override Matching Settings"
                    />
                    {formData.override && formData.type === "both" && (
                      <Alert severity="info" sx={{ py: 0, fontSize: "0.8rem" }}>
                        Override only applies to REPLAY mode
                      </Alert>
                    )}
                  </Box>
                </Grid>
              )}

              {/* Matching fields with conditional display */}
              <Grid item xs={12} sm={3}>
                <FormControl fullWidth size="small" disabled={isMatchingFieldDisabled()}>
                  <InputLabel>Version</InputLabel>
                  <Select
                    value={getMatchingFieldDisplay("match_version") || (formData.match_version ? "exact" : "closest")}
                    label="Version"
                    onChange={(e) => setFormData({ ...formData, match_version: e.target.value === "exact" })}
                  >
                    {isMatchingFieldDisabled() && formData.type === "recording" ? (
                      <MenuItem value="Exact">Exact</MenuItem>
                    ) : isMatchingFieldDisabled() && formData.type === "both" ? (
                      <MenuItem value="Inherit">Inherit</MenuItem>
                    ) : isMatchingFieldDisabled() && formData.type === "replay" ? (
                      [
                        <MenuItem key="closest" value="closest">
                          Closest
                        </MenuItem>,
                        <MenuItem key="exact" value="exact">
                          Exact
                        </MenuItem>,
                      ]
                    ) : (
                      [
                        <MenuItem key="closest" value="closest">
                          Closest
                        </MenuItem>,
                        <MenuItem key="exact" value="exact">
                          Exact
                        </MenuItem>,
                      ]
                    )}
                  </Select>
                </FormControl>
              </Grid>

              <Grid item xs={12} sm={3}>
                <FormControl fullWidth size="small" disabled={isMatchingFieldDisabled()}>
                  <InputLabel>Language</InputLabel>
                  <Select
                    value={getMatchingFieldDisplay("match_language") || (formData.match_language ? "exact" : "any")}
                    label="Language"
                    onChange={(e) => setFormData({ ...formData, match_language: e.target.value === "exact" })}
                  >
                    {isMatchingFieldDisabled() && formData.type === "recording" ? (
                      <MenuItem value="Exact">Exact</MenuItem>
                    ) : isMatchingFieldDisabled() && formData.type === "both" ? (
                      <MenuItem value="Inherit">Inherit</MenuItem>
                    ) : isMatchingFieldDisabled() && formData.type === "replay" ? (
                      [
                        <MenuItem key="exact" value="exact">
                          Exact
                        </MenuItem>,
                        <MenuItem key="any" value="any">
                          Any
                        </MenuItem>,
                      ]
                    ) : (
                      [
                        <MenuItem key="exact" value="exact">
                          Exact
                        </MenuItem>,
                        <MenuItem key="any" value="any">
                          Any
                        </MenuItem>,
                      ]
                    )}
                  </Select>
                </FormControl>
              </Grid>

              <Grid item xs={12} sm={3}>
                <FormControl fullWidth size="small" disabled={isMatchingFieldDisabled()}>
                  <InputLabel>Platform</InputLabel>
                  <Select
                    value={getMatchingFieldDisplay("match_platform") || (formData.match_platform ? "exact" : "any")}
                    label="Platform"
                    onChange={(e) => setFormData({ ...formData, match_platform: e.target.value === "exact" })}
                  >
                    {isMatchingFieldDisabled() && formData.type === "recording" ? (
                      <MenuItem value="Exact">Exact</MenuItem>
                    ) : isMatchingFieldDisabled() && formData.type === "both" ? (
                      <MenuItem value="Inherit">Inherit</MenuItem>
                    ) : isMatchingFieldDisabled() && formData.type === "replay" ? (
                      [
                        <MenuItem key="exact" value="exact">
                          Exact
                        </MenuItem>,
                        <MenuItem key="any" value="any">
                          Any
                        </MenuItem>,
                      ]
                    ) : (
                      [
                        <MenuItem key="exact" value="exact">
                          Exact
                        </MenuItem>,
                        <MenuItem key="any" value="any">
                          Any
                        </MenuItem>,
                      ]
                    )}
                  </Select>
                </FormControl>
              </Grid>

              <Grid item xs={12} sm={3}>
                <FormControl fullWidth size="small" disabled={isMatchingFieldDisabled()}>
                  <InputLabel>Environment</InputLabel>
                  <Select
                    value={getMatchingFieldDisplay("match_environment") || formData.match_environment}
                    label="Environment"
                    onChange={(e) => setFormData({ ...formData, match_environment: e.target.value })}
                  >
                    {isMatchingFieldDisabled() && formData.type === "recording" ? (
                      <MenuItem value="Exact">Exact</MenuItem>
                    ) : isMatchingFieldDisabled() && formData.type === "both" ? (
                      <MenuItem value="Inherit">Inherit</MenuItem>
                    ) : isMatchingFieldDisabled() && formData.type === "replay" ? (
                      [
                        <MenuItem key="exact" value="exact">
                          Exact
                        </MenuItem>,
                        <MenuItem key="dev" value="dev">
                          Dev
                        </MenuItem>,
                        <MenuItem key="sit" value="sit">
                          Sit
                        </MenuItem>,
                        <MenuItem key="stage" value="stage">
                          Stage
                        </MenuItem>,
                      ]
                    ) : (
                      [
                        <MenuItem key="exact" value="exact">
                          Exact
                        </MenuItem>,
                        <MenuItem key="dev" value="dev">
                          Dev
                        </MenuItem>,
                        <MenuItem key="sit" value="sit">
                          Sit
                        </MenuItem>,
                        <MenuItem key="stage" value="stage">
                          Stage
                        </MenuItem>,
                      ]
                    )}
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
                  placeholder="e.g., x-correlation-id (empty = no header matching)"
                  helperText="Leave empty to skip additional header matching"
                />
              </Grid>

              {/* Body */}
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  size="small"
                  label="Body Fields (comma-separated paths)"
                  value={formData.match_body}
                  onChange={(e) => setFormData({ ...formData, match_body: e.target.value })}
                  placeholder="e.g., clientId, memberId, address.city"
                  helperText="Supports nested fields with dot notation. Field order = priority."
                />
              </Grid>

              {/* Divider for REPLAY-only settings */}
              {formData.type !== "recording" && (
                <>
                  <Grid item xs={12}>
                    <Divider sx={{ my: 1 }}>
                      <Chip label="Replay Mode Only" size="small" />
                    </Divider>
                  </Grid>

                  {/* Response Status */}
                  <Grid item xs={12} sm={6}>
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
                </>
              )}
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
