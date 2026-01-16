import { useDispatch, useSelector } from "react-redux";
import { useCallback, useEffect } from "react";
import {
  fetchEndpoints,
  fetchEndpointById,
  createEndpoint,
  updateEndpoint,
  deleteEndpoint,
  updateMatchingConfig,
  setSelectedEndpoint,
  clearSelectedEndpoint,
  setFilters,
  clearError,
  selectAllEndpoints,
  selectSelectedEndpoint,
  selectEndpointsLoading,
  selectEndpointsError,
  selectFilteredEndpoints,
} from "../store/slices/endpointSlice";

/**
 * Custom hook for managing endpoints
 */
export const useEndpoints = (autoFetch = true) => {
  const dispatch = useDispatch();

  const endpoints = useSelector(selectAllEndpoints);
  const filteredEndpoints = useSelector(selectFilteredEndpoints);
  const selectedEndpoint = useSelector(selectSelectedEndpoint);
  const loading = useSelector(selectEndpointsLoading);
  const error = useSelector(selectEndpointsError);

  // Auto-fetch on mount if enabled
  useEffect(() => {
    if (autoFetch) {
      dispatch(fetchEndpoints());
    }
  }, [dispatch, autoFetch]);

  // Fetch all endpoints
  const fetchAll = useCallback(() => {
    return dispatch(fetchEndpoints());
  }, [dispatch]);

  // Fetch endpoint by ID
  const fetchById = useCallback(
    (id) => {
      return dispatch(fetchEndpointById(id));
    },
    [dispatch]
  );

  // Create new endpoint
  const create = useCallback(
    (endpointData) => {
      return dispatch(createEndpoint(endpointData));
    },
    [dispatch]
  );

  // Update endpoint
  const update = useCallback(
    (id, data) => {
      return dispatch(updateEndpoint({ id, data }));
    },
    [dispatch]
  );

  // Delete endpoint
  const remove = useCallback(
    (id) => {
      return dispatch(deleteEndpoint(id));
    },
    [dispatch]
  );

  // Update matching configuration
  const updateConfig = useCallback(
    (id, config) => {
      return dispatch(updateMatchingConfig({ id, config }));
    },
    [dispatch]
  );

  // Select endpoint
  const select = useCallback(
    (endpoint) => {
      dispatch(setSelectedEndpoint(endpoint));
    },
    [dispatch]
  );

  // Clear selected endpoint
  const clearSelected = useCallback(() => {
    dispatch(clearSelectedEndpoint());
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

  // Refresh endpoint list
  const refresh = useCallback(() => {
    return dispatch(fetchEndpoints());
  }, [dispatch]);

  return {
    endpoints,
    filteredEndpoints,
    selectedEndpoint,
    loading,
    error,
    fetchAll,
    fetchById,
    create,
    update,
    remove,
    updateConfig,
    select,
    clearSelected,
    setFilter,
    clearError: clearErr,
    refresh,
  };
};

export default useEndpoints;
