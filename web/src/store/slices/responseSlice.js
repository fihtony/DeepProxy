import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import * as responseService from "../../services/responseService";

// Async thunks
export const fetchResponses = createAsyncThunk("responses/fetchAll", async (endpointId, { rejectWithValue }) => {
  try {
    const data = await responseService.getResponsesByEndpoint(endpointId);
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data || error.message);
  }
});

export const fetchResponseById = createAsyncThunk("responses/fetchById", async (id, { rejectWithValue }) => {
  try {
    const data = await responseService.getResponseById(id);
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data || error.message);
  }
});

export const createResponse = createAsyncThunk("responses/create", async (responseData, { rejectWithValue }) => {
  try {
    const data = await responseService.createResponse(responseData);
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data || error.message);
  }
});

export const updateResponse = createAsyncThunk("responses/update", async ({ id, data }, { rejectWithValue }) => {
  try {
    const result = await responseService.updateResponse(id, data);
    return result;
  } catch (error) {
    return rejectWithValue(error.response?.data || error.message);
  }
});

export const duplicateResponse = createAsyncThunk("responses/duplicate", async (id, { rejectWithValue }) => {
  try {
    const data = await responseService.duplicateResponse(id);
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data || error.message);
  }
});

const responseSlice = createSlice({
  name: "responses",
  initialState: {
    list: [],
    selectedResponse: null,
    loading: false,
    error: null,
    filters: {
      statusCode: "all",
      source: "all",
      searchTerm: "",
    },
  },
  reducers: {
    setSelectedResponse: (state, action) => {
      state.selectedResponse = action.payload;
    },
    clearSelectedResponse: (state) => {
      state.selectedResponse = null;
    },
    setFilters: (state, action) => {
      state.filters = { ...state.filters, ...action.payload };
    },
    clearError: (state) => {
      state.error = null;
    },
    clearResponses: (state) => {
      state.list = [];
      state.selectedResponse = null;
    },
  },
  extraReducers: (builder) => {
    // Fetch responses
    builder
      .addCase(fetchResponses.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchResponses.fulfilled, (state, action) => {
        state.loading = false;
        state.list = action.payload;
      })
      .addCase(fetchResponses.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      });

    // Fetch response by ID
    builder
      .addCase(fetchResponseById.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchResponseById.fulfilled, (state, action) => {
        state.loading = false;
        state.selectedResponse = action.payload;
      })
      .addCase(fetchResponseById.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      });

    // Create response
    builder
      .addCase(createResponse.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(createResponse.fulfilled, (state, action) => {
        state.loading = false;
        state.list.push(action.payload);
      })
      .addCase(createResponse.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      });

    // Update response
    builder
      .addCase(updateResponse.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(updateResponse.fulfilled, (state, action) => {
        state.loading = false;
        const index = state.list.findIndex((res) => res.id === action.payload.id);
        if (index !== -1) {
          state.list[index] = action.payload;
        }
        if (state.selectedResponse?.id === action.payload.id) {
          state.selectedResponse = action.payload;
        }
      })
      .addCase(updateResponse.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      });

    // Duplicate response
    builder
      .addCase(duplicateResponse.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(duplicateResponse.fulfilled, (state, action) => {
        state.loading = false;
        state.list.push(action.payload);
      })
      .addCase(duplicateResponse.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      });
  },
});

export const { setSelectedResponse, clearSelectedResponse, setFilters, clearError, clearResponses } = responseSlice.actions;

export default responseSlice.reducer;

// Selectors
export const selectAllResponses = (state) => state.responses.list;
export const selectSelectedResponse = (state) => state.responses.selectedResponse;
export const selectResponsesLoading = (state) => state.responses.loading;
export const selectResponsesError = (state) => state.responses.error;
export const selectResponseFilters = (state) => state.responses.filters;

export const selectFilteredResponses = (state) => {
  const { list, filters } = state.responses || { list: [], filters: {} };
  let filtered = list || [];

  if (filters.statusCode && filters.statusCode !== "all") {
    filtered = filtered.filter((res) => {
      const statusStr = String(res.response_status);
      return statusStr.startsWith(filters.statusCode.replace("xx", ""));
    });
  }

  if (filters.source && filters.source !== "all") {
    filtered = filtered.filter((res) => res.response_source === filters.source);
  }

  if (filters.searchTerm) {
    const term = filters.searchTerm.toLowerCase();
    filtered = filtered.filter((res) => res.description?.toLowerCase().includes(term) || String(res.response_status).includes(term));
  }

  return filtered;
};
