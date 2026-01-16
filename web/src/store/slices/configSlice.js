import { createSlice } from "@reduxjs/toolkit";

const configSlice = createSlice({
  name: "config",
  initialState: {
    endpointConfig: {
      types: [],
      tags: [],
      fallback: "public",
    },
    endpointConfigLoading: false,
    endpointConfigError: null,
    lastFetched: null,
  },
  reducers: {
    // Set endpoint configuration
    setEndpointConfig: (state, action) => {
      state.endpointConfig = action.payload;
      state.lastFetched = new Date().toISOString();
      state.endpointConfigError = null;
    },
    // Start loading endpoint config
    setEndpointConfigLoading: (state, action) => {
      state.endpointConfigLoading = action.payload;
      if (action.payload) {
        state.endpointConfigError = null;
      }
    },
    // Set error when loading endpoint config fails
    setEndpointConfigError: (state, action) => {
      state.endpointConfigError = action.payload;
      state.endpointConfigLoading = false;
    },
    // Clear endpoint config
    clearEndpointConfig: (state) => {
      state.endpointConfig = {
        types: [],
        tags: [],
        fallback: "public",
      };
      state.endpointConfigError = null;
      state.lastFetched = null;
    },
  },
});

export const { setEndpointConfig, setEndpointConfigLoading, setEndpointConfigError, clearEndpointConfig } = configSlice.actions;

// Selectors
export const selectEndpointConfig = (state) => state.config?.endpointConfig;
export const selectEndpointConfigLoading = (state) => state.config?.endpointConfigLoading;
export const selectEndpointConfigError = (state) => state.config?.endpointConfigError;
export const selectEndpointConfigLastFetched = (state) => state.config?.lastFetched;

export default configSlice.reducer;
