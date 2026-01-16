import { configureStore } from "@reduxjs/toolkit";
import endpointReducer from "./slices/endpointSlice";
import responseReducer from "./slices/responseSlice";
import templateReducer from "./slices/templateSlice";
import uiReducer from "./slices/uiSlice";
import configReducer from "./slices/configSlice";

const store = configureStore({
  reducer: {
    endpoints: endpointReducer,
    responses: responseReducer,
    templates: templateReducer,
    ui: uiReducer,
    config: configReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        // Ignore these action types
        ignoredActions: ["endpoints/setSelectedEndpoint"],
        // Ignore these field paths in all actions
        ignoredActionPaths: ["payload.timestamp"],
        // Ignore these paths in the state
        ignoredPaths: ["endpoints.selectedEndpoint"],
      },
    }),
});

export default store;
