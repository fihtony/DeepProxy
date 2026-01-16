import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import * as endpointService from "../../services/endpointService";

// Async thunks

// Fetch api_requests for ResponseManagement page
export const fetchEndpoints = createAsyncThunk("endpoints/fetchEndpoints", async (_, { rejectWithValue }) => {
  try {
    const data = await endpointService.getAllRequests();
    // data format: { data: [...], total: n, page: n, pageSize: n }
    return data.data || [];
  } catch (error) {
    return rejectWithValue(error.response?.data || error.message);
  }
});

export const fetchConfigs = createAsyncThunk("endpoints/fetchAll", async (_, { rejectWithValue }) => {
  try {
    const data = await endpointService.getAllConfigs();
    return data.data || [];
  } catch (error) {
    return rejectWithValue(error.response?.data || error.message);
  }
});

export const fetchAvailableEndpoints = createAsyncThunk("endpoints/fetchAvailableEndpoints", async (method = null, { rejectWithValue }) => {
  try {
    const data = await endpointService.getAvailableEndpoints(method);
    return data.data || [];
  } catch (error) {
    console.error("[endpointSlice] fetchAvailableEndpoints error:", error.message);
    return rejectWithValue(error.response?.data || error.message);
  }
});

export const createConfig = createAsyncThunk("endpoints/create", async (configData, { rejectWithValue }) => {
  try {
    const data = await endpointService.createConfig(configData);
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data || error.message);
  }
});

export const updateConfig = createAsyncThunk("endpoints/update", async ({ id, data }, { rejectWithValue }) => {
  try {
    const result = await endpointService.updateConfig(id, data);
    return result;
  } catch (error) {
    return rejectWithValue(error.response?.data || error.message);
  }
});

export const toggleConfig = createAsyncThunk("endpoints/toggle", async ({ id, enabled }, { rejectWithValue }) => {
  try {
    const result = await endpointService.toggleConfig(id, enabled);
    // result is already the data object (no need for result.data)
    return { id, enabled: result.data.enabled };
  } catch (error) {
    return rejectWithValue(error.response?.data || error.message);
  }
});

export const deleteConfig = createAsyncThunk("endpoints/delete", async (id, { rejectWithValue }) => {
  try {
    await endpointService.deleteConfig(id);
    return id;
  } catch (error) {
    return rejectWithValue(error.response?.data || error.message);
  }
});

const endpointSlice = createSlice({
  name: "endpoints",
  initialState: {
    configs: [],
    availableEndpoints: [],
    allEndpoints: [], // api_requests for ResponseManagement
    loading: false,
    error: null,
  },
  reducers: {
    clearError: (state) => {
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    // Fetch all endpoints (api_requests)
    builder
      .addCase(fetchEndpoints.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchEndpoints.fulfilled, (state, action) => {
        state.loading = false;
        state.allEndpoints = action.payload;
      })
      .addCase(fetchEndpoints.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      });

    // Fetch all configs
    builder
      .addCase(fetchConfigs.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchConfigs.fulfilled, (state, action) => {
        state.loading = false;
        state.configs = action.payload;
      })
      .addCase(fetchConfigs.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      });

    // Fetch available endpoints
    builder.addCase(fetchAvailableEndpoints.fulfilled, (state, action) => {
      state.availableEndpoints = action.payload;
    });

    // Create config
    builder
      .addCase(createConfig.pending, (state) => {
        state.loading = true;
      })
      .addCase(createConfig.fulfilled, (state) => {
        state.loading = false;
      })
      .addCase(createConfig.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      });

    // Update config
    builder
      .addCase(updateConfig.pending, (state) => {
        state.loading = true;
      })
      .addCase(updateConfig.fulfilled, (state) => {
        state.loading = false;
      })
      .addCase(updateConfig.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      });

    // Toggle config
    builder.addCase(toggleConfig.fulfilled, (state, action) => {
      const { id, enabled } = action.payload;
      const config = state.configs.find((c) => c.id === id);
      if (config) {
        config.enabled = enabled ? 1 : 0;
      }
    });

    // Delete config
    builder.addCase(deleteConfig.fulfilled, (state, action) => {
      state.configs = state.configs.filter((c) => c.id !== action.payload);
    });
  },
});

// Selectors
export const selectConfigs = (state) => state.endpoints.configs;
export const selectAvailableEndpoints = (state) => state.endpoints.availableEndpoints;
export const selectAllEndpoints = (state) => state.endpoints.allEndpoints;
export const selectEndpointsLoading = (state) => state.endpoints.loading;
export const selectEndpointsError = (state) => state.endpoints.error;

export const { clearError } = endpointSlice.actions;
export default endpointSlice.reducer;
