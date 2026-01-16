import React, { useState } from "react";
import { Box, TextField, Button, IconButton, Typography, Paper, Grid } from "@mui/material";
import { Add as AddIcon, Delete as DeleteIcon } from "@mui/icons-material";
import PropTypes from "prop-types";

/**
 * HeaderEditor Component
 * Edit HTTP headers as key-value pairs
 */
const HeaderEditor = ({ headers, onChange, label, readOnly }) => {
  const [localHeaders, setLocalHeaders] = useState(() => {
    if (!headers) return [{ key: "", value: "" }];

    if (typeof headers === "string") {
      try {
        const parsed = JSON.parse(headers);
        return Object.entries(parsed).map(([key, value]) => ({ key, value }));
      } catch {
        return [{ key: "", value: "" }];
      }
    }

    if (typeof headers === "object" && !Array.isArray(headers)) {
      return Object.entries(headers).map(([key, value]) => ({ key, value }));
    }

    return headers.length > 0 ? headers : [{ key: "", value: "" }];
  });

  const handleHeaderChange = (index, field, value) => {
    const newHeaders = [...localHeaders];
    newHeaders[index][field] = value;
    setLocalHeaders(newHeaders);

    // Convert to object format for onChange
    if (onChange) {
      const headersObject = newHeaders
        .filter((h) => h.key.trim())
        .reduce((acc, h) => {
          acc[h.key] = h.value;
          return acc;
        }, {});
      onChange(headersObject);
    }
  };

  const handleAddHeader = () => {
    const newHeaders = [...localHeaders, { key: "", value: "" }];
    setLocalHeaders(newHeaders);
  };

  const handleRemoveHeader = (index) => {
    const newHeaders = localHeaders.filter((_, i) => i !== index);
    setLocalHeaders(newHeaders.length > 0 ? newHeaders : [{ key: "", value: "" }]);

    if (onChange) {
      const headersObject = newHeaders
        .filter((h) => h.key.trim())
        .reduce((acc, h) => {
          acc[h.key] = h.value;
          return acc;
        }, {});
      onChange(headersObject);
    }
  };

  return (
    <Box>
      {label && (
        <Typography variant="subtitle2" color="textSecondary" gutterBottom>
          {label}
        </Typography>
      )}

      <Paper variant="outlined" sx={{ p: 2 }}>
        {localHeaders.map((header, index) => (
          <Grid container spacing={2} key={index} alignItems="center" sx={{ mb: 2 }}>
            <Grid item xs={5}>
              <TextField
                fullWidth
                size="small"
                label="Header Name"
                value={header.key}
                onChange={(e) => handleHeaderChange(index, "key", e.target.value)}
                disabled={readOnly}
                placeholder="Content-Type"
              />
            </Grid>
            <Grid item xs={6}>
              <TextField
                fullWidth
                size="small"
                label="Header Value"
                value={header.value}
                onChange={(e) => handleHeaderChange(index, "value", e.target.value)}
                disabled={readOnly}
                placeholder="application/json"
              />
            </Grid>
            <Grid item xs={1}>
              {!readOnly && localHeaders.length > 1 && (
                <IconButton size="small" color="error" onClick={() => handleRemoveHeader(index)}>
                  <DeleteIcon />
                </IconButton>
              )}
            </Grid>
          </Grid>
        ))}

        {!readOnly && (
          <Button startIcon={<AddIcon />} onClick={handleAddHeader} size="small" variant="outlined">
            Add Header
          </Button>
        )}
      </Paper>
    </Box>
  );
};

HeaderEditor.propTypes = {
  headers: PropTypes.oneOfType([
    PropTypes.string,
    PropTypes.object,
    PropTypes.arrayOf(
      PropTypes.shape({
        key: PropTypes.string,
        value: PropTypes.string,
      })
    ),
  ]),
  onChange: PropTypes.func,
  label: PropTypes.string,
  readOnly: PropTypes.bool,
};

HeaderEditor.defaultProps = {
  headers: null,
  onChange: null,
  label: "",
  readOnly: false,
};

export default HeaderEditor;
