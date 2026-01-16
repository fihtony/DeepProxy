import React from "react";
import { Chip } from "@mui/material";

/**
 * HTTP Method Tag Component
 * Displays HTTP methods with color coding following industry standards
 *
 * Color scheme:
 * - GET: Blue (#2196F3) - Safe, read-only
 * - POST: Green (#4CAF50) - Create/Submit
 * - PUT: Orange (#FF9800) - Update/Replace
 * - DELETE: Red (#F44336) - Delete
 * - PATCH: Purple (#9C27B0) - Partial update
 * - Default: Gray (#757575)
 */

const METHOD_COLORS = {
  GET: { bg: "#E3F2FD", text: "#1976D2", color: "#2196F3" },
  POST: { bg: "#E8F5E9", text: "#388E3C", color: "#4CAF50" },
  PUT: { bg: "#FFF3E0", text: "#E65100", color: "#FF9800" },
  DELETE: { bg: "#FFEBEE", text: "#C62828", color: "#F44336" },
  PATCH: { bg: "#F3E5F5", text: "#6A1B9A", color: "#9C27B0" },
  HEAD: { bg: "#F5F5F5", text: "#424242", color: "#757575" },
  OPTIONS: { bg: "#F5F5F5", text: "#424242", color: "#757575" },
};

/**
 * MethodTag Component
 * @param {string} method - HTTP method (GET, POST, PUT, DELETE, PATCH, etc.)
 * @param {number} fontSize - Font size (optional, default: "0.85rem")
 * @param {boolean} icon - Show as icon style (optional, default: false)
 */
function MethodTag({ method = "", fontSize = "0.75rem", icon = false }) {
  if (!method) {
    return <span style={{ fontSize, color: "#999" }}>—</span>;
  }

  const upperMethod = (method || "").toUpperCase().trim();
  const colorScheme = METHOD_COLORS[upperMethod] || METHOD_COLORS.HEAD;

  if (icon) {
    return (
      <Chip
        label={upperMethod}
        size="small"
        sx={{
          backgroundColor: colorScheme.bg,
          color: colorScheme.text,
          fontWeight: 600,
          fontSize: fontSize,
          height: "20px",
          "& .MuiChip-label": {
            padding: "0 8px",
          },
        }}
      />
    );
  }

  return (
    <span
      style={{
        display: "inline-block",
        backgroundColor: colorScheme.bg,
        color: colorScheme.text,
        padding: "2px 8px",
        borderRadius: "4px",
        fontSize: fontSize,
        fontWeight: 600,
        border: `1px solid ${colorScheme.color}`,
      }}
    >
      {upperMethod}
    </span>
  );
}

export default MethodTag;
