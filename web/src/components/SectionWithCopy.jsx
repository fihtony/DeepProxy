import React from "react";
import { Box, Typography } from "@mui/material";
import CopyButton from "./CopyButton";

/**
 * SectionWithCopy component that displays a titled section with copy button
 * Used for displaying request/response headers and body in service details
 *
 * @param {Object} props
 * @param {string} props.title - Section title
 * @param {React.ReactNode} props.children - Content to display
 * @param {string|Object} props.copyContent - Content to copy to clipboard
 * @param {string} props.copyLabel - Tooltip label for copy button (default: "Copy")
 */
function SectionWithCopy({ title, children, copyContent, copyLabel = "Copy" }) {
  return (
    <Box sx={{ mt: 1 }}>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 0 }}>
        <Typography variant="body2" sx={{ fontWeight: "bold" }}>
          {title}
        </Typography>
        <CopyButton content={copyContent} label={copyLabel} />
      </Box>
      {children}
    </Box>
  );
}

export default SectionWithCopy;
