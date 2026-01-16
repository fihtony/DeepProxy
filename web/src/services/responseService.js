import api from "./api";

// Get all responses for an endpoint
export const getResponsesByEndpoint = async (endpointId) => {
  const response = await api.get(`/api/responses/request/${endpointId}`);
  return response.data;
};

// Get response by ID
export const getResponseById = async (id) => {
  const response = await api.get(`/api/responses/${id}`);
  return response.data;
};

// Create new response
export const createResponse = async (responseData) => {
  const response = await api.post("/api/responses", responseData);
  return response.data;
};

// Update response
export const updateResponse = async (id, data) => {
  const response = await api.put(`/api/responses/${id}`, data);
  return response.data;
};

// Duplicate response
export const duplicateResponse = async (id) => {
  const response = await api.post(`/api/responses/${id}/duplicate`);
  return response.data;
};

// Get responses by filters
export const getFilteredResponses = async (filters) => {
  const params = new URLSearchParams();

  if (filters.endpointId) {
    params.append("api_request_id", filters.endpointId);
  }
  if (filters.statusCode) {
    params.append("response_status", filters.statusCode);
  }
  if (filters.source) {
    params.append("response_source", filters.source);
  }

  const response = await api.get(`/api/responses?${params.toString()}`);
  return response.data;
};

// Set response as default for status code
export const setDefaultResponse = async (endpointId, statusCode, responseId) => {
  const response = await api.post(`/api/responses/${responseId}/set-default`, {
    endpoint_id: endpointId,
    status_code: statusCode,
  });
  return response.data;
};
