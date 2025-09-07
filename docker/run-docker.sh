#!/usr/bin/env bash
set -euo pipefail

HOST_PORT="${WOWEXPORT_PORT:-17751}"
CONTAINER_NAME="${WOWEXPORT_NAME:-wow.export}"
ASSET_DIR_HOST="${WOWEXPORT_ASSET_DIR:-/tmp/wow.export}"
WOW_DIR_HOST="${WOWEXPORT_WOW_DIR:-}"

mkdir -p ./exports
mkdir -p "${ASSET_DIR_HOST}"

# Remove stale NW.js singleton locks if present (safe when no process is using the profile)
for f in SingletonLock SingletonSocket SingletonCookie; do
  rm -f "${ASSET_DIR_HOST}/${f}" >/dev/null 2>&1 || true
done

# Remove any existing container with the same name to avoid port/name conflicts
docker rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true

# Fixed port mapping to localhost only (never random)
MAP_FLAG=""

docker run -d --name "${CONTAINER_NAME}" --restart unless-stopped \
  -p 127.0.0.1:${HOST_PORT}:${HOST_PORT} \
  -e DISPLAY=:99 \
  -e DBUS_SESSION_BUS_ADDRESS=/dev/null \
  -w /exports \
  -u $(id -u):$(id -g) \
  -v "$(pwd)/exports:/exports" \
  -v "${ASSET_DIR_HOST}:${ASSET_DIR_HOST}" \
  ${WOW_DIR_HOST:+-v "${WOW_DIR_HOST}:${WOW_DIR_HOST}:ro"} \
  wow.export:latest \
  --user-data-dir=/tmp/wow.profile

echo "WOWEXPORT_HOST_PORT=${HOST_PORT}"