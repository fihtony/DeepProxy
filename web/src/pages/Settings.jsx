import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useDispatch } from "react-redux";
import {
  Typography,
  Box,
  Tabs,
  Tab,
  Paper,
  Button,
  Alert,
  Snackbar,
  CircularProgress,
  Divider,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Chip,
  IconButton,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
} from "@mui/material";
import {
  Save as SaveIcon,
  Refresh as RefreshIcon,
  Traffic as TrafficIcon,
  SwapHoriz as MappingIcon,
  Category as EndpointIcon,
  PlayArrow as TestIcon,
  VpnKey as SessionIcon,
  Delete as DeleteIcon,
  Add as AddIcon,
  ExpandMore as ExpandMoreIcon,
  FileDownload as ExportIcon,
  FileUpload as ImportIcon,
  CheckCircle as CheckCircleIcon,
  Warning as WarningIcon,
} from "@mui/icons-material";

import { HeaderMappingField, DomainListField, EndpointTypeField, TagField } from "../components/SettingsFields";

import {
  getTrafficConfig,
  updateTrafficConfig,
  getMappingConfig,
  updateMappingConfig,
  getEndpointConfig,
  updateEndpointConfig,
  testEndpointClassification,
  getSessionConfig,
  updateSessionConfig,
  deleteSessionConfig,
  exportAllConfigs,
  importConfigs,
} from "../services/settingsService";
import { setEndpointConfig as setEndpointConfigRedux } from "../store/slices/configSlice";

// Deep equality check for objects
function deepEqual(obj1, obj2) {
  return JSON.stringify(obj1) === JSON.stringify(obj2);
}

// Tab panel component
function TabPanel({ children, value, index, ...other }) {
  return (
    <div role="tabpanel" hidden={value !== index} id={`settings-tabpanel-${index}`} aria-labelledby={`settings-tab-${index}`} {...other}>
      {value === index && <Box sx={{ pt: 3 }}>{children}</Box>}
    </div>
  );
}

