import api from "./api";

// Get all templates
export const getAllTemplates = async () => {
  const response = await api.get("/api/templates");
  return response.data;
};

// Get template by ID
export const getTemplateById = async (id) => {
  const response = await api.get(`/api/templates/${id}`);
  return response.data;
};

// Get template by status code
export const getTemplateByStatusCode = async (statusCode) => {
  const response = await api.get(`/api/templates?response_status=${statusCode}`);
  return response.data;
};

// Create new template
export const createTemplate = async (templateData) => {
  const response = await api.post("/api/templates", templateData);
  return response.data;
};

// Update template
export const updateTemplate = async (id, data) => {
  const response = await api.put(`/api/templates/${id}`, data);
  return response.data;
};

// Delete template
export const deleteTemplate = async (id) => {
  const response = await api.delete(`/api/templates/${id}`);
  return response.data;
};

// Get common status code templates
export const getCommonTemplates = async () => {
  const commonCodes = [200, 201, 204, 400, 401, 403, 404, 500, 502, 503];
  const promises = commonCodes.map((code) => getTemplateByStatusCode(code).catch(() => null));
  const results = await Promise.all(promises);
  return results.filter((t) => t !== null);
};
