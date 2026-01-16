/**
 * SettingsFields Components
 *
 * Reusable components for configuring header/query param mapping.
 * Used in Settings page for traffic monitor and field mapping configurations.
 */

import React from "react";
import { Box, TextField, FormControl, InputLabel, Select, MenuItem, Typography, IconButton, Tooltip, Paper, Chip } from "@mui/material";
import { Help as HelpIcon, CheckCircle as ValidIcon, Error as ErrorIcon } from "@mui/icons-material";

/**
 * HeaderMappingField - Single field configuration component
 *
 * @param {Object} props
 * @param {string} props.label - Field label
 * @param {string} props.description - Field description/tooltip
 * @param {Object} props.value - Current value { from, key, pattern }
 * @param {Function} props.onChange - Callback when value changes
 * @param {boolean} props.disabled - Whether the field is disabled
 * @param {boolean} props.fromDisabled - Whether the 'from' selector is disabled
 * @param {boolean} props.patternHidden - Whether to hide the pattern field
 * @param {boolean} props.required - Whether the field is required
 * @param {boolean} props.patternRequired - Whether the pattern field is required
 */
export function HeaderMappingField({
  label,
  description,
  value = { from: "header", key: "", pattern: null },
  onChange,
  disabled = false,
  fromDisabled = false,
  patternHidden = false,
  required = false,
  patternRequired = false,
}) {
  const [patternError, setPatternError] = React.useState("");

  // Validate regex pattern
  const validatePattern = (pattern) => {
    if (!pattern) {
      if (patternRequired) {
        setPatternError("Pattern is required");
        return false;
      }
      setPatternError("");
      return true;
    }
    try {
      new RegExp(pattern);
      setPatternError("");
      return true;
    } catch (e) {
      setPatternError(e.message);
      return false;
    }
  };

  const handleChange = (field, newValue) => {
    if (field === "pattern") {
      validatePattern(newValue);
    }
    onChange({
      ...value,
      [field]: newValue === "" && field === "pattern" ? null : newValue,
    });
  };

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 2,
        mb: 2,
        backgroundColor: disabled ? "action.disabledBackground" : "background.paper",
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", mb: 1.5 }}>
        <Typography variant="subtitle1" fontWeight="medium">
          {label}
          {required && (
            <Typography component="span" color="error">
              {" "}
              *
            </Typography>
          )}
        </Typography>
        {description && (
          <Tooltip title={description} arrow placement="right">
            <IconButton size="small" sx={{ ml: 0.5 }}>
              <HelpIcon fontSize="small" color="action" />
            </IconButton>
          </Tooltip>
        )}
      </Box>

      <Box sx={{ display: "flex", gap: 2, alignItems: "flex-start", flexWrap: "wrap" }}>
        {/* Source selector - 1.5x wider */}
        <FormControl size="small" sx={{ minWidth: 180 }} disabled={disabled || fromDisabled}>
          <InputLabel>Source</InputLabel>
          <Select value={value.source || "header"} label="Source" onChange={(e) => handleChange("source", e.target.value)}>
            <MenuItem value="header">Header</MenuItem>
            <MenuItem value="query">Query Param</MenuItem>
          </Select>
        </FormControl>

        {/* Key input */}
        <TextField
          label="Key Name"
          size="small"
          value={value.key || ""}
          onChange={(e) => handleChange("key", e.target.value)}
          disabled={disabled}
          required={required}
          error={required && !value.key}
          placeholder={value.source === "header" ? "e.g., user-agent" : "e.g., q_param"}
          sx={{ flexGrow: 1, minWidth: 200 }}
          helperText={value.source === "header" ? "Header name (case-insensitive)" : "Query parameter name"}
        />

        {/* Pattern input */}
        {!patternHidden && (
          <TextField
            label="Pattern (Regex)"
            size="small"
            value={value.pattern || ""}
            onChange={(e) => handleChange("pattern", e.target.value)}
            disabled={disabled}
            required={patternRequired}
            placeholder="e.g., .*keyword.*"
            sx={{ flexGrow: 1, minWidth: 250 }}
            error={!!patternError || (patternRequired && !value.pattern)}
            helperText={
              patternError ||
              (patternRequired ? "Required: Regular expression pattern to match" : "Optional: Regular expression pattern to match")
            }
            InputProps={{
              endAdornment: value.pattern ? (
                patternError ? (
                  <ErrorIcon color="error" fontSize="small" />
                ) : (
                  <ValidIcon color="success" fontSize="small" />
                )
              ) : null,
            }}
          />
        )}
      </Box>
    </Paper>
  );
}

