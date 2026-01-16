import React, { useEffect, useState } from "react";
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
  Typography,
  Chip,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Grid,
  Alert,
  TextField,
} from "@mui/material";
import {
  Edit as EditIcon,
  Delete as DeleteIcon,
  Add as AddIcon,
  Refresh as RefreshIcon,
  ContentCopy as CopyIcon,
} from "@mui/icons-material";
import {
  fetchResponses,
  createResponse,
  updateResponse,
  duplicateResponse,
  selectFilteredResponses,
  selectResponsesLoading,
  selectResponsesError,
  setFilters,
  clearResponses,
} from "../store/slices/responseSlice";
import { fetchEndpoints, selectAllEndpoints } from "../store/slices/endpointSlice";
import JsonEditor from "../components/common/JsonEditor";
import HeaderEditor from "../components/common/HeaderEditor";
import StatusCodeSelector from "../components/common/StatusCodeSelector";

const ResponseManagement = () => {
  const dispatch = useDispatch();
  const responses = useSelector(selectFilteredResponses);
  const loading = useSelector(selectResponsesLoading);
  const error = useSelector(selectResponsesError);
  const endpoints = useSelector(selectAllEndpoints);

  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [selectedResponse, setSelectedResponse] = useState(null);
  const [selectedEndpointId, setSelectedEndpointId] = useState("");
  const [formData, setFormData] = useState({
    api_request_id: "",
    response_source: "custom",
    response_status: 200,
    response_headers: {},
    response_body: "",
    description: "",
  });

  // Track initialization to prevent double fetch in StrictMode
  const initializedRef = React.useRef(false);

  useEffect(() => {
    // Only fetch on initial mount, not during StrictMode remounts
    if (!initializedRef.current) {
      initializedRef.current = true;
      dispatch(fetchEndpoints());
    }
  }, [dispatch]);

  const handleEndpointChange = (endpointId) => {
    setSelectedEndpointId(endpointId);
    if (endpointId) {
      dispatch(fetchResponses(endpointId));
    } else {
      dispatch(clearResponses());
    }
  };

  const handleOpenEditDialog = (response = null) => {
    if (response) {
      setSelectedResponse(response);
      setFormData({
        api_request_id: response.api_request_id,
        response_source: response.response_source || "custom",
        response_status: response.response_status,
        response_headers: response.response_headers ? JSON.parse(response.response_headers) : {},
        response_body: response.response_body,
        description: response.description || "",
      });
    } else {
      setSelectedResponse(null);
      setFormData({
        api_request_id: selectedEndpointId || "",
        response_source: "custom",
        response_status: 200,
        response_headers: {},
        response_body: "",
        description: "",
      });
    }
    setEditDialogOpen(true);
  };

  const handleSaveResponse = async () => {
    const payload = {
      ...formData,
      response_headers: JSON.stringify(formData.response_headers),
    };

    if (selectedResponse) {
      await dispatch(updateResponse({ id: selectedResponse.id, data: payload }));
    } else {
      await dispatch(createResponse(payload));
    }
    setEditDialogOpen(false);
    if (selectedEndpointId) {
      dispatch(fetchResponses(selectedEndpointId));
    }
  };

  const handleDuplicateResponse = async (id) => {
    await dispatch(duplicateResponse(id));
    if (selectedEndpointId) {
      dispatch(fetchResponses(selectedEndpointId));
    }
  };

  const getSourceColor = (source) => {
    const colors = {
      backend: "success",
      dproxy: "info",
      custom: "warning",
    };
    return colors[source] || "default";
  };

  const getStatusColor = (status) => {
    if (status >= 200 && status < 300) return "success";
    if (status >= 400 && status < 500) return "warning";
    if (status >= 500) return "error";
    return "default";
  };

  return (
    <Box p={3}>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4">Response Management</Typography>
        <Box>
          <Button
            startIcon={<RefreshIcon />}
            onClick={() => selectedEndpointId && dispatch(fetchResponses(selectedEndpointId))}
            disabled={!selectedEndpointId}
            sx={{ mr: 1 }}
          >
            Refresh
          </Button>
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => handleOpenEditDialog()} disabled={!selectedEndpointId}>
            Add Response
          </Button>
        </Box>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Paper sx={{ mb: 3, p: 2 }}>
        <Grid container spacing={2}>
          <Grid item xs={12} sm={6}>
            <FormControl fullWidth size="small">
              <InputLabel>Select Endpoint</InputLabel>
              <Select value={selectedEndpointId} label="Select Endpoint" onChange={(e) => handleEndpointChange(e.target.value)}>
                <MenuItem value="">-- Select an endpoint --</MenuItem>
                {endpoints.map((endpoint) => (
                  <MenuItem key={endpoint.id} value={endpoint.id}>
                    {endpoint.http_method} {endpoint.endpoint_path}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} sm={3}>
            <StatusCodeSelector showCategory onChange={(value) => dispatch(setFilters({ statusCode: value }))} />
          </Grid>
          <Grid item xs={12} sm={3}>
            <FormControl fullWidth size="small">
              <InputLabel>Source</InputLabel>
              <Select defaultValue="all" label="Source" onChange={(e) => dispatch(setFilters({ source: e.target.value }))}>
                <MenuItem value="all">All Sources</MenuItem>
                <MenuItem value="backend">Backend</MenuItem>
                <MenuItem value="dproxy">dProxy</MenuItem>
                <MenuItem value="custom">Custom</MenuItem>
              </Select>
            </FormControl>
          </Grid>
        </Grid>
      </Paper>

      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Status Code</TableCell>
              <TableCell>Source</TableCell>
              <TableCell>Description</TableCell>
              <TableCell>Body Preview</TableCell>
              <TableCell>Created</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} align="center">
                  Loading...
                </TableCell>
              </TableRow>
            ) : !selectedEndpointId ? (
              <TableRow>
                <TableCell colSpan={6} align="center">
                  Please select an endpoint to view responses
                </TableCell>
              </TableRow>
            ) : !responses || responses.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} align="center">
                  No responses found
                </TableCell>
              </TableRow>
            ) : (
              responses.map((response) => (
                <TableRow key={response.id}>
                  <TableCell>
                    <Chip label={response.response_status} color={getStatusColor(response.response_status)} size="small" />
                  </TableCell>
                  <TableCell>
                    <Chip label={response.response_source} color={getSourceColor(response.response_source)} size="small" />
                  </TableCell>
                  <TableCell>{response.description || "-"}</TableCell>
                  <TableCell>
                    <Typography variant="body2" fontFamily="monospace" noWrap sx={{ maxWidth: 200 }}>
                      {response.response_body?.substring(0, 50)}...
                    </Typography>
                  </TableCell>
                  <TableCell>{new Date(response.created_at).toLocaleDateString()}</TableCell>
                  <TableCell align="right">
                    <IconButton size="small" onClick={() => handleDuplicateResponse(response.id)} title="Duplicate">
                      <CopyIcon />
                    </IconButton>
                    <IconButton size="small" onClick={() => handleOpenEditDialog(response)} title="Edit">
                      <EditIcon />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Edit Dialog */}
      <Dialog open={editDialogOpen} onClose={() => setEditDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>{selectedResponse ? "Edit Response" : "Add Response"}</DialogTitle>
        <DialogContent>
          <Box pt={1}>
            <Grid container spacing={2}>
              <Grid item xs={12} sm={6}>
                <StatusCodeSelector
                  value={formData.response_status}
                  onChange={(value) => setFormData({ ...formData, response_status: value })}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <FormControl fullWidth>
                  <InputLabel>Response Source</InputLabel>
                  <Select
                    value={formData.response_source}
                    label="Response Source"
                    onChange={(e) => setFormData({ ...formData, response_source: e.target.value })}
                  >
                    <MenuItem value="backend">Backend</MenuItem>
                    <MenuItem value="dproxy">dProxy</MenuItem>
                    <MenuItem value="custom">Custom</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Description"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Optional description"
                />
              </Grid>
              <Grid item xs={12}>
                <HeaderEditor
                  headers={formData.response_headers}
                  onChange={(headers) => setFormData({ ...formData, response_headers: headers })}
                  label="Response Headers"
                />
              </Grid>
              <Grid item xs={12}>
                <JsonEditor
                  value={formData.response_body}
                  onChange={(body) =>
                    setFormData({
                      ...formData,
                      response_body: typeof body === "string" ? body : JSON.stringify(body),
                    })
                  }
                  label="Response Body"
                  height={15}
                />
              </Grid>
            </Grid>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleSaveResponse} variant="contained">
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default ResponseManagement;
