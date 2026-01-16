import React from "react";
import { Box, Paper } from "@mui/material";

/**
 * JsonDisplay Component
 *
 * Displays JSON in a human-readable format where:
 * - Each field is on one line (no wrapping)
 * - Proper indentation for nested objects
 * - Scrollbars appear if content is too long
 */
function JsonDisplay({ data, maxHeight = "300px" }) {
  // Convert data to a formatted string where each field is on one line
  const formatJson = (obj, indent = 0) => {
    if (obj === null || obj === undefined) {
      return "null";
    }

    if (typeof obj !== "object") {
      if (typeof obj === "string") {
        return `"${obj}"`;
      }
      return String(obj);
    }

    if (Array.isArray(obj)) {
      if (obj.length === 0) return "[]";
      const items = obj.map((item) => {
        const formatted = formatJson(item, indent + 1);
        return `  `.repeat(indent + 1) + formatted;
      });
      return "[\n" + items.join(",\n") + "\n" + `  `.repeat(indent) + "]";
    }

    // Object
    const keys = Object.keys(obj);
    if (keys.length === 0) return "{}";

    const items = keys.map((key) => {
      const value = obj[key];
      const formatted = formatJson(value, indent + 1);
      // Keep everything on one line for simple values
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null) {
        return `  `.repeat(indent + 1) + `"${key}": ${formatted}`;
      }
      // For objects/arrays, allow multiline
      return `  `.repeat(indent + 1) + `"${key}": ${formatted}`;
    });

    return "{\n" + items.join(",\n") + "\n" + `  `.repeat(indent) + "}";
  };

  const jsonString = typeof data === "string" ? data : formatJson(data);

  return (
    <Box
      sx={{
        backgroundColor: "#fff",
        p: 1.5,
        borderRadius: 1,
        fontFamily: "monospace",
        fontSize: "0.8rem",
        overflowX: "auto",
        overflowY: "auto",
        maxHeight: maxHeight,
        whiteSpace: "pre",
        wordBreak: "break-word",
        color: "#333",
        lineHeight: "1.5",
        border: "1px solid #e0e0e0",
      }}
    >
      {jsonString}
    </Box>
  );
}

export default JsonDisplay;