/**
 * DomainListField - Domain configuration list component
 * Domains support regex patterns and display protocol before domain name
 *
 * @param {Object} props
 * @param {Array} props.domains - Current domains [{ domain, secure }]
 * @param {Function} props.onChange - Callback when domains change
 * @param {boolean} props.disabled - Whether the field is disabled
 */
export function DomainListField({ domains = [], onChange, disabled = false }) {
  const [newDomain, setNewDomain] = React.useState("");
  const [newSecure, setNewSecure] = React.useState(true);
  const [domainError, setDomainError] = React.useState("");

  const validateDomain = (domain) => {
    if (!domain || !domain.trim()) {
      setDomainError("Domain pattern is required");
      return false;
    }
    try {
      new RegExp(domain);
      setDomainError("");
      return true;
    } catch (e) {
      setDomainError(`Invalid regex: ${e.message}`);
      return false;
    }
  };

  const handleAdd = () => {
    if (!validateDomain(newDomain)) return;

    // Check for duplicates
    if (domains.some((d) => d.domain.toLowerCase() === newDomain.toLowerCase().trim())) {
      setDomainError("Domain already exists");
      return;
    }

    onChange([...domains, { domain: newDomain.trim(), secure: newSecure }]);
    setNewDomain("");
    setNewSecure(true);
    setDomainError("");
  };

  const handleRemove = (index) => {
    const newDomains = [...domains];
    newDomains.splice(index, 1);
    onChange(newDomains);
  };

  const handleToggleSecure = (index) => {
    const newDomains = [...domains];
    newDomains[index] = {
      ...newDomains[index],
      secure: !newDomains[index].secure,
    };
    onChange(newDomains);
  };

  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
      <Box sx={{ display: "flex", alignItems: "center", mb: 2 }}>
        <Typography variant="subtitle1" fontWeight="medium">
          Monitored Domains
          <Typography component="span" color="error">
            {" "}
            *
          </Typography>
        </Typography>
        <Tooltip
          title="Add domain patterns (regex supported) to monitor. Requests to matching domains will be processed by dProxy."
          arrow
          placement="right"
        >
          <IconButton size="small" sx={{ ml: 0.5 }}>
            <HelpIcon fontSize="small" color="action" />
          </IconButton>
        </Tooltip>
      </Box>

      {/* Current domains - show protocol before domain */}
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, mb: 2 }}>
        {domains.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No domains configured. Add domains below.
          </Typography>
        ) : (
          domains.map((d, index) => (
            <Chip
              key={index}
              label={
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                  <Chip
                    size="small"
                    label={d.secure ? "HTTPS" : "HTTP"}
                    color={d.secure ? "primary" : "default"}
                    variant="outlined"
                    sx={{ height: 18, fontSize: 10 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!disabled) handleToggleSecure(index);
                    }}
                  />
                  <Typography variant="body2">{d.domain}</Typography>
                </Box>
              }
              onDelete={disabled ? undefined : () => handleRemove(index)}
              disabled={disabled}
              sx={{ py: 2 }}
            />
          ))
        )}
      </Box>

      {/* Add new domain - protocol selector before domain input */}
      {!disabled && (
        <Box sx={{ display: "flex", gap: 2, alignItems: "flex-start" }}>
          <FormControl size="small" sx={{ minWidth: 100 }}>
            <InputLabel>Protocol</InputLabel>
            <Select value={newSecure} label="Protocol" onChange={(e) => setNewSecure(e.target.value)}>
              <MenuItem value={true}>HTTPS</MenuItem>
              <MenuItem value={false}>HTTP</MenuItem>
            </Select>
          </FormControl>
          <TextField
            label="Domain Pattern (Regex)"
            size="small"
            value={newDomain}
            onChange={(e) => {
              setNewDomain(e.target.value);
              if (domainError) validateDomain(e.target.value);
            }}
            required={true}
            placeholder="e.g., .*\\.example\\.com"
            sx={{ flexGrow: 1 }}
            error={!!domainError}
            helperText={domainError || "Regex pattern to match domain names"}
            onKeyPress={(e) => e.key === "Enter" && handleAdd()}
          />
          <Box sx={{ pt: 0.5 }}>
            <Chip label="Add" color="primary" onClick={handleAdd} disabled={!newDomain.trim()} clickable />
          </Box>
        </Box>
      )}
    </Paper>
  );
}

