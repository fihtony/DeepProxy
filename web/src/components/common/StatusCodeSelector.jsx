import React from "react";
import { FormControl, InputLabel, Select, MenuItem, Chip, Box, Typography } from "@mui/material";
import PropTypes from "prop-types";

/**
 * StatusCodeSelector Component
 * Select HTTP status codes with common categories
 */
const StatusCodeSelector = ({ value = null, onChange = null, label = "", multiple = false, showCategory = false }) => {
  const statusCodes = [
    { code: 200, label: "200 OK", category: "2xx - Success" },
    { code: 201, label: "201 Created", category: "2xx - Success" },
    { code: 204, label: "204 No Content", category: "2xx - Success" },
    { code: 400, label: "400 Bad Request", category: "4xx - Client Error" },
    { code: 401, label: "401 Unauthorized", category: "4xx - Client Error" },
    { code: 403, label: "403 Forbidden", category: "4xx - Client Error" },
    { code: 404, label: "404 Not Found", category: "4xx - Client Error" },
    { code: 409, label: "409 Conflict", category: "4xx - Client Error" },
    { code: 422, label: "422 Unprocessable Entity", category: "4xx - Client Error" },
    { code: 500, label: "500 Internal Server Error", category: "5xx - Server Error" },
    { code: 502, label: "502 Bad Gateway", category: "5xx - Server Error" },
    { code: 503, label: "503 Service Unavailable", category: "5xx - Server Error" },
    { code: 504, label: "504 Gateway Timeout", category: "5xx - Server Error" },
  ];

  const categories = [
    { value: "2xx", label: "2xx - Success" },
    { value: "4xx", label: "4xx - Client Error" },
    { value: "5xx", label: "5xx - Server Error" },
  ];

  const getColorForCode = (code) => {
    if (code >= 200 && code < 300) return "success";
    if (code >= 400 && code < 500) return "warning";
    if (code >= 500) return "error";
    return "default";
  };

  const handleChange = (event) => {
    if (onChange) {
      onChange(event.target.value);
    }
  };

  if (showCategory) {
    // Render category selector (2xx, 4xx, 5xx)
    return (
      <FormControl fullWidth>
        <InputLabel>{label || "Status Code Category"}</InputLabel>
        <Select value={value || ""} onChange={handleChange} label={label || "Status Code Category"}>
          <MenuItem value="all">All Status Codes</MenuItem>
          {categories.map((cat) => (
            <MenuItem key={cat.value} value={cat.value}>
              {cat.label}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
    );
  }

  if (multiple) {
    return (
      <FormControl fullWidth>
        <InputLabel>{label || "Status Codes"}</InputLabel>
        <Select
          multiple
          value={value || []}
          onChange={handleChange}
          label={label || "Status Codes"}
          renderValue={(selected) => (
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
              {selected.map((code) => (
                <Chip key={code} label={code} size="small" color={getColorForCode(code)} />
              ))}
            </Box>
          )}
        >
          {statusCodes.map((status) => (
            <MenuItem key={status.code} value={status.code}>
              <Chip label={status.code} size="small" color={getColorForCode(status.code)} sx={{ mr: 1 }} />
              <Typography variant="body2">{status.label}</Typography>
            </MenuItem>
          ))}
        </Select>
      </FormControl>
    );
  }

  // Single select
  return (
    <FormControl fullWidth>
      <InputLabel>{label || "Status Code"}</InputLabel>
      <Select value={value || ""} onChange={handleChange} label={label || "Status Code"}>
        {statusCodes.map((status) => (
          <MenuItem key={status.code} value={status.code}>
            <Box display="flex" alignItems="center">
              <Chip label={status.code} size="small" color={getColorForCode(status.code)} sx={{ mr: 1 }} />
              <Typography variant="body2">{status.label}</Typography>
            </Box>
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
};

StatusCodeSelector.propTypes = {
  value: PropTypes.oneOfType([PropTypes.number, PropTypes.string, PropTypes.array]),
  onChange: PropTypes.func,
  label: PropTypes.string,
  multiple: PropTypes.bool,
  showCategory: PropTypes.bool,
};

export default StatusCodeSelector;
