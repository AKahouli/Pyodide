#!/bin/sh
set -e

# =============================================================================
# YellowStorm Frontend Runtime Initialization
# =============================================================================
# Writes window.__APP_CONFIG__ to /config.js from container environment.
#
#   VITE_API_URL          — public REST base URL (include /api/v1)
#   VITE_SOCKET_BASE_URL  — optional Socket.IO origin override
# =============================================================================

TARGET_DIR="/usr/share/nginx/html"
CONFIG_FILE="${TARGET_DIR}/config.js"

RESOLVED_API_URL="${VITE_API_URL:-}"
RESOLVED_SOCKET_URL="${VITE_SOCKET_BASE_URL:-}"

RESOLVED_API_URL=$(echo "$RESOLVED_API_URL" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's|/*$||')
RESOLVED_SOCKET_URL=$(echo "$RESOLVED_SOCKET_URL" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's|/*$||')

echo "==> YellowStorm Frontend Runtime Config"
if [ -n "$RESOLVED_API_URL" ]; then
    echo "    VITE_API_URL:         $RESOLVED_API_URL"
else
    echo "    VITE_API_URL:         (not configured - app will warn in console and UI)"
fi

if [ -n "$RESOLVED_SOCKET_URL" ]; then
    echo "    VITE_SOCKET_BASE_URL: $RESOLVED_SOCKET_URL"
fi

if [ -d "$TARGET_DIR" ]; then
    cat <<EOF > "${CONFIG_FILE}.tmp"
window.__APP_CONFIG__ = {
  API_URL: "${RESOLVED_API_URL}",
  SOCKET_BASE_URL: "${RESOLVED_SOCKET_URL}"
};
EOF
    mv -f "${CONFIG_FILE}.tmp" "$CONFIG_FILE" 2>/dev/null || cat "${CONFIG_FILE}.tmp" > "$CONFIG_FILE"
    chmod 644 "$CONFIG_FILE" 2>/dev/null || true
    echo "    Generated:            ${CONFIG_FILE}"
fi

if [ -z "$RESOLVED_API_URL" ]; then
    echo "env.sh: WARNING No API URL configured. Set VITE_API_URL on the container."
fi

echo "==> Runtime initialization complete"