// Secure endpoint border color (same as secure tag in secure services page)
const SECURE_BORDER_COLOR = "#942fd3";
const PUBLIC_BORDER_COLOR = "#4CAF50"; // Green for public endpoints
// Login tag color
const LOGIN_TAG_COLOR = "#FF6B35";

/**
 * EndpointTypeField - Endpoint type configuration component
 *
 * @param {Object} props
 * @param {Object} props.type - Type config { name, patterns, priority }
 * @param {Function} props.onChange - Callback when type changes
 * @param {Function} props.onRemove - Callback to remove this type
 * @param {boolean} props.disabled - Whether the field is disabled
 */
export function EndpointTypeField({ type, onChange, onRemove, disabled = false }) {
  const [newPattern, setNewPattern] = React.useState("");
  const [patternError, setPatternError] = React.useState("");

  const validatePattern = (pattern) => {
    try {
      new RegExp(pattern);
      setPatternError("");
      return true;
    } catch (e) {
      setPatternError(e.message);
      return false;
    }
  };

  const handleAddPattern = () => {
    if (!newPattern.trim()) return;
    if (!validatePattern(newPattern)) return;

    const patterns = [...(type.patterns || []), newPattern.trim()];
    onChange({ ...type, patterns });
    setNewPattern("");
    setPatternError("");
  };

  const handleRemovePattern = (index) => {
    const patterns = [...(type.patterns || [])];
    patterns.splice(index, 1);
    onChange({ ...type, patterns });
  };

  // Determine border color based on type name
  const getBorderColor = () => {
    if (type.name === "secure") return SECURE_BORDER_COLOR;
    if (type.name === "public") return PUBLIC_BORDER_COLOR;
    return "divider";
  };

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 2,
        mb: 2,
        borderColor: getBorderColor(),
        borderWidth: type.name === "secure" ? 2 : 1,
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 2 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
          <TextField
            label="Type Name"
            size="small"
            value={type.name || ""}
            onChange={(e) => onChange({ ...type, name: e.target.value })}
            disabled={disabled}
            placeholder="e.g., secure"
            sx={{ width: 150 }}
          />
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
            <TextField
              label="Priority"
              size="small"
              type="number"
              value={type.priority ?? 0}
              onChange={(e) => onChange({ ...type, priority: parseInt(e.target.value) || 0 })}
              disabled={disabled}
              sx={{ width: 80 }}
              InputProps={{ inputProps: { min: 0 } }}
            />
            <Tooltip title="Lower number = higher priority" arrow>
              <IconButton size="small" sx={{ p: 0.25 }}>
                <HelpIcon fontSize="small" color="action" />
              </IconButton>
            </Tooltip>
          </Box>
        </Box>
        {onRemove && !disabled && <Chip label="Remove" color="error" variant="outlined" onClick={onRemove} clickable />}
      </Box>

      {/* Patterns display */}
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        Patterns (endpoints matching any pattern will be classified as "{type.name}")
      </Typography>
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, mb: 2 }}>
        {(type.patterns || []).length === 0 ? (
          <Typography variant="body2" color="text.secondary" fontStyle="italic">
            No patterns defined
          </Typography>
        ) : (
          (type.patterns || []).map((pattern, index) => (
            <Chip
              key={index}
              label={pattern}
              onDelete={disabled ? undefined : () => handleRemovePattern(index)}
              variant="outlined"
              size="small"
            />
          ))
        )}
      </Box>

      {/* Add pattern */}
      {!disabled && (
        <Box sx={{ display: "flex", gap: 1, alignItems: "flex-start" }}>
          <TextField
            label="Add Pattern (Regex)"
            size="small"
            value={newPattern}
            onChange={(e) => {
              setNewPattern(e.target.value);
              if (patternError) validatePattern(e.target.value);
            }}
            placeholder="e.g., .*/sec/.*"
            sx={{ flexGrow: 1 }}
            error={!!patternError}
            helperText={patternError}
            onKeyPress={(e) => e.key === "Enter" && handleAddPattern()}
          />
          <Box sx={{ pt: 0.5 }}>
            <Chip label="Add" color="primary" onClick={handleAddPattern} disabled={!newPattern.trim() || !!patternError} clickable />
          </Box>
        </Box>
      )}
    </Paper>
  );
}

