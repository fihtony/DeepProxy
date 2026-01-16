import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import * as templateService from "../../services/templateService";

// Async thunks
export const fetchTemplates = createAsyncThunk("templates/fetchAll", async (_, { rejectWithValue }) => {
  try {
    const data = await templateService.getAllTemplates();
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data || error.message);
  }
});

export const fetchTemplateById = createAsyncThunk("templates/fetchById", async (id, { rejectWithValue }) => {
  try {
    const data = await templateService.getTemplateById(id);
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data || error.message);
  }
});

export const createTemplate = createAsyncThunk("templates/create", async (templateData, { rejectWithValue }) => {
  try {
    const data = await templateService.createTemplate(templateData);
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data || error.message);
  }
});

export const updateTemplate = createAsyncThunk("templates/update", async ({ id, data }, { rejectWithValue }) => {
  try {
    const result = await templateService.updateTemplate(id, data);
    return result;
  } catch (error) {
    return rejectWithValue(error.response?.data || error.message);
  }
});

export const deleteTemplate = createAsyncThunk("templates/delete", async (id, { rejectWithValue }) => {
  try {
    await templateService.deleteTemplate(id);
    return id;
  } catch (error) {
    return rejectWithValue(error.response?.data || error.message);
  }
});

const templateSlice = createSlice({
  name: "templates",
  initialState: {
    list: [],
    selectedTemplate: null,
    loading: false,
    error: null,
  },
  reducers: {
    setSelectedTemplate: (state, action) => {
      state.selectedTemplate = action.payload;
    },
    clearSelectedTemplate: (state) => {
      state.selectedTemplate = null;
    },
    clearError: (state) => {
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    // Fetch templates
    builder
      .addCase(fetchTemplates.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchTemplates.fulfilled, (state, action) => {
        state.loading = false;
        state.list = action.payload;
      })
      .addCase(fetchTemplates.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      });

    // Fetch template by ID
    builder
      .addCase(fetchTemplateById.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchTemplateById.fulfilled, (state, action) => {
        state.loading = false;
        state.selectedTemplate = action.payload;
      })
      .addCase(fetchTemplateById.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      });

    // Create template
    builder
      .addCase(createTemplate.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(createTemplate.fulfilled, (state, action) => {
        state.loading = false;
        state.list.push(action.payload);
      })
      .addCase(createTemplate.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      });

    // Update template
    builder
      .addCase(updateTemplate.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(updateTemplate.fulfilled, (state, action) => {
        state.loading = false;
        const index = state.list.findIndex((tmpl) => tmpl.id === action.payload.id);
        if (index !== -1) {
          state.list[index] = action.payload;
        }
        if (state.selectedTemplate?.id === action.payload.id) {
          state.selectedTemplate = action.payload;
        }
      })
      .addCase(updateTemplate.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      });

    // Delete template
    builder
      .addCase(deleteTemplate.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(deleteTemplate.fulfilled, (state, action) => {
        state.loading = false;
        state.list = state.list.filter((tmpl) => tmpl.id !== action.payload);
        if (state.selectedTemplate?.id === action.payload) {
          state.selectedTemplate = null;
        }
      })
      .addCase(deleteTemplate.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      });
  },
});

export const { setSelectedTemplate, clearSelectedTemplate, clearError } = templateSlice.actions;

export default templateSlice.reducer;

// Selectors
export const selectAllTemplates = (state) => state.templates.list;
export const selectSelectedTemplate = (state) => state.templates.selectedTemplate;
export const selectTemplatesLoading = (state) => state.templates.loading;
export const selectTemplatesError = (state) => state.templates.error;

export const selectTemplateByStatusCode = (statusCode) => (state) => {
  return state.templates.list.find((tmpl) => tmpl.response_status === statusCode);
};
