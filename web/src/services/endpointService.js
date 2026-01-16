import api from "./api";

// Get all api_requests (for ResponseManagement dropdown)
export const getAllRequests = async (pageSize = 500) => {
  const response = await api.get("/api/requests", { params: { pageSize } });
  return response;
};

// Get all endpoint matching configurations
export const getAllConfigs = async () => {
  const response = await api.get("/api/configs");
  return response;
};

// Get available endpoints from api_requests for dropdown
export const getAvailableEndpoints = async (method = null) => {
  const params = method ? { method } : {};
  const response = await api.get("/api/configs/available-endpoints", { params });
  return response;
};

// Get config by ID
export const getConfigById = async (id) => {
  const response = await api.get(`/api/configs/${id}`);
  // api interceptor already returns response.data, so response is the actual data
  return response;
};

// Create new endpoint configuration
export const createConfig = async (configData) => {
  const response = await api.post("/api/configs", configData);
  // api interceptor already returns response.data, so response is the actual data
  return response;
};

// Update endpoint configuration
export const updateConfig = async (id, data) => {
  const response = await api.put(`/api/configs/${id}`, data);
  // api interceptor already returns response.data, so response is the actual data
  return response;
};

// Toggle endpoint enabled status
export const toggleConfig = async (id, enabled) => {
  const response = await api.patch(`/api/configs/${id}/toggle`, { enabled });
  return response;
};

// Delete endpoint configuration
export const deleteConfig = async (id) => {
  const response = await api.delete(`/api/configs/${id}`);
  // api interceptor already returns response.data, so response is the actual data
  return response;
};
