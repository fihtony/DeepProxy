import React, { useState, useEffect } from "react";
import { Provider, useDispatch } from "react-redux";
import { Routes, Route, Link as RouterLink, useNavigate } from "react-router-dom";
import {
  CssBaseline,
  ThemeProvider,
  createTheme,
  AppBar,
  Toolbar,
  Typography,
  Drawer,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  ListItemButton,
  Box,
  IconButton,
  Switch,
  FormControlLabel,
  RadioGroup,
  Radio,
  Divider,
  Alert,
  Snackbar,
} from "@mui/material";
import {
  Menu as MenuIcon,
  Dashboard as DashboardIcon,
  People as PeopleIcon,
  Public as PublicIcon,
  Lock as LockIcon,
  Settings as SettingsIcon,
  FiberManualRecord as RecordIcon,
  PlayArrow as PlayIcon,
  ManageAccounts as ManageIcon,
  Description as ResponseIcon,
} from "@mui/icons-material";

// Import Redux store
import store from "./store";

// Import pages
import Dashboard from "./pages/Dashboard";
import UserRequests from "./pages/UserRequests";
import PublicServices from "./pages/PublicServices";
import SecureServices from "./pages/SecureServices";
import Settings from "./pages/Settings";
import EndpointManagement from "./pages/EndpointManagement";
import ResponseManagement from "./pages/ResponseManagement";

// Import API
import { getMode, setMode } from "./services/api";
import { getEndpointConfig } from "./services/settingsService";
import { setEndpointConfig, setEndpointConfigError } from "./store/slices/configSlice";

const theme = createTheme({
  palette: {
    mode: "light",
    primary: {
      main: "#1976d2",
    },
    secondary: {
      main: "#dc004e",
    },
  },
});

const drawerWidth = 240;

