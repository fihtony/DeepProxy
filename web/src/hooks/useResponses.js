import { useDispatch, useSelector } from "react-redux";
import { useCallback, useEffect } from "react";
import {
  fetchResponses,
  fetchResponseById,
  createResponse,
  updateResponse,
  duplicateResponse,
  setSelectedResponse,
  clearSelectedResponse,
  setFilters,
  clearError,
  clearResponses,
  selectAllResponses,
  selectSelectedResponse,
  selectResponsesLoading,
  selectResponsesError,
  selectFilteredResponses,
} from "../store/slices/responseSlice";

/**
 * Custom hook for managing responses
 */
export const useResponses = (endpointId = null, autoFetch = false) => {
  const dispatch = useDispatch();

  const responses = useSelector(selectAllResponses);
  const filteredResponses = useSelector(selectFilteredResponses);
  const selectedResponse = useSelector(selectSelectedResponse);
  const loading = useSelector(selectResponsesLoading);
  const error = useSelector(selectResponsesError);

  // Auto-fetch on mount if enabled and endpointId provided
  useEffect(() => {
    if (autoFetch && endpointId) {
      dispatch(fetchResponses(endpointId));
    }
  }, [dispatch, endpointId, autoFetch]);

  // Fetch responses for endpoint
  const fetchForEndpoint = useCallback(
    (epId) => {
      return dispatch(fetchResponses(epId || endpointId));
    },
    [dispatch, endpointId]
  );

  // Fetch response by ID
  const fetchById = useCallback(
    (id) => {
      return dispatch(fetchResponseById(id));
    },
    [dispatch]
  );

  // Create new response
  const create = useCallback(
    (responseData) => {
      return dispatch(createResponse(responseData));
    },
    [dispatch]
  );

  // Update response
  const update = useCallback(
    (id, data) => {
      return dispatch(updateResponse({ id, data }));
    },
    [dispatch]
  );

  // Duplicate response
  const duplicate = useCallback(
    (id) => {
      return dispatch(duplicateResponse(id));
    },
    [dispatch]
  );

  // Select response
  const select = useCallback(
    (response) => {
      dispatch(setSelectedResponse(response));
    },
    [dispatch]
  );

  // Clear selected response
  const clearSelected = useCallback(() => {
    dispatch(clearSelectedResponse());
  }, [dispatch]);

  // Set filters
  const setFilter = useCallback(
    (filters) => {
      dispatch(setFilters(filters));
    },
    [dispatch]
  );

  // Clear error
  const clearErr = useCallback(() => {
    dispatch(clearError());
  }, [dispatch]);

  // Clear all responses
  const clear = useCallback(() => {
    dispatch(clearResponses());
  }, [dispatch]);

  // Refresh response list
  const refresh = useCallback(() => {
    if (endpointId) {
      return dispatch(fetchResponses(endpointId));
    }
  }, [dispatch, endpointId]);

  return {
    responses,
    filteredResponses,
    selectedResponse,
    loading,
    error,
    fetchForEndpoint,
    fetchById,
    create,
    update,
    duplicate,
    select,
    clearSelected,
    setFilter,
    clearError: clearErr,
    clear,
    refresh,
  };
};

export default useResponses;
