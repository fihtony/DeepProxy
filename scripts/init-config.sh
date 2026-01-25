#!/bin/bash

#
# dProxy Configuration Initialization Script
#
# This script initializes the configuration for dProxy by calling the settings APIs.
# Run this script after starting dProxy to configure traffic monitoring, field mapping,
# and endpoint type classification.
#
# Usage:
#   ./scripts/init-config.sh [base_url]
#
# Examples:
#   ./scripts/init-config.sh                    # Uses default http://localhost:8080
#   ./scripts/init-config.sh http://localhost:9000
#

set -e

# Configuration
BASE_URL="${1:-http://localhost:8080}"
API_BASE="${BASE_URL}/api/v1/settings"

echo "=============================================="
echo "dProxy Configuration Initialization"
echo "=============================================="
echo "API Base URL: ${API_BASE}"
echo ""

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    if [ "$1" = "success" ]; then
        echo -e "${GREEN}✓ $2${NC}"
    elif [ "$1" = "error" ]; then
        echo -e "${RED}✗ $2${NC}"
    else
        echo -e "${YELLOW}➤ $2${NC}"
    fi
}

# Check if curl is available
if ! command -v curl &> /dev/null; then
    print_status error "curl is required but not installed"
    exit 1
fi

# Check if server is running
print_status info "Checking if dProxy server is running..."
if ! curl -s "${BASE_URL}/api/v1/health" > /dev/null 2>&1; then
    print_status error "Cannot connect to dProxy at ${BASE_URL}"
    print_status info "Please ensure the server is running: npm start"
    exit 1
fi
print_status success "Server is running"

echo ""
echo "----------------------------------------------"
echo "1. Configuring Traffic Monitor"
echo "----------------------------------------------"

# Traffic configuration
# Modify these values to match your application's traffic patterns
TRAFFIC_CONFIG='{
  "monitor": {
    "from": "header",
    "key": "user-agent",
    "pattern": "MyApp/"
  },
  "domains": [
    { "protocol": "https", "domain": "api.example.com" },
    { "protocol": "https", "domain": "auth.example.com" }
  ]
}'

print_status info "Setting traffic config..."
RESPONSE=$(curl -s -w "\n%{http_code}" -X PUT "${API_BASE}/traffic" \
    -H "Content-Type: application/json" \
    -d "${TRAFFIC_CONFIG}")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "200" ]; then
    print_status success "Traffic config saved"
else
    print_status error "Failed to save traffic config (HTTP ${HTTP_CODE})"
    echo "$BODY"
fi

echo ""
echo "----------------------------------------------"
echo "2. Configuring Field Mapping"
echo "----------------------------------------------"

# Field mapping configuration
# Maps request headers/query params to database fields
MAPPING_CONFIG='{
  "app_version": { "from": "header", "key": "x-app-version", "pattern": null },
  "app_platform": { "from": "header", "key": "x-platform", "pattern": null },
  "app_environment": { "from": "header", "key": "x-environment", "pattern": null },
  "app_language": { "from": "header", "key": "accept-language", "pattern": null },
  "correlation_id": { "from": "header", "key": "x-correlation-id", "pattern": null },
  "traceability_id": { "from": "header", "key": "x-traceability-id", "pattern": null }
}'

print_status info "Setting field mapping config..."
RESPONSE=$(curl -s -w "\n%{http_code}" -X PUT "${API_BASE}/mapping" \
    -H "Content-Type: application/json" \
    -d "${MAPPING_CONFIG}")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "200" ]; then
    print_status success "Field mapping config saved"
else
    print_status error "Failed to save field mapping config (HTTP ${HTTP_CODE})"
    echo "$BODY"
fi

echo ""
echo "----------------------------------------------"
echo "3. Configuring Endpoint Types"
echo "----------------------------------------------"

# Endpoint type configuration
# Defines rules for classifying endpoints as secure/public/custom types
ENDPOINT_CONFIG='{
  "types": [
    {
      "name": "secure",
      "patterns": ["/sec/", "/auth/", "/private/", "/api/secure/"],
      "priority": 0
    },
    {
      "name": "public",
      "patterns": ["/pub/", "/public/", "/api/public/"],
      "priority": 1
    }
  ],
  "tags": [
    { "name": "auth", "pattern": "/auth/", "color": "#9c27b0" },
    { "name": "user", "pattern": "/user", "color": "#2196f3" },
    { "name": "admin", "pattern": "/admin/", "color": "#f44336" }
  ],
  "fallback": "public"
}'

print_status info "Setting endpoint type config..."
RESPONSE=$(curl -s -w "\n%{http_code}" -X PUT "${API_BASE}/endpoint" \
    -H "Content-Type: application/json" \
    -d "${ENDPOINT_CONFIG}")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "200" ]; then
    print_status success "Endpoint type config saved"
else
    print_status error "Failed to save endpoint type config (HTTP ${HTTP_CODE})"
    echo "$BODY"
fi

echo ""
echo "=============================================="
echo "Configuration Complete"
echo "=============================================="
echo ""
print_status info "You can verify the configuration at:"
echo "  - Traffic:   GET ${API_BASE}/traffic"
echo "  - Mapping:   GET ${API_BASE}/mapping"
echo "  - Endpoints: GET ${API_BASE}/endpoint"
echo ""
print_status info "To test endpoint classification:"
echo "  curl '${API_BASE}/endpoint/test?path=/sec/users'"
echo ""
