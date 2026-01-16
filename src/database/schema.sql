-- dProxy Database Schema
-- SQLite version (PostgreSQL compatible)
-- Version: 1.0.0

-- Enable foreign keys
PRAGMA foreign_keys = ON;

-- ============================================================================
-- USERS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL UNIQUE,          -- access id or email for user to login
    party_id TEXT UNIQUE,                  -- Internal party ID
    client_id TEXT,                        -- Member ID (e.g., REGRES001)
    email TEXT,
    first_name TEXT,
    last_name TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,  -- ISO 8601 format with timezone offset (e.g., 2025-12-15T10:30:00-05:00)
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP   -- ISO 8601 format with timezone offset (e.g., 2025-12-15T10:30:00-05:00)
);

CREATE INDEX IF NOT EXISTS idx_users_party_id ON users(party_id);
CREATE INDEX IF NOT EXISTS idx_users_client_id ON users(client_id);
CREATE INDEX IF NOT EXISTS idx_users_user_id ON users(user_id);

-- ============================================================================
-- SESSIONS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    p_session TEXT NOT NULL UNIQUE,        -- proxy session cookie value (uuid)
    u_session TEXT,                        -- user session cookie value from backend (latest value only)
    us_hash TEXT,                          -- JSON array of SHA256 hashes of all historical user sessions (for lookup)
    oauth_token TEXT,                      -- Bearer token (encrypted), latest value only
    oauth_hash TEXT,                       -- JSON array of SHA256 hashes of all historical JWT tokens (for lookup)
    device_id TEXT,
    app_platform TEXT,                     -- android, ios, etc
    app_version TEXT,                      -- App version (e.g., 6.9.0)
    app_environment TEXT,                  -- sit, stage, dev, prod, etc
    app_language TEXT,                     -- en, fr, etc
    expires_at DATETIME,  -- ISO 8601 format with timezone offset (e.g., 2025-12-15T10:30:00-05:00)
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,  -- ISO 8601 format with timezone offset (e.g., 2025-12-15T10:30:00-05:00)
    last_activity_at DATETIME DEFAULT CURRENT_TIMESTAMP,  -- ISO 8601 format with timezone offset (e.g., 2025-12-15T10:30:00-05:00)
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_p_session ON sessions(p_session);
CREATE INDEX IF NOT EXISTS idx_sessions_us_hash ON sessions(us_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_oauth_hash ON sessions(oauth_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_device_id ON sessions(device_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_active ON sessions(expires_at, user_id);

-- ============================================================================
-- API_REQUESTS TABLE
-- Used ONLY in RECORDING mode (write) and REPLAY mode (read)
-- Stores request in api_requests table with full headers and body for replay functionality
-- Stores response in api_responses table with full headers and body for replay functionality
-- ============================================================================
CREATE TABLE IF NOT EXISTS api_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,                       -- NULL for public endpoints
    host TEXT NOT NULL,                    -- Request host, e.g., http://www.google.com or https://jsonplaceholder.typicode.com
    endpoint_path TEXT NOT NULL,           -- Full URL path without query params, e.g., /pub/services/checkversion
    endpoint_name TEXT,                    -- Friendly name (checkversion, appConfig, etc.)
    method TEXT NOT NULL CHECK(method IN ('GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD', 'CONNECT')),
    endpoint_type TEXT,                    -- 'public' for public endpoints, 'secure' for secure endpoints
    query_params TEXT,                     -- JSON serialized
    request_headers TEXT NOT NULL,         -- JSON serialized
    request_body TEXT,                     -- JSON serialized
    app_platform TEXT,                     -- android, ios, etc
    app_version TEXT,                      -- App version (e.g., 6.9.0)
    app_environment TEXT,                  -- sit, stage, dev, prod, etc
    app_language TEXT,                     -- en, fr, etc
    correlation_id TEXT,                   -- x-correlation-id header for tracing
    traceability_id TEXT,                  -- x-traceability-id header for tracing
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,  -- ISO 8601 format with timezone offset (e.g., 2025-12-15T10:30:00-05:00)
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,  -- ISO 8601 format with timezone offset (e.g., 2025-12-15T10:30:00-05:00)
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Index for public endpoint queries (by version, env, platform, language)
-- Used in replay mode to find matching cached responses
CREATE INDEX IF NOT EXISTS idx_api_requests_public_lookup ON api_requests(
    method,
    endpoint_path, 
    app_version, 
    app_environment, 
    app_platform, 
    app_language,
    created_at DESC
) WHERE endpoint_type = 'public';

-- Index for public endpoint queries WITHOUT language (language-agnostic search)
-- Used when searching ignoring app_language for better performance
CREATE INDEX IF NOT EXISTS idx_api_requests_public_lookup_no_lang ON api_requests(
    method,
    endpoint_path, 
    app_version, 
    app_environment, 
    app_platform, 
    created_at DESC
) WHERE endpoint_type = 'public';

-- Index for secure endpoint queries (by user, endpoint, env, platform, language)
-- Ignores app_version for secure requests as per requirements
CREATE INDEX IF NOT EXISTS idx_api_requests_secure_lookup ON api_requests(
    user_id,
    method,
    endpoint_path,
    app_environment,
    app_platform,
    app_language,
    created_at DESC
) WHERE endpoint_type = 'secure';

-- Index for secure endpoint queries WITHOUT language (language-agnostic search)
-- Used when searching ignoring app_language for better performance
CREATE INDEX IF NOT EXISTS idx_api_requests_secure_lookup_no_lang ON api_requests(
    user_id,
    method,
    endpoint_path,
    app_environment,
    app_platform,
    created_at DESC
) WHERE endpoint_type = 'secure';

-- Index for cleanup operations (removing old records beyond retention limit)
CREATE INDEX IF NOT EXISTS idx_api_requests_cleanup ON api_requests(
    method,
    endpoint_path,
    app_version,
    app_environment,
    app_platform,
    app_language,
    user_id,
    created_at
);

-- General indexes for common queries
CREATE INDEX IF NOT EXISTS idx_api_requests_endpoint ON api_requests(endpoint_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_requests_user ON api_requests(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_requests_correlation ON api_requests(correlation_id);
-- Note: is_successful is in api_responses table, not api_requests

-- ============================================================================
-- API_RESPONSES TABLE
-- Used ONLY in RECORDING mode (write) and REPLAY mode (read)
-- Stores response data linked to api_requests via api_request_id
-- ============================================================================
CREATE TABLE IF NOT EXISTS api_responses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    api_request_id INTEGER NOT NULL,
    response_status INTEGER NOT NULL,
    response_headers TEXT NOT NULL DEFAULT '{}',  -- JSON serialized
    response_body TEXT,                          -- JSON, text, or NULL
    response_body_hash TEXT,                     -- SHA256 hash for deduplication
    response_source TEXT NOT NULL DEFAULT 'backend' CHECK(response_source IN ('backend', 'dproxy', 'custom')),
    is_successful BOOLEAN NOT NULL DEFAULT 0,  -- response_status >= 200 and < 300
    template_id INTEGER,                         -- Reference to dproxy_response_templates (for dproxy responses)
    latency_ms INTEGER,                          -- Response time in milliseconds
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (api_request_id) REFERENCES api_requests(id) ON DELETE CASCADE,
    FOREIGN KEY (template_id) REFERENCES dproxy_response_templates(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_api_responses_request_id ON api_responses(api_request_id);
CREATE INDEX IF NOT EXISTS idx_api_responses_status ON api_responses(response_status);
CREATE INDEX IF NOT EXISTS idx_api_responses_source ON api_responses(response_source);
CREATE INDEX IF NOT EXISTS idx_api_responses_template_id ON api_responses(template_id);
CREATE INDEX IF NOT EXISTS idx_api_responses_created_at ON api_responses(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_responses_is_successful ON api_responses(is_successful);

-- ============================================================================
-- DPROXY_RESPONSE_TEMPLATES TABLE
-- Templates for custom responses in REPLAY mode
-- ============================================================================
CREATE TABLE IF NOT EXISTS dproxy_response_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    response_status INTEGER NOT NULL UNIQUE,
    template_name TEXT NOT NULL,
    description TEXT,
    default_headers TEXT NOT NULL DEFAULT '{}',  -- JSON
    default_body TEXT,                            -- JSON template
    is_system_template BOOLEAN DEFAULT 1,         -- System templates cannot be deleted
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- STATS TABLE
-- Traffic statistics for PASSTHROUGH and RECORDING modes
-- Records individual request/response statistics for monitored traffic
-- Used for dashboard analytics and traffic monitoring
-- Note: api_requests and api_responses tables are ONLY used in RECORDING (write) and REPLAY (read) modes
-- ============================================================================
CREATE TABLE IF NOT EXISTS stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    host TEXT NOT NULL,                -- Hostname only, e.g. www.google.com or jsonplaceholder.typicode.com (no http:// or https://)
    endpoint_path TEXT NOT NULL,           -- e.g., /pub/services/checkversion (no query params)
    method TEXT NOT NULL CHECK(method IN ('GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD', 'CONNECT')),
    app_platform TEXT,                  -- android, ios
    app_version TEXT,                   -- e.g., 6.9.0
    app_environment TEXT,               -- sit, stage, dev, prod
    response_status INTEGER NOT NULL,
    response_length INTEGER NOT NULL,   -- response content length
    latency_ms INTEGER,                 -- Response time in milliseconds
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP  -- ISO 8601 format with timezone offset (e.g., 2025-12-15T10:30:00-05:00)
);

CREATE INDEX IF NOT EXISTS idx_stats_host ON stats(host);
CREATE INDEX IF NOT EXISTS idx_stats_endpoint ON stats(endpoint_path);
CREATE INDEX IF NOT EXISTS idx_stats_method ON stats(method);
CREATE INDEX IF NOT EXISTS idx_stats_platform ON stats(app_platform);
CREATE INDEX IF NOT EXISTS idx_stats_environment ON stats(app_environment);
CREATE INDEX IF NOT EXISTS idx_stats_status ON stats(response_status);
CREATE INDEX IF NOT EXISTS idx_stats_created_at ON stats(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stats_composite ON stats(host, endpoint_path, method, app_platform, app_environment, created_at DESC);

-- ============================================================================
-- ENDPOINT_MATCHING_CONFIG TABLE
-- Configuration for endpoint matching rules in REPLAY and RECORDING modes
-- Defines which dimensions (version, language, platform, environment) should be matched
-- ============================================================================
CREATE TABLE IF NOT EXISTS endpoint_matching_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    
    -- Endpoint identification
    endpoint_pattern TEXT NOT NULL, -- e.g., '/api/users/:id', '/api/products/*', '/pub/services-A/forceUpgrade'
    http_method TEXT NOT NULL CHECK(http_method IN ('GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD')),
    
    -- Matching rules for request (api_requests table)
    match_version BOOLEAN DEFAULT 0, -- Match app_version, 1 - exact match, 0 - closest match
    match_language BOOLEAN DEFAULT 0, -- Match app_language, 1 - exact match, 0 - exact match first then english then any other language
    match_platform BOOLEAN DEFAULT 0, -- Match app_platform, 1 - exact match, 0 - exact match first then any platform
    match_environment TEXT DEFAULT "exact", -- Match app_environment, "exact" - exact match, sit - match sit request, stage - match stage request, dev - match dev request, prod - match prod request
    match_headers TEXT, -- JSON array of header names to match (e.g., ["x-correlation-id", "x-traceability-id"]), default is empty array means no other headers to match
    match_query_params TEXT, -- JSON array of query params to match (e.g., ["userId", "deviceId"])
    match_body TEXT, -- JSON array of request body field paths to match (e.g., ["clientId", "memberId", "planNumber", "deviceLocale", "address.city"]), supports nested object access with dot notation (e.g., "a.b.c"), default is empty array means no body field to match
    
    -- Matching rules for response (api_responses table) - only used for REPLAY type
    match_response_status TEXT DEFAULT "2xx", -- Match response_status, "2xx" - match 2xx success response, "error" - match any error response, "404" - match 404 response, "500" - match 500 response, etc.

    -- Behavior
    priority INTEGER DEFAULT 0, -- Lower value = higher priority (matched first for overlapping patterns)
    enabled BOOLEAN DEFAULT 1, -- Whether this config is active
    
    -- Type: 'replay' for REPLAY mode rules, 'recording' for RECORDING mode rules
    type TEXT DEFAULT 'replay' CHECK(type IN ('replay', 'recording')),
    
    -- Timestamps
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,  -- ISO 8601 format with timezone offset (e.g., 2025-12-15T10:30:00-05:00)
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,  -- ISO 8601 format with timezone offset (e.g., 2025-12-15T10:30:00-05:00)
    
    -- Unique constraint: same endpoint pattern, method, and type can only have one config
    -- This allows both 'replay' and 'recording' type configs for the same endpoint/method pair
    UNIQUE(endpoint_pattern, http_method, type)
);
-- Indexes for endpoint_matching_config
CREATE INDEX IF NOT EXISTS idx_endpoint_config_pattern ON endpoint_matching_config(endpoint_pattern);
CREATE INDEX IF NOT EXISTS idx_endpoint_config_method ON endpoint_matching_config(http_method);
CREATE INDEX IF NOT EXISTS idx_endpoint_config_priority ON endpoint_matching_config(priority DESC);
CREATE INDEX IF NOT EXISTS idx_endpoint_config_enabled ON endpoint_matching_config(enabled);
CREATE INDEX IF NOT EXISTS idx_endpoint_config_type ON endpoint_matching_config(type);

-- Note: Trigger for updated_at is removed as SQLite doesn't support function calls in triggers
-- Application code must handle updated_at updates explicitly using getLocalISOString()


-- ============================================================================
-- CONFIG TABLE
-- Stores dProxy application settings with new structure
-- Each configuration type (master, log) is stored as a separate row with type and config (JSON) columns
-- Note: Only one row per type should exist, enforced by application logic
-- ============================================================================
CREATE TABLE IF NOT EXISTS config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,  -- Auto-generated primary key
    type TEXT NOT NULL UNIQUE,  -- Configuration type: 'master' (for proxy mode and timeWindow), 'log' (for logging configuration)
    config TEXT NULL,  -- JSON: configuration data, structure depends on type
    created_by TEXT,  -- User who created this config, nullable
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,  -- ISO 8601 format with timezone offset (e.g., 2025-12-15T10:30:00-05:00)
    updated_by TEXT,  -- User who last updated this config, nullable
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP   -- ISO 8601 format with timezone offset (e.g., 2025-12-15T10:30:00-05:00)
);
