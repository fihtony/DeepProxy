# Deep Proxy - a HTTP Proxy

A lightweight HTTP proxy system for mobile application development and testing. Sits between mobile apps and backend servers with three operational modes: **Recording** (cache responses), **Replay** (return cached), and **Passthrough** (forward only).

## Quick Features

- 🔴 **Recording Mode**: Forward requests to real servers, cache successful responses
- ▶️ **Replay Mode**: Return cached responses without calling backend (offline development)
- ➡️ **Passthrough Mode**: Forward all requests without caching
- **Smart Session Management**: Automatic user session and OAuth token handling
- **Web UI Dashboard**: Manage cache, view statistics, configure endpoints (http://localhost:3080)
- **Database-Driven Config**: All settings managed via Web UI, not configuration files
- **Security**: AES-256-GCM encryption, API key authentication, rate limiting

## Installation

### Prerequisites

- Node.js >= 18.0.0
- npm >= 9.0.0

### Setup

```bash
# Clone and install
git clone https://github.com/fihtony/DeepProxy.git
cd DeepProxy

# Install dependencies
npm install

# Copy environment configuration
cp .env.example .env

# Initialize database
npm run db:init
```

### Edit Configuration

Open `.env` and set required values:

- `ADMIN_API_KEY` - Admin API authentication
- `ENCRYPTION_KEY` - Data encryption (64 hex chars)
- `JWT_SECRET` - Web UI authentication
- Other settings (PORT, HOST, etc.) have sensible defaults

### Run Deep Proxy

```bash
# Development mode (with auto-reload)
npm run dev

# Production mode
npm start
```

Access the proxy at:

- **Proxy Server**: http://localhost:8080
- **Web UI Dashboard**: http://localhost:3080
- **Admin API**: http://localhost:8080/admin

### Run Web UI

The Web UI is a React application that provides a dashboard for managing the proxy. To run it:

```bash
# From the project root, run the web UI in development mode
npm run web:dev

# Or navigate to the web directory and run directly
cd web
npm install  # First time setup only
npm run dev
```

The Web UI will be available at http://localhost:3080. Make sure the proxy server is running on port 8080 for the Web UI to connect to the backend API.

To build the Web UI for production:

```bash
npm run web:build
```

## Usage


### Switch Modes

**Via Web UI** (Recommended):

1. Navigate to http://localhost:3080
2. Click mode toggle (Recording → Replay → Passthrough)

**Via API**:

```bash
curl -X POST http://localhost:8080/admin/mode \
  -H "Authorization: Bearer <ADMIN_API_KEY>" \
  -d '{"mode": "replay"}'
```

### Typical Workflow

1. **Recording Phase**: Set to `recording` mode
2. **Use Your App**: Perform normal testing with mobile app
3. **Review Cache**: Check Web UI to confirm responses were cached
4. **Switch to Replay**: Set mode to `replay` for offline testing
5. **Test Offline**: App works without backend connection
6. **Use Passthrough**: Route all traffic directly without caching

## Configuration

**Most settings are now database-driven** and managed via the Web UI:

- Traffic monitoring rules (which endpoints to cache)
- Field mapping (extract metadata from headers/responses)
- Session creation rules (where to capture user IDs)
- Endpoint matching patterns

Only essential infrastructure settings are in `.env`:

- Server ports and host
- Database location
- Security keys
- Logging configuration
- Web UI settings

## Directory Structure

```
src/
  ├── modes/               # Recording/Replay/Passthrough implementations
  ├── database/           # SQLite schema and initialization
  ├── config/            # Configuration management
  ├── services/          # Core business logic
  ├── utils/             # Session management, logging, utilities
  └── middleware/        # Authentication, validation, body capture
web/
  └── src/              # React Web UI dashboard
```


## License

Copyright (c) 2026 Tony Xu <fihtony@gmail.com>

Licensed under the MIT License. See [LICENSE](LICENSE) file for details.
