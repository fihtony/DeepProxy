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

## Usage

### Configure Mobile App

Point your mobile app to Deep Proxy instead of real backend:

**Android (OkHttp):**

```java
String baseUrl = "http://localhost:8080/api/";
```

**iOS (Alamofire):**

```swift
let baseURL = "http://localhost:8080/api/"
```

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
tests/
  ├── integration/       # End-to-end tests
  └── unit/             # Unit tests
web/
  └── src/              # React Web UI dashboard
```

## API Overview

### Get Current Mode

```bash
GET /admin/mode
```

### Switch Mode

```bash
POST /admin/mode
Authorization: Bearer <ADMIN_API_KEY>
Content-Type: application/json

{"mode": "replay"}
```

### View Statistics

```bash
GET /admin/stats?start_date=2025-12-01&end_date=2025-12-10
```

## Testing

```bash
# Run all tests
npm test

# Run integration tests
npm run test:integration

# Watch mode for development
npm run test:watch
```

## Troubleshooting

```bash
# Update package.json to use better-sqlite3 >= 11.7.0, then:
npm install

# If you still see C++20 errors, set the compiler flag:
CXXFLAGS="-std=c++20" npm install
```

**Note**: If upgrading isn't possible, consider using Node.js v20 LTS which has broader compatibility with native modules.

**Mobile app can't reach proxy**

- Verify firewall allows port 8080
- Check mobile device is on same network or use `0.0.0.0` for HOST
- Confirm app is pointing to correct proxy URL

**Responses not caching**

- Check mode is set to `recording`
- Verify endpoint is configured for caching in Web UI
- Check logs for errors: `tail -f logs/dproxy.log`

**HTTPS issues**

- Set `ENABLE_HTTPS=true` in `.env`
- Ensure certificate files exist at `SSL_CERT_PATH` and `SSL_KEY_PATH`
- On iOS/Android, import proxy certificate as trusted

## License

Copyright (c) 2025 Tony XU <fihtony@gmail.com>

Licensed under the MIT License. See [LICENSE](LICENSE) file for details.
