import { useDispatch, useSelector } from "react-redux";
import { useCallback, useEffect } from "react";
import {
  fetchTemplates,
  fetchTemplateById,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  setSelectedTemplate,
  clearSelectedTemplate,
  clearError,
  selectAllTemplates,
  selectSelectedTemplate,
  selectTemplatesLoading,
  selectTemplatesError,
  selectTemplateByStatusCode,
} from "../store/slices/templateSlice";

/**
 * Custom hook for managing response templates
 */
export const useTemplates = (autoFetch = true) => {
  const dispatch = useDispatch();

  const templates = useSelector(selectAllTemplates);
  const selectedTemplate = useSelector(selectSelectedTemplate);
  const loading = useSelector(selectTemplatesLoading);
  const error = useSelector(selectTemplatesError);

  // Auto-fetch on mount if enabled
  useEffect(() => {
    if (autoFetch) {
      dispatch(fetchTemplates());
    }
  }, [dispatch, autoFetch]);

  // Fetch all templates
  const fetchAll = useCallback(() => {
    return dispatch(fetchTemplates());
  }, [dispatch]);

  // Fetch template by ID
  const fetchById = useCallback(
    (id) => {
      return dispatch(fetchTemplateById(id));
    },
    [dispatch]
  );

  // Get template by status code (selector)
  const getByStatusCode = useCallback((statusCode) => {
    return selectTemplateByStatusCode(statusCode);
  }, []);

  // Create new template
  const create = useCallback(
    (templateData) => {
      return dispatch(createTemplate(templateData));
    },
    [dispatch]
  );

  // Update template
  const update = useCallback(
    (id, data) => {
      return dispatch(updateTemplate({ id, data }));
    },
    [dispatch]
  );

  // Delete template
  const remove = useCallback(
    (id) => {
      return dispatch(deleteTemplate(id));
    },
    [dispatch]
  );

  // Select template
  const select = useCallback(
    (template) => {
      dispatch(setSelectedTemplate(template));
    },
    [dispatch]
  );

  // Clear selected template
  const clearSelected = useCallback(() => {
    dispatch(clearSelectedTemplate());
  }, [dispatch]);

  // Clear error
  const clearErr = useCallback(() => {
    dispatch(clearError());
  }, [dispatch]);

  // Refresh template list
  const refresh = useCallback(() => {
    return dispatch(fetchTemplates());
  }, [dispatch]);

  return {
    templates,
    selectedTemplate,
    loading,
    error,
    fetchAll,
    fetchById,
    getByStatusCode,
    create,
    update,
    remove,
    select,
    clearSelected,
    clearError: clearErr,
    refresh,
  };
};

export default useTemplates;