/**
 * TagField - Endpoint tag configuration component
 *
 * @param {Object} props
 * @param {Object} props.tag - Tag config { name, pattern, color }
 * @param {Function} props.onChange - Callback when tag changes
 * @param {Function} props.onRemove - Callback to remove this tag
 * @param {boolean} props.disabled - Whether the field is disabled
 */
export function TagField({ tag, onChange, onRemove, disabled = false }) {
  const [patternError, setPatternError] = React.useState("");

  const validatePattern = (pattern) => {
    if (!pattern) {
      setPatternError("");
      return true;
    }
    try {
      new RegExp(pattern);
      setPatternError("");
      return true;
    } catch (e) {
      setPatternError(e.message);
      return false;
    }
  };

  const suggestColor = (name) => {
    const colorMap = {
      transmit: LOGIN_TAG_COLOR,
      auth: LOGIN_TAG_COLOR,
      login: LOGIN_TAG_COLOR,
      api: "#2196f3",
      public: PUBLIC_BORDER_COLOR,
      secure: SECURE_BORDER_COLOR,
      admin: "#ff9800",
      user: "#00bcd4",
    };
    const lower = (name || "").toLowerCase();
    for (const [key, color] of Object.entries(colorMap)) {
      if (lower.includes(key)) {
        return color;
      }
    }
    return "#607d8b"; // Default gray
  };

  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
      <Box sx={{ display: "flex", alignItems: "flex-start", gap: 2, flexWrap: "wrap" }}>
        <TextField
          label="Tag Name"
          size="small"
          value={tag.name || ""}
          onChange={(e) => {
            const newName = e.target.value;
            const updates = { ...tag, name: newName };
            // Auto-suggest color if not set
            if (tag.color) {
              updates.color = suggestColor(newName);
            }
            onChange(updates);
          }}
          disabled={disabled}
          placeholder="e.g., Login"
          sx={{ width: 150 }}
        />

        <TextField
          label="Pattern (Regex)"
          size="small"
          value={tag.pattern || ""}
          onChange={(e) => {
            validatePattern(e.target.value);
            onChange({ ...tag, pattern: e.target.value });
          }}
          disabled={disabled}
          placeholder="e.g., .*/auth/login/.*"
          sx={{ flexGrow: 1, minWidth: 200 }}
          error={!!patternError}
          helperText={patternError}
        />

        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <TextField
            label="Color"
            size="small"
            type="color"
            value={tag.color || "#607d8b"}
            onChange={(e) => onChange({ ...tag, color: e.target.value })}
            disabled={disabled}
            sx={{ width: 80 }}
            InputProps={{
              sx: { height: 40 },
            }}
          />

          {/* Preview - Fixed width to prevent layout shift */}
          <Box sx={{ minWidth: 100, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Chip
              label={tag.name || "Preview"}
              size="small"
              sx={{
                backgroundColor: tag.color || "#607d8b",
                color: "#fff",
              }}
            />
          </Box>
        </Box>

        {onRemove && !disabled && <Chip label="Remove" color="error" variant="outlined" onClick={onRemove} clickable />}
      </Box>
    </Paper>
  );
}

export default {
  HeaderMappingField,
  DomainListField,
  EndpointTypeField,
  TagField,
};
