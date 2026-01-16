/**
 * API Service
 *
 * Axios-based API client for dProxy backend.
 * Handles all HTTP requests to the admin API.
 */

import axios from "axios";

// Create axios instance with defaults
const api = axios.create({
  baseURL: "/admin",
  timeout: 30000,
  headers: {
    "Content-Type": "application/json",
  },
});

// Add request interceptor for API key (disabled in POC)
api.interceptors.request.use(
  (config) => {
    // TODO: Enable API key authentication after POC
    // const apiKey = localStorage.getItem("dproxy_api_key");
    // if (apiKey) {
    //   config.headers.Authorization = `Bearer ${apiKey}`;
    // }
    return config;
  },
  (error) => Promise.reject(error)
);

// Add response interceptor for error handling
api.interceptors.response.use(
  (response) => response.data,
  (error) => {
    // TODO: Handle 401 errors after enabling API key authentication
    return Promise.reject(error);
  }
);

// Mode Management
export const getMode = () => api.get("/mode");
export const setMode = (mode) => api.post("/mode", { mode });

// Statistics
export const getStats = (params = {}, config = {}) => {
  const { signal, ...otherConfig } = config;
  const requestConfig = {
    params,
    ...otherConfig,
  };
  if (signal) {
    requestConfig.signal = signal;
  }
  return api.get("/stats", requestConfig);
};
export const getEndpointStats = (endpointName) => api.get(`/stats/endpoint/${endpointName}`);

// Users
export const getUsers = (params = {}) => api.get("/users", { params });
export const getUserDetails = (userId) => api.get(`/users/${userId}`);
export const getUserRequests = (userId, params = {}) => api.get(`/users/${userId}/requests`, { params });

// Requests
export const getRequestDetails = (requestId) => api.get(`/requests/${requestId}`);
export const updateRequest = (requestId, data) => api.put(`/requests/${requestId}`, data);

// Endpoints
export const getEndpoints = () => api.get("/endpoints");
export const getEndpointDetails = (endpointId) => api.get(`/endpoints/${endpointId}`);
export const updateEndpoint = (endpointId, data) => api.put(`/endpoints/${endpointId}`, data);

// Processors
export const getProcessors = (params = {}) => api.get("/processors", { params });
export const toggleProcessor = (processorId) => api.patch(`/processors/${processorId}/toggle`);

// Services (New API)
export const getPublicServices = (params = {}) => api.get("/services/public", { params });
export const getPublicServiceDetail = (id) => api.get(`/services/public/${id}`);
export const getSecureServices = (params = {}) => api.get("/services/secure", { params });
export const getSecureServiceDetail = (id) => api.get(`/services/secure/${id}`);

// Configs
export const getConfigs = () => api.get("/api/configs");
export const getConfigDetails = (id) => api.get(`/api/configs/${id}`);
export const updateConfig = (id, data) => api.put(`/api/configs/${id}`, data);

// Timeline filter (stored in proxy config)
export const getTimelineFilter = async () => {
  try {
    const response = await api.get("/api/timeline-filter");
    return response?.timelineFilter || null;
  } catch (error) {
    console.error("Failed to get timeline filter:", error);
    return null;
  }
};

export const saveTimelineFilter = async (timelineFilter) => {
  try {
    const response = await api.post("/api/timeline-filter", { timelineFilter });
    return response?.success || false;
  } catch (error) {
    console.error("Failed to save timeline filter:", error);
    return false;
  }
};

// Search
export const search = (query, params = {}) => api.get("/search", { params: { q: query, ...params } });

// Health Check
export const healthCheck = () => axios.get("/health");

export default api;