function AppContent() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [currentMode, setCurrentMode] = useState("passthrough");
  const [loading, setLoading] = useState(true);
  const [snackbar, setSnackbar] = useState({ open: false, message: "", severity: "info" });
  const navigate = useNavigate();
  const dispatch = useDispatch();

  useEffect(() => {
    loadInitialData();
  }, []);

  const loadInitialData = async () => {
    try {
      // Load mode and endpoint config in parallel
      const [modeResponse, configResponse] = await Promise.all([
        getMode(),
        getEndpointConfig().catch((err) => {
          console.error("Failed to load endpoint config:", err);
          return null;
        }),
      ]);

      // Handle mode response
      const mode = modeResponse?.data?.mode || modeResponse?.mode || modeResponse?.currentMode || "passthrough";
      setCurrentMode(mode);

      // Handle endpoint config response
      if (configResponse) {
        // Extract the actual config data from the API response
        // API returns { success: true, data: { types, tags, fallback } }
        const actualConfig = configResponse?.data || configResponse;
        dispatch(setEndpointConfig(actualConfig));
      }
    } catch (error) {
      console.error("Failed to load initial data:", error);
      showSnackbar("Failed to load mode", "error");
      dispatch(setEndpointConfigError(error.message));
    } finally {
      setLoading(false);
    }
  };

  const handleModeChange = async (event) => {
    const newMode = event.target.value;
    try {
      await setMode(newMode);
      setCurrentMode(newMode);
      showSnackbar(`Mode switched to ${newMode}`, "success");
    } catch (error) {
      showSnackbar("Failed to switch mode", "error");
    }
  };

  const showSnackbar = (message, severity = "info") => {
    setSnackbar({ open: true, message, severity });
  };

  const handleDrawerToggle = () => {
    setMobileOpen(!mobileOpen);
  };

  const menuItems = [
    { text: "Dashboard", icon: <DashboardIcon />, path: "/" },
    { text: "Public Services", icon: <PublicIcon />, path: "/public-services" },
    { text: "Secure Services", icon: <LockIcon />, path: "/secure-services" },
    { text: "Endpoint Rules", icon: <ManageIcon />, path: "/endpoints" },
    { text: "Response Rules", icon: <ResponseIcon />, path: "/responses" },
    { text: "Settings", icon: <SettingsIcon />, path: "/settings" },
  ];

  const drawer = (
    <div>
      <Toolbar>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.2, width: "100%" }}>
          {/* Deep Proxy Logo */}
          <Box
            component="img"
            src="/icon.png"
            alt="Deep Proxy"
            sx={{
              width: 40,
              height: 40,
              flexShrink: 0,
              objectFit: "contain",
            }}
          />
          <Typography variant="h6" noWrap sx={{ fontWeight: 600, letterSpacing: "-0.5px" }}>
            Deep Proxy
          </Typography>
        </Box>
      </Toolbar>
      <Divider />
      <List>
        {menuItems.map((item) => (
          <ListItem key={item.text} disablePadding>
            <ListItemButton component={RouterLink} to={item.path}>
              <ListItemIcon>{item.icon}</ListItemIcon>
              <ListItemText primary={item.text} />
            </ListItemButton>
          </ListItem>
        ))}
      </List>
    </div>
  );

  return (
    <ThemeProvider theme={theme}>
      <Box sx={{ display: "flex" }}>
        <CssBaseline />

        {/* Mode Indicator Banner */}
        {currentMode !== "passthrough" && (
          <Box
            sx={{
              position: "fixed",
              top: 0,
              left: { sm: `${drawerWidth}px` },
              right: 0,
              backgroundColor: currentMode === "recording" ? "#b71c1c" : "#f57c00",
              color: "white",
              py: 0.3,
              px: 2,
              zIndex: (theme) => theme.zIndex.appBar + 1,
              textAlign: "center",
            }}
          >
            <Typography variant="body2" sx={{ fontWeight: "bold", fontSize: "0.75rem" }}>
              {currentMode === "recording"
                ? "🔴 RECORDING MODE - All requests are being captured"
                : "🟠 REPLAY MODE - Returning cached responses"}
            </Typography>
          </Box>
        )}

        <AppBar
          position="fixed"
          sx={{
            width: { sm: `calc(100% - ${drawerWidth}px)` },
            ml: { sm: `${drawerWidth}px` },
            top: currentMode !== "passthrough" ? "24px" : 0,
            transition: "top 0.3s ease",
            borderTop: "none",
          }}
        >
          <Toolbar>
            <IconButton color="inherit" edge="start" onClick={handleDrawerToggle} sx={{ mr: 2, display: { sm: "none" } }}>
              <MenuIcon />
            </IconButton>

            <Typography variant="h6" noWrap component="div" sx={{ flexGrow: 1 }}>
              Deep Proxy Management
            </Typography>

            <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
              <RadioGroup
                row
                value={currentMode}
                onChange={handleModeChange}
                disabled={loading}
                sx={{
                  "& .MuiFormControlLabel-root": {
                    m: 0,
                    mr: 1.5,
                  },
                  "& .MuiFormControlLabel-label": {
                    fontSize: "0.9rem",
                    fontWeight: 500,
                  },
                }}
              >
                <FormControlLabel
                  value="passthrough"
                  control={
                    <Radio
                      size="small"
                      sx={{
                        color: currentMode === "passthrough" ? "#4CAF50" : "rgba(255,255,255,0.5)",
                        "&.Mui-checked": {
                          color: "#4CAF50",
                        },
                      }}
                    />
                  }
                  label="Passthrough"
                  sx={{
                    color: currentMode === "passthrough" ? "#4CAF50" : "white",
                    fontWeight: currentMode === "passthrough" ? 700 : 400,
                    transition: "all 0.3s",
                  }}
                />
                <FormControlLabel
                  value="recording"
                  control={
                    <Radio
                      size="small"
                      sx={{
                        color: currentMode === "recording" ? "#f44336" : "rgba(255,255,255,0.5)",
                        "&.Mui-checked": {
                          color: "#f44336",
                        },
                      }}
                    />
                  }
                  label="Recording"
                  sx={{
                    color: currentMode === "recording" ? "#f44336" : "white",
                    fontWeight: currentMode === "recording" ? 700 : 400,
                    transition: "all 0.3s",
                  }}
                />
                <FormControlLabel
                  value="replay"
                  control={
                    <Radio
                      size="small"
                      sx={{
                        color: currentMode === "replay" ? "#FF9800" : "rgba(255,255,255,0.5)",
                        "&.Mui-checked": {
                          color: "#FF9800",
                        },
                      }}
                    />
                  }
                  label="Replay"
                  sx={{
                    color: currentMode === "replay" ? "#FF9800" : "white",
                    fontWeight: currentMode === "replay" ? 700 : 400,
                    transition: "all 0.3s",
                  }}
                />
              </RadioGroup>
            </Box>
          </Toolbar>
        </AppBar>

        <Box component="nav" sx={{ width: { sm: drawerWidth }, flexShrink: { sm: 0 } }}>
          <Drawer
            variant="temporary"
            open={mobileOpen}
            onClose={handleDrawerToggle}
            ModalProps={{ keepMounted: true }}
            sx={{
              display: { xs: "block", sm: "none" },
              "& .MuiDrawer-paper": { boxSizing: "border-box", width: drawerWidth },
            }}
          >
            {drawer}
          </Drawer>
          <Drawer
            variant="permanent"
            sx={{
              display: { xs: "none", sm: "block" },
              "& .MuiDrawer-paper": { boxSizing: "border-box", width: drawerWidth },
            }}
            open
          >
            {drawer}
          </Drawer>
        </Box>

        <Box
          component="main"
          sx={{
            flexGrow: 1,
            p: 3,
            width: { sm: `calc(100% - ${drawerWidth}px)` },
            mt: currentMode !== "passthrough" ? "24px" : 0,
            transition: "margin-top 0.3s ease",
          }}
        >
          <Toolbar />
          <Routes>
            <Route path="/" element={<Dashboard mode={currentMode} />} />
            <Route path="/endpoints" element={<EndpointManagement />} />
            <Route path="/responses" element={<ResponseManagement />} />
            <Route path="/users" element={<UserRequests />} />
            <Route path="/public-services" element={<PublicServices />} />
            <Route path="/secure-services" element={<SecureServices />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </Box>

        <Snackbar open={snackbar.open} autoHideDuration={6000} onClose={() => setSnackbar({ ...snackbar, open: false })}>
          <Alert onClose={() => setSnackbar({ ...snackbar, open: false })} severity={snackbar.severity} sx={{ width: "100%" }}>
            {snackbar.message}
          </Alert>
        </Snackbar>
      </Box>
    </ThemeProvider>
  );
}

// Wrap with Redux Provider
function App() {
  return (
    <Provider store={store}>
      <AppContent />
    </Provider>
  );
}

export default App;
