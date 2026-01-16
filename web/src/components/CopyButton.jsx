import React, { useState } from "react";
import { IconButton, Tooltip } from "@mui/material";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import CheckIcon from "@mui/icons-material/Check";

/**
 * CopyButton component that copies content to clipboard
 * Shows a success indicator briefly after copying
 *
 * @param {Object} props
 * @param {string|Object} props.content - Content to copy (will be stringified if object)
 * @param {string} props.label - Tooltip label
 * @param {number} props.successDuration - Duration to show success indicator in ms (default: 1500)
 */
function CopyButton({ content, label = "Copy", successDuration = 1500 }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e) => {
    e.stopPropagation();

    try {
      let textToCopy;

      // Format content based on type
      if (typeof content === "string") {
        // Try to parse as JSON and re-format for consistency
        try {
          const parsed = JSON.parse(content);
          textToCopy = JSON.stringify(parsed, null, 2);
        } catch {
          // If not valid JSON, use as-is
          textToCopy = content;
        }
      } else {
        // Object: format with proper indentation
        textToCopy = JSON.stringify(content, null, 2);
      }

      // Use Clipboard API
      await navigator.clipboard.writeText(textToCopy);

      // Show success state
      setCopied(true);
      setTimeout(() => setCopied(false), successDuration);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  return (
    <Tooltip title={copied ? "Copied!" : label}>
      <IconButton
        size="small"
        onClick={handleCopy}
        sx={{
          color: copied ? "success.main" : "primary.main",
          transition: "all 0.2s ease",
          "&:hover": {
            backgroundColor: "action.hover",
          },
        }}
      >
        {copied ? <CheckIcon fontSize="small" /> : <ContentCopyIcon fontSize="small" />}
      </IconButton>
    </Tooltip>
  );
}

export default CopyButton;