// Session Rule Editor Component
function SessionRuleEditor({ rule, onChange, onRemove, type }) {
  const isCreate = type === "create";
  const sourceOptions = isCreate ? ["body", "header", "query"] : ["cookie", "body", "header"];
  const typeOptions = ["cookie", "auth"];

  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 2 }}>
        <Typography variant="subtitle2">{isCreate ? "Session Creation Rule" : "Session Update Rule"}</Typography>
        <IconButton size="small" onClick={onRemove} color="error">
          <DeleteIcon fontSize="small" />
        </IconButton>
      </Box>

      <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap", mb: 2 }}>
        <FormControl size="small" sx={{ minWidth: 120 }}>
          <InputLabel>Method</InputLabel>
          <Select
            value={rule.method || ""}
            label="Method"
            onChange={(e) => onChange({ ...rule, method: e.target.value || null })}
            displayEmpty
          >
            <MenuItem value="Any">Any</MenuItem>
            <MenuItem value="GET">GET</MenuItem>
            <MenuItem value="POST">POST</MenuItem>
            <MenuItem value="PUT">PUT</MenuItem>
          </Select>
        </FormControl>

        <TextField
          label="Endpoint Pattern"
          size="small"
          value={rule.endpoint || ""}
          onChange={(e) => onChange({ ...rule, endpoint: e.target.value || null })}
          placeholder="e.g., .*/auth/login"
          sx={{ flexGrow: 1, minWidth: 200 }}
          helperText="Regex pattern to match endpoint, empty to match any endpoint"
        />
      </Box>

      <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap", mb: 2 }}>
        <FormControl size="small" sx={{ minWidth: 120 }} required>
          <InputLabel>Source</InputLabel>
          <Select value={rule.source || ""} label="Source" onChange={(e) => onChange({ ...rule, source: e.target.value })}>
            {sourceOptions.map((opt) => (
              <MenuItem key={opt} value={opt}>
                {opt.charAt(0).toUpperCase() + opt.slice(1)}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <TextField
          label="Key"
          size="small"
          value={rule.key || ""}
          onChange={(e) => onChange({ ...rule, key: e.target.value })}
          placeholder={isCreate ? "e.g., data.user" : "e.g., UserSession"}
          sx={{ flexGrow: 1, minWidth: 200 }}
          required
          helperText={isCreate ? "Dot notation for nested values" : "Cookie/header name or body path"}
        />

        <TextField
          label="Pattern (Regex)"
          size="small"
          value={rule.pattern || ""}
          onChange={(e) => onChange({ ...rule, pattern: e.target.value || null })}
          placeholder="e.g., User/(.*)"
          sx={{ flexGrow: 1, minWidth: 200 }}
          helperText="Optional extraction pattern"
        />
      </Box>

      {!isCreate && (
        <FormControl size="small" sx={{ minWidth: 150 }} required>
          <InputLabel>Type</InputLabel>
          <Select value={rule.type || ""} label="Type" onChange={(e) => onChange({ ...rule, type: e.target.value })}>
            {typeOptions.map((opt) => (
              <MenuItem key={opt} value={opt}>
                {opt === "cookie" ? "Cookie Session" : "Auth Token"}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      )}
    </Paper>
  );
}

function Settings() {
  // Get dispatch for updating Redux cache
  const dispatch = useDispatch();

  // Tab state
  const [activeTab, setActiveTab] = useState(0);

  // Loading and error states
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [snackbar, setSnackbar] = useState({ open: false, message: "", severity: "success" });

  // Original configs (from server) for change detection
  const [originalTrafficConfig, setOriginalTrafficConfig] = useState(null);
  const [originalMappingConfig, setOriginalMappingConfig] = useState(null);
  const [originalEndpointConfig, setOriginalEndpointConfig] = useState(null);
  const [originalSessionConfig, setOriginalSessionConfig] = useState(null);

  // Traffic config state
  const [trafficConfig, setTrafficConfig] = useState({
    monitor: { from: "header", key: "", pattern: "" },
    domains: [],
  });

  // Session config state
  const [sessionConfig, setSessionConfig] = useState({
    create: [],
    update: [],
    session: { expiry: 86400 },
  });
  const [hasSessionConfig, setHasSessionConfig] = useState(false);

  // Import/Export state
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importData, setImportData] = useState(null);
  const [importConflicts, setImportConflicts] = useState(null);

  // Mapping config state
  const [mappingConfig, setMappingConfig] = useState({
    app_version: { from: "header", key: "", pattern: null },
    app_platform: { from: "header", key: "", pattern: null },
    app_environment: { from: "header", key: "", pattern: null },
    app_language: { from: "header", key: "", pattern: null },
    correlation_id: { from: "header", key: "", pattern: null },
    traceability_id: { from: "header", key: "", pattern: null },
  });

  // Endpoint config state
  const [endpointConfig, setEndpointConfig] = useState({
    types: [],
    tags: [],
    fallback: "public",
  });

  // Test endpoint state
  const [testPath, setTestPath] = useState("");
  const [testResult, setTestResult] = useState(null);

  // Check if config has changed from original
  const trafficChanged = useMemo(() => {
    if (!originalTrafficConfig) return false;
    return !deepEqual(trafficConfig, originalTrafficConfig);
  }, [trafficConfig, originalTrafficConfig]);

  const mappingChanged = useMemo(() => {
    if (!originalMappingConfig) return false;
    return !deepEqual(mappingConfig, originalMappingConfig);
  }, [mappingConfig, originalMappingConfig]);

  const endpointChanged = useMemo(() => {
    if (!originalEndpointConfig) return false;
    return !deepEqual(endpointConfig, originalEndpointConfig);
  }, [endpointConfig, originalEndpointConfig]);

  const sessionChanged = useMemo(() => {
    // If no original config, check if current config is different from empty default
    if (!originalSessionConfig) {
      const emptySession = { create: [], update: [], session: { expiry: 86400 } };
      return !deepEqual(sessionConfig, emptySession);
    }
    // Otherwise check against original
    return !deepEqual(sessionConfig, originalSessionConfig);
  }, [sessionConfig, originalSessionConfig]);

  // Load initial data
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [trafficRes, mappingRes, endpointRes, sessionRes] = await Promise.all([
        getTrafficConfig(),
        getMappingConfig(),
        getEndpointConfig(),
        getSessionConfig(),
      ]);

      if (trafficRes.success && trafficRes.data) {
        setTrafficConfig(trafficRes.data);
        setOriginalTrafficConfig(trafficRes.data);
      } else {
        // No config in database - start with empty
        const emptyTraffic = { monitor: { from: "header", key: "", pattern: "" }, domains: [] };
        setTrafficConfig(emptyTraffic);
        setOriginalTrafficConfig(null);
      }

      if (mappingRes.success && mappingRes.data) {
        setMappingConfig(mappingRes.data);
        setOriginalMappingConfig(mappingRes.data);
      } else {
        setOriginalMappingConfig(null);
      }

      if (endpointRes.success && endpointRes.data) {
        setEndpointConfig(endpointRes.data);
        setOriginalEndpointConfig(endpointRes.data);
      } else {
        const emptyEndpoint = { types: [], tags: [], fallback: "public" };
        setEndpointConfig(emptyEndpoint);
        setOriginalEndpointConfig(null);
      }

      if (sessionRes.success && sessionRes.data) {
        setSessionConfig(sessionRes.data);
        setOriginalSessionConfig(sessionRes.data);
        setHasSessionConfig(sessionRes.hasConfig);
      } else {
        const emptySession = { create: [], update: [], session: { expiry: 86400 } };
        setSessionConfig(emptySession);
        setOriginalSessionConfig(null);
        setHasSessionConfig(false);
      }
    } catch (error) {
      console.error("Failed to load settings:", error);
      setSnackbar({
        open: true,
        message: "Failed to load settings: " + (error.response?.data?.error || error.message),
        severity: "error",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Export handler
  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await exportAllConfigs();
      if (res.success && res.data) {
        const exportData = res.data;
        const dateStr = new Date().toISOString().split("T")[0];
        const filename = `Dproxy-config-${dateStr}.json`;

        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        setSnackbar({ open: true, message: `Configuration exported to ${filename}`, severity: "success" });
      }
    } catch (error) {
      setSnackbar({
        open: true,
        message: "Failed to export: " + (error.response?.data?.error || error.message),
        severity: "error",
      });
    } finally {
      setExporting(false);
    }
  };

  // Import file selection handler
  const handleImportFileSelect = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if (!data.configs || typeof data.configs !== "object") {
          setSnackbar({
            open: true,
            message: "Invalid config file: missing 'configs' object",
            severity: "error",
          });
          return;
        }

        // Check for conflicts before opening dialog
        try {
          const conflictRes = await importConfigs(data.configs, false);
          if (conflictRes.hasConflicts) {
            setImportConflicts(conflictRes.conflicts);
          }
        } catch (err) {
          // Ignore errors on conflict check, conflicts will be null
        }

        setImportData(data);
        setImportDialogOpen(true);
      } catch (err) {
        setSnackbar({
          open: true,
          message: "Failed to parse config file: " + err.message,
          severity: "error",
        });
      }
    };
    reader.readAsText(file);
    // Reset file input
    event.target.value = "";
  };

  // Import handler
  const handleImport = async (overwrite = false) => {
    if (!importData?.configs) return;

    setImporting(true);
    setImportDialogOpen(false);

    try {
      const res = await importConfigs(importData.configs, overwrite);

      if (res.success) {
        setSnackbar({ open: true, message: "Configuration imported successfully", severity: "success" });
        // Reload data to reflect imported configs
        await loadData();
        setImportData(null);
        setImportConflicts(null);
      }
    } catch (error) {
      setSnackbar({
        open: true,
        message: "Failed to import: " + (error.response?.data?.error || error.message),
        severity: "error",
      });
    } finally {
      setImporting(false);
    }
  };

  // Cancel import
  const handleCancelImport = () => {
    setImportDialogOpen(false);
    setImportData(null);
    setImportConflicts(null);
  };

  // Get config type display name
  const getConfigTypeName = (type) => {
    const names = {
      traffic: "Traffic Monitor",
      mapping: "Field Mapping",
      endpoint: "Endpoint Types",
      session: "Session Management",
    };
    return names[type] || type;
  };

  // Save handlers
  const handleSaveTraffic = async () => {
    setSaving(true);
    try {
      const res = await updateTrafficConfig(trafficConfig);
      if (res.success) {
        setOriginalTrafficConfig(trafficConfig);
        setSnackbar({ open: true, message: "Traffic configuration saved successfully", severity: "success" });
      }
    } catch (error) {
      setSnackbar({
        open: true,
        message: "Failed to save: " + (error.response?.data?.error || error.message),
        severity: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveMapping = async () => {
    setSaving(true);
    try {
      const res = await updateMappingConfig(mappingConfig);
      if (res.success) {
        setOriginalMappingConfig(mappingConfig);
        setSnackbar({ open: true, message: "Mapping configuration saved successfully", severity: "success" });
      }
    } catch (error) {
      setSnackbar({
        open: true,
        message: "Failed to save: " + (error.response?.data?.error || error.message),
        severity: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveEndpoint = async () => {
    setSaving(true);
    try {
      const res = await updateEndpointConfig(endpointConfig);
      if (res.success) {
        setOriginalEndpointConfig(endpointConfig);
        // Update Redux cache so other pages get the latest configuration
        dispatch(setEndpointConfigRedux(endpointConfig));
        setSnackbar({ open: true, message: "Endpoint configuration saved successfully", severity: "success" });
      }
    } catch (error) {
      setSnackbar({
        open: true,
        message: "Failed to save: " + (error.response?.data?.error || error.message),
        severity: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  // Test endpoint classification
  const handleTestEndpoint = async () => {
    if (!testPath.trim()) return;
    try {
      const res = await testEndpointClassification(testPath);
      if (res.success) {
        setTestResult(res.data);
      }
    } catch (error) {
      setSnackbar({ open: true, message: "Test failed: " + error.message, severity: "error" });
    }
  };

  // Endpoint config helpers
  const handleAddEndpointType = () => {
    setEndpointConfig({
      ...endpointConfig,
      types: [...endpointConfig.types, { name: "", patterns: [], priority: endpointConfig.types.length }],
    });
  };

  const handleUpdateEndpointType = (index, newType) => {
    const types = [...endpointConfig.types];
    types[index] = newType;
    setEndpointConfig({ ...endpointConfig, types });
  };

  const handleRemoveEndpointType = (index) => {
    const types = [...endpointConfig.types];
    types.splice(index, 1);
    setEndpointConfig({ ...endpointConfig, types });
  };

  const handleAddTag = () => {
    setEndpointConfig({
      ...endpointConfig,
      tags: [...(endpointConfig.tags || []), { name: "", pattern: "", color: "#607d8b" }],
    });
  };

  const handleUpdateTag = (index, newTag) => {
    const tags = [...(endpointConfig.tags || [])];
    tags[index] = newTag;
    setEndpointConfig({ ...endpointConfig, tags });
  };

  const handleRemoveTag = (index) => {
    const tags = [...(endpointConfig.tags || [])];
    tags.splice(index, 1);
    setEndpointConfig({ ...endpointConfig, tags });
  };

  // Session config handlers
  const handleSaveSession = async () => {
    setSaving(true);
    try {
      const res = await updateSessionConfig(sessionConfig);
      if (res.success) {
        setOriginalSessionConfig(sessionConfig);
        setHasSessionConfig(true);
        setSnackbar({ open: true, message: "Session configuration saved successfully", severity: "success" });
      }
    } catch (error) {
      setSnackbar({
        open: true,
        message: "Failed to save: " + (error.response?.data?.error || error.message),
        severity: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteSession = async () => {
    if (!window.confirm("Are you sure you want to delete session configuration? This will revert to default behavior.")) {
      return;
    }
    setSaving(true);
    try {
      const res = await deleteSessionConfig();
      if (res.success) {
        const emptySession = { create: [], update: [], session: { expiry: 86400 } };
        setSessionConfig(emptySession);
        setOriginalSessionConfig(null);
        setHasSessionConfig(false);
        setSnackbar({ open: true, message: "Session configuration deleted successfully", severity: "success" });
      }
    } catch (error) {
      setSnackbar({
        open: true,
        message: "Failed to delete: " + (error.response?.data?.error || error.message),
        severity: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  // Session rule helpers
  const handleAddCreateRule = () => {
    setSessionConfig({
      ...sessionConfig,
      create: [...(sessionConfig.create || []), { method: "POST", endpoint: "", source: "body", key: "", pattern: "" }],
    });
  };

  const handleUpdateCreateRule = (index, updatedRule) => {
    const create = [...(sessionConfig.create || [])];
    create[index] = updatedRule;
    setSessionConfig({ ...sessionConfig, create });
  };

  const handleRemoveCreateRule = (index) => {
    const create = [...(sessionConfig.create || [])];
    create.splice(index, 1);
    setSessionConfig({ ...sessionConfig, create });
  };

  const handleAddUpdateRule = () => {
    setSessionConfig({
      ...sessionConfig,
      update: [...(sessionConfig.update || []), { method: "POST", endpoint: "", source: "cookie", key: "", pattern: "", type: "" }],
    });
  };

  const handleUpdateUpdateRule = (index, updatedRule) => {
    const update = [...(sessionConfig.update || [])];
    update[index] = updatedRule;
    setSessionConfig({ ...sessionConfig, update });
  };

  const handleRemoveUpdateRule = (index) => {
    const update = [...(sessionConfig.update || [])];
    update.splice(index, 1);
    setSessionConfig({ ...sessionConfig, update });
  };

  const handleSessionSettingsChange = (field, value) => {
    setSessionConfig({
      ...sessionConfig,
      session: { ...sessionConfig.session, [field]: value },
    });
  };

  // Convert seconds to display value and unit
  const getExpiryDisplay = () => {
    const seconds = sessionConfig.session?.expiry || 86400;
    if (seconds % 86400 === 0) {
      return { value: seconds / 86400, unit: "day" };
    } else if (seconds % 3600 === 0) {
      return { value: seconds / 3600, unit: "hour" };
    } else if (seconds % 60 === 0) {
      return { value: seconds / 60, unit: "minute" };
    }
    return { value: seconds, unit: "second" };
  };

  // Convert display value and unit to seconds
  const convertExpiryToSeconds = (value, unit) => {
    const multipliers = {
      day: 86400,
      hour: 3600,
      minute: 60,
      second: 1,
    };
    return Math.max(1, value * (multipliers[unit] || 1));
  };

  const expiryDisplay = getExpiryDisplay();

  // Build fallback type options - always include "public", plus defined types
  const fallbackOptions = useMemo(() => {
    const options = new Set(["public"]);
    endpointConfig.types.forEach((t) => {
      if (t.name && t.name.trim()) {
        options.add(t.name.trim());
      }
    });
    return Array.from(options);
  }, [endpointConfig.types]);

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", height: 400 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 3 }}>
        <Typography variant="h4">Settings</Typography>
        <Box sx={{ display: "flex", gap: 1 }}>
          <Button variant="outlined" startIcon={<RefreshIcon />} onClick={loadData} disabled={loading}>
            Refresh
          </Button>
          <Button
            variant="outlined"
            startIcon={exporting ? <CircularProgress size={16} /> : <ExportIcon />}
            onClick={handleExport}
            disabled={loading || exporting}
          >
            Export
          </Button>
          <Button
            variant="outlined"
            component="label"
            startIcon={importing ? <CircularProgress size={16} /> : <ImportIcon />}
            disabled={loading || importing}
          >
            Import
            <input type="file" accept=".json" hidden onChange={handleImportFileSelect} />
          </Button>
        </Box>
      </Box>

      <Paper sx={{ width: "100%" }}>
        <Box sx={{ overflowX: "auto", borderBottom: 1, borderColor: "divider" }}>
          <Tabs value={activeTab} onChange={(e, newValue) => setActiveTab(newValue)} sx={{ minWidth: "max-content" }}>
            <Tab icon={<TrafficIcon />} iconPosition="start" label="Traffic Monitor" />
            <Tab icon={<MappingIcon />} iconPosition="start" label="Field Mapping" />
            <Tab icon={<EndpointIcon />} iconPosition="start" label="Endpoint Types" />
            <Tab icon={<SessionIcon />} iconPosition="start" label="Session Management" />
          </Tabs>
        </Box>

        {/* Traffic Monitor Tab */}
        <TabPanel value={activeTab} index={0}>
          <Box sx={{ p: 2 }}>
            <Alert severity="info" sx={{ mb: 3 }}>
              Configure the criteria to identify monitored traffic. All fields are required. If configuration is missing or incomplete, all
              traffic will pass through without monitoring.
            </Alert>

            <Typography variant="h6" sx={{ mb: 2 }}>
              Traffic Detection
            </Typography>
            <HeaderMappingField
              label="Monitor Criteria"
              description="Define how to identify monitored traffic. Requests matching this pattern will be processed by dProxy. Key name and pattern are required."
              value={trafficConfig.monitor}
              onChange={(monitor) => setTrafficConfig({ ...trafficConfig, monitor })}
              required={true}
              patternRequired={true}
            />

            <Divider sx={{ my: 3 }} />

            <Typography variant="h6" sx={{ mb: 2 }}>
              Monitored Domains
            </Typography>
            <DomainListField domains={trafficConfig.domains} onChange={(domains) => setTrafficConfig({ ...trafficConfig, domains })} />
            {trafficConfig.domains.length === 0 && (
              <Alert severity="warning" sx={{ mt: 1 }}>
                At least one domain is required for traffic monitoring to work.
              </Alert>
            )}

            <Box sx={{ display: "flex", gap: 2, mt: 3, justifyContent: "flex-end" }}>
              <Button variant="contained" startIcon={<SaveIcon />} onClick={handleSaveTraffic} disabled={saving || !trafficChanged}>
                {saving ? "Saving..." : "Save Traffic Config"}
              </Button>
            </Box>
          </Box>
        </TabPanel>

        {/* Field Mapping Tab */}
        <TabPanel value={activeTab} index={1}>
          <Box sx={{ p: 2 }}>
            <Alert severity="info" sx={{ mb: 3 }}>
              Configure how to extract app version, platform, environment, and language from requests. These values are used for request
              matching in replay mode and stored in the database during recording. If a value cannot be extracted, an empty string will be
              used.
            </Alert>

            <Typography variant="h6" sx={{ mb: 2 }}>
              Required Fields
            </Typography>
            <HeaderMappingField
              label="App Version"
              description="Maps to app_version in database. Used for matching public endpoints in replay mode."
              value={mappingConfig.app_version}
              onChange={(v) => setMappingConfig({ ...mappingConfig, app_version: v })}
              patternHidden={false}
              required
            />
            <HeaderMappingField
              label="App Platform"
              description="Maps to app_platform in database. Typically 'android' or 'ios'."
              value={mappingConfig.app_platform}
              onChange={(v) => setMappingConfig({ ...mappingConfig, app_platform: v })}
              patternHidden={false}
              required
            />
            <HeaderMappingField
              label="App Environment"
              description="Maps to app_environment in database. Typically 'sit', 'stage', or 'prod'."
              value={mappingConfig.app_environment}
              onChange={(v) => setMappingConfig({ ...mappingConfig, app_environment: v })}
              patternHidden={false}
              required
            />
            <HeaderMappingField
              label="App Language"
              description="Maps to app_language in database. Typically 'en' or 'fr'."
              value={mappingConfig.app_language}
              onChange={(v) => setMappingConfig({ ...mappingConfig, app_language: v })}
              patternHidden={false}
              required
            />

            <Divider sx={{ my: 3 }} />

            <Typography variant="h6" sx={{ mb: 2 }}>
              Optional Fields (Tracing)
            </Typography>
            <HeaderMappingField
              label="Correlation ID"
              description="Maps to correlation_id in database. Used for request tracing."
              value={mappingConfig.correlation_id}
              onChange={(v) => setMappingConfig({ ...mappingConfig, correlation_id: v })}
              patternHidden={false}
            />
            <HeaderMappingField
              label="Traceability ID"
              description="Maps to traceability_id in database. Used for request tracing."
              value={mappingConfig.traceability_id}
              onChange={(v) => setMappingConfig({ ...mappingConfig, traceability_id: v })}
              patternHidden={false}
            />

            <Box sx={{ display: "flex", gap: 2, mt: 3, justifyContent: "flex-end" }}>
              <Button variant="contained" startIcon={<SaveIcon />} onClick={handleSaveMapping} disabled={saving || !mappingChanged}>
                {saving ? "Saving..." : "Save Mapping Config"}
              </Button>
            </Box>
          </Box>
        </TabPanel>

        {/* Endpoint Types Tab */}
        <TabPanel value={activeTab} index={2}>
          <Box sx={{ p: 2 }}>
            <Alert severity="info" sx={{ mb: 3 }}>
              Configure rules to classify endpoints as public or secure. Rules are matched by priority (lower number = higher priority). If
              no endpoint types are defined, all endpoints default to "public".
            </Alert>

            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 2 }}>
              <Typography variant="h6">Endpoint Types</Typography>
              <Button variant="outlined" onClick={handleAddEndpointType}>
                + Add Endpoint Type
              </Button>
            </Box>
            {endpointConfig.types.map((type, index) => (
              <EndpointTypeField
                key={index}
                type={type}
                onChange={(t) => handleUpdateEndpointType(index, t)}
                onRemove={() => handleRemoveEndpointType(index)}
              />
            ))}

            <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 3 }}>
              <FormControl size="small" sx={{ minWidth: 150 }}>
                <InputLabel>Fallback Type</InputLabel>
                <Select
                  value={endpointConfig.fallback || "public"}
                  label="Fallback Type"
                  onChange={(e) => setEndpointConfig({ ...endpointConfig, fallback: e.target.value })}
                >
                  {fallbackOptions.map((option) => (
                    <MenuItem key={option} value={option}>
                      {option}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <Typography variant="body2" color="text.secondary">
                Used when no pattern matches the endpoint
              </Typography>
            </Box>

            <Divider sx={{ my: 3 }} />

            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 2 }}>
              <Typography variant="h6">Endpoint Tags (UI Display Only)</Typography>
              <Button variant="outlined" onClick={handleAddTag}>
                + Add Tag
              </Button>
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Tags are cached in UI and used for visual grouping. They don't affect endpoint type classification.
            </Typography>
            {(endpointConfig.tags || []).map((tag, index) => (
              <TagField key={index} tag={tag} onChange={(t) => handleUpdateTag(index, t)} onRemove={() => handleRemoveTag(index)} />
            ))}

            <Divider sx={{ my: 3 }} />

            <Typography variant="h6" sx={{ mb: 2 }}>
              Test Classification
            </Typography>
            <Box sx={{ display: "flex", gap: 2, alignItems: "flex-start", mb: 2 }}>
              <TextField
                label="Endpoint Path"
                size="small"
                value={testPath}
                onChange={(e) => setTestPath(e.target.value)}
                placeholder="/api/sec/users"
                sx={{ flexGrow: 1 }}
                onKeyPress={(e) => e.key === "Enter" && handleTestEndpoint()}
              />
              <Button variant="outlined" startIcon={<TestIcon />} onClick={handleTestEndpoint} disabled={!testPath.trim()}>
                Test
              </Button>
            </Box>
            {testResult && (
              <Paper variant="outlined" sx={{ p: 2, backgroundColor: "background.default" }}>
                <Typography variant="body2">
                  <strong>Path:</strong> {testResult.path}
                </Typography>
                <Typography variant="body2">
                  <strong>Type:</strong>{" "}
                  <Chip label={testResult.endpointType} size="small" color={testResult.isSecure ? "error" : "success"} />
                </Typography>
                {testResult.tags && testResult.tags.length > 0 && (
                  <Box sx={{ mt: 1 }}>
                    <strong>Tags:</strong>{" "}
                    {testResult.tags.map((tag, i) => (
                      <Chip key={i} label={tag.name} size="small" sx={{ ml: 1, backgroundColor: tag.color, color: "#fff" }} />
                    ))}
                  </Box>
                )}
              </Paper>
            )}

            <Box sx={{ display: "flex", gap: 2, mt: 3, justifyContent: "flex-end" }}>
              <Button variant="contained" startIcon={<SaveIcon />} onClick={handleSaveEndpoint} disabled={saving || !endpointChanged}>
                {saving ? "Saving..." : "Save Endpoint Config"}
              </Button>
            </Box>
          </Box>
        </TabPanel>

        {/* Session Management Tab */}
        <TabPanel value={activeTab} index={3}>
          <Box sx={{ p: 2 }}>
            <Alert severity="info" sx={{ mb: 3 }}>
              Configure rules for session creation and token extraction. Create rules trigger new session creation when requests match.
              Update rules extract tokens from responses to update session data.
            </Alert>

            {/* Create Rules Section */}
            <Typography variant="h6" sx={{ mb: 2, display: "flex", alignItems: "center", gap: 1 }}>
              Create Rules
              <Typography variant="body2" color="text.secondary" sx={{ ml: 1 }}>
                (Trigger session creation when request matches)
              </Typography>
            </Typography>

            {(sessionConfig.create || []).length === 0 ? (
              <Alert severity="warning" sx={{ mb: 2 }}>
                No create rules defined. Add rules to specify when new sessions should be created.
              </Alert>
            ) : (
              (sessionConfig.create || []).map((rule, index) => (
                <SessionRuleEditor
                  key={index}
                  rule={rule}
                  index={index}
                  type="create"
                  onChange={(updatedRule) => handleUpdateCreateRule(index, updatedRule)}
                  onRemove={() => handleRemoveCreateRule(index)}
                />
              ))
            )}

            <Button startIcon={<AddIcon />} onClick={handleAddCreateRule} sx={{ mb: 3 }}>
              Add Create Rule
            </Button>

            <Divider sx={{ my: 3 }} />

            {/* Update Rules Section */}
            <Typography variant="h6" sx={{ mb: 2, display: "flex", alignItems: "center", gap: 1 }}>
              Update Rules
              <Typography variant="body2" color="text.secondary" sx={{ ml: 1 }}>
                (Extract tokens from response to update session)
              </Typography>
            </Typography>

            {(sessionConfig.update || []).length === 0 ? (
              <Alert severity="warning" sx={{ mb: 2 }}>
                No update rules defined. Add rules to extract session tokens from responses.
              </Alert>
            ) : (
              (sessionConfig.update || []).map((rule, index) => (
                <SessionRuleEditor
                  key={index}
                  rule={rule}
                  index={index}
                  type="update"
                  onChange={(updatedRule) => handleUpdateUpdateRule(index, updatedRule)}
                  onRemove={() => handleRemoveUpdateRule(index)}
                />
              ))
            )}

            <Button startIcon={<AddIcon />} onClick={handleAddUpdateRule} sx={{ mb: 3 }}>
              Add Update Rule
            </Button>

            <Divider sx={{ my: 3 }} />

            {/* Session Settings Section */}
            <Typography variant="h6" sx={{ mb: 2 }}>
              Session Expiry Settings
            </Typography>

            <Box sx={{ display: "flex", gap: 2, alignItems: "center", mb: 3 }}>
              <TextField
                label="Session Expiry"
                type="number"
                size="small"
                inputProps={{ min: "1" }}
                value={expiryDisplay.value}
                onChange={(e) => {
                  const val = parseInt(e.target.value) || 1;
                  handleSessionSettingsChange("expiry", convertExpiryToSeconds(val, expiryDisplay.unit));
                }}
                sx={{ width: 120 }}
              />
              <FormControl size="small" sx={{ minWidth: 100 }}>
                <InputLabel>Unit</InputLabel>
                <Select
                  value={expiryDisplay.unit}
                  label="Unit"
                  onChange={(e) => {
                    const newUnit = e.target.value;
                    handleSessionSettingsChange("expiry", convertExpiryToSeconds(expiryDisplay.value, newUnit));
                  }}
                >
                  <MenuItem value="day">Day</MenuItem>
                  <MenuItem value="hour">Hour</MenuItem>
                  <MenuItem value="minute">Minute</MenuItem>
                  <MenuItem value="second">Second</MenuItem>
                </Select>
              </FormControl>
              <Typography variant="body2" color="text.secondary">
                ({sessionConfig.session?.expiry || 86400} seconds)
              </Typography>
            </Box>

            <Box sx={{ display: "flex", gap: 2, mt: 3, justifyContent: "flex-end" }}>
              <Button variant="contained" startIcon={<SaveIcon />} onClick={handleSaveSession} disabled={saving || !sessionChanged}>
                {saving ? "Saving..." : "Save Session Config"}
              </Button>
            </Box>
          </Box>
        </TabPanel>
      </Paper>

      {/* Import Configuration Dialog */}
      <Dialog open={importDialogOpen} onClose={handleCancelImport} maxWidth="sm" fullWidth>
        <DialogTitle>
          {importConflicts && Object.keys(importConflicts).length > 0 ? "Configuration Conflicts Detected" : "Import Configuration"}
        </DialogTitle>
        <DialogContent>
          {/* Config Info Section */}
          <Box sx={{ mb: 3 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
              Backup Information
            </Typography>
            {importData?.version && (
              <Typography variant="body2">
                <strong>Version:</strong> {importData.version}
              </Typography>
            )}
            {importData?.exportedAt && (
              <Typography variant="body2">
                <strong>Exported:</strong> {new Date(importData.exportedAt).toLocaleString()}
              </Typography>
            )}
          </Box>

          {/* Modules Info Section */}
          <Box sx={{ mb: 3 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
              Modules to Import
            </Typography>
            <List dense>
              {importData?.configs &&
                Object.keys(importData.configs).map((type) => (
                  <ListItem key={type}>
                    <ListItemIcon>
                      {importConflicts?.[type] ? <WarningIcon color="warning" /> : <CheckCircleIcon color="primary" />}
                    </ListItemIcon>
                    <ListItemText
                      primary={getConfigTypeName(type)}
                      secondary={importConflicts?.[type] ? "Existing configuration will be replaced" : "New configuration"}
                    />
                  </ListItem>
                ))}
            </List>
          </Box>

          {/* Conflict Warning */}
          {importConflicts && Object.keys(importConflicts).length > 0 && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              Some configurations already exist. Click "Import" to overwrite them with the backup data.
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCancelImport}>Cancel</Button>
          <Button
            variant="contained"
            color={importConflicts && Object.keys(importConflicts).length > 0 ? "warning" : "primary"}
            onClick={() => handleImport(importConflicts && Object.keys(importConflicts).length > 0)}
            disabled={importing}
          >
            {importing ? "Importing..." : "Import"}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
      >
        <Alert onClose={() => setSnackbar({ ...snackbar, open: false })} severity={snackbar.severity}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}

export default Settings;
