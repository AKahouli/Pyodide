#!/bin/sh
# Runtime injection for the frontend image:
# 1) Replace MY_APP_* placeholders in built JS/HTML (API URL, feature flags, …).
# 2) Wire nginx /socket.io/ proxy to the YellowStorm back (app-runtime registry).

set -eu

for i in $(env | grep '^MY_APP_' || true)
do
    key=$(echo "$i" | cut -d '=' -f 1)
    value=$(echo "$i" | cut -d '=' -f 2-)
    find /usr/share/nginx/html -type f -exec sed -i "s|${key}|${value}|g" '{}' +
done

# Socket.IO upstream (required when the browser uses the front origin for sockets).
# Defaults match YellowStorm POC; override via compose env_file.
BACKEND_UPSTREAM="${MY_APP_BACKEND_UPSTREAM:-https://poc.back.yellowmind.ai}"
BACKEND_HOST="${MY_APP_BACKEND_HOST:-}"

if [ -z "$BACKEND_HOST" ]; then
  # Derive host from upstream URL (strip scheme + path).
  BACKEND_HOST=$(printf '%s' "$BACKEND_UPSTREAM" | sed -E 's|^https?://||; s|/.*$||')
fi

sed -i \
  -e "s|MY_APP_BACKEND_UPSTREAM|${BACKEND_UPSTREAM}|g" \
  -e "s|MY_APP_BACKEND_HOST|${BACKEND_HOST}|g" \
  /etc/nginx/conf.d/default.conf

echo "[env.sh] socket.io proxy → ${BACKEND_UPSTREAM} (Host: ${BACKEND_HOST})"
