import React, { useState } from "react";
import { Box, TextField, Typography, Alert, FormControlLabel, Switch } from "@mui/material";
import PropTypes from "prop-types";

/**
 * JsonEditor Component
 * A JSON editor with syntax validation and formatting
 */
const JsonEditor = ({ value, onChange, label, error, readOnly, height }) => {
  const [localValue, setLocalValue] = useState(typeof value === "string" ? value : JSON.stringify(value, null, 2));
  const [validationError, setValidationError] = useState(null);
  const [prettyPrint, setPrettyPrint] = useState(true);

  const handleChange = (event) => {
    const newValue = event.target.value;
    setLocalValue(newValue);

    // Validate JSON
    try {
      if (newValue.trim()) {
        const parsed = JSON.parse(newValue);
        setValidationError(null);

        // Format if pretty print is enabled
        if (prettyPrint && onChange) {
          onChange(parsed);
        } else if (onChange) {
          onChange(newValue);
        }
      } else {
        setValidationError(null);
        if (onChange) onChange(null);
      }
    } catch (err) {
      setValidationError(err.message);
      // Still call onChange with the raw value for controlled input
      if (onChange) onChange(newValue);
    }
  };

  const handleFormatToggle = (event) => {
    const shouldFormat = event.target.checked;
    setPrettyPrint(shouldFormat);

    if (shouldFormat && !validationError) {
      try {
        const parsed = JSON.parse(localValue);
        const formatted = JSON.stringify(parsed, null, 2);
        setLocalValue(formatted);
        if (onChange) onChange(parsed);
      } catch (err) {
        // Do nothing if JSON is invalid
      }
    }
  };

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
        {label && (
          <Typography variant="subtitle2" color="textSecondary">
            {label}
          </Typography>
        )}
        {!readOnly && (
          <FormControlLabel
            control={<Switch checked={prettyPrint} onChange={handleFormatToggle} size="small" />}
            label="Format"
            sx={{ m: 0 }}
          />
        )}
      </Box>

      <TextField
        fullWidth
        multiline
        rows={height || 10}
        value={localValue}
        onChange={handleChange}
        disabled={readOnly}
        error={Boolean(validationError || error)}
        helperText={validationError || error}
        variant="outlined"
        sx={{
          "& .MuiInputBase-input": {
            fontFamily: "monospace",
            fontSize: "0.875rem",
          },
        }}
      />

      {validationError && (
        <Alert severity="error" sx={{ mt: 1 }}>
          Invalid JSON: {validationError}
        </Alert>
      )}
    </Box>
  );
};

JsonEditor.propTypes = {
  value: PropTypes.oneOfType([PropTypes.string, PropTypes.object, PropTypes.array]),
  onChange: PropTypes.func,
  label: PropTypes.string,
  error: PropTypes.string,
  readOnly: PropTypes.bool,
  height: PropTypes.number,
};

JsonEditor.defaultProps = {
  value: "",
  onChange: null,
  label: "",
  error: null,
  readOnly: false,
  height: 10,
};

export default JsonEditor;
