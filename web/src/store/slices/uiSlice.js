import { createSlice } from "@reduxjs/toolkit";

const uiSlice = createSlice({
  name: "ui",
  initialState: {
    sidebarOpen: true,
    currentMode: "passthrough", // 'passthrough', 'recording', 'replay'
    notifications: [],
    dialogs: {
      confirmDelete: {
        open: false,
        type: null, // 'endpoint', 'response', 'template'
        id: null,
      },
      editResponse: {
        open: false,
        responseId: null,
      },
      matchingDebug: {
        open: false,
        endpointId: null,
      },
    },
    theme: "light", // 'light' or 'dark'
  },
  reducers: {
    toggleSidebar: (state) => {
      state.sidebarOpen = !state.sidebarOpen;
    },
    setSidebarOpen: (state, action) => {
      state.sidebarOpen = action.payload;
    },
    setCurrentMode: (state, action) => {
      state.currentMode = action.payload;
    },
    addNotification: (state, action) => {
      const notification = {
        id: Date.now(),
        message: action.payload.message,
        type: action.payload.type || "info", // 'info', 'success', 'warning', 'error'
        duration: action.payload.duration || 5000,
      };
      state.notifications.push(notification);
    },
    removeNotification: (state, action) => {
      state.notifications = state.notifications.filter((notif) => notif.id !== action.payload);
    },
    clearNotifications: (state) => {
      state.notifications = [];
    },
    openDialog: (state, action) => {
      const { dialogName, data } = action.payload;
      if (state.dialogs[dialogName]) {
        state.dialogs[dialogName] = { ...state.dialogs[dialogName], open: true, ...data };
      }
    },
    closeDialog: (state, action) => {
      const dialogName = action.payload;
      if (state.dialogs[dialogName]) {
        state.dialogs[dialogName] = { ...state.dialogs[dialogName], open: false };
      }
    },
    closeAllDialogs: (state) => {
      Object.keys(state.dialogs).forEach((key) => {
        state.dialogs[key].open = false;
      });
    },
    setTheme: (state, action) => {
      state.theme = action.payload;
    },
    toggleTheme: (state) => {
      state.theme = state.theme === "light" ? "dark" : "light";
    },
  },
});

export const {
  toggleSidebar,
  setSidebarOpen,
  setCurrentMode,
  addNotification,
  removeNotification,
  clearNotifications,
  openDialog,
  closeDialog,
  closeAllDialogs,
  setTheme,
  toggleTheme,
} = uiSlice.actions;

export default uiSlice.reducer;

// Selectors
export const selectSidebarOpen = (state) => state.ui.sidebarOpen;
export const selectCurrentMode = (state) => state.ui.currentMode;
export const selectNotifications = (state) => state.ui.notifications;
export const selectDialogs = (state) => state.ui.dialogs;
export const selectTheme = (state) => state.ui.theme;
