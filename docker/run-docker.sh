#!/usr/bin/env bash
set -euo pipefail

HOST_PORT="${WOWEXPORT_PORT:-17751}"
CONTAINER_NAME="${WOWEXPORT_NAME:-wow.export}"
ASSET_DIR_HOST="${WOWEXPORT_ASSET_DIR:-/tmp/wow.export}"
WOW_DIR_HOST="${WOWEXPORT_WOW_DIR:-}"
WAIT_SECONDS="${WAIT_SECONDS:-60}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

info() { echo "$1"; }
die() { echo "ERROR: $1" >&2; exit "${2:-1}"; }

mkdir -p ./exports
mkdir -p "${ASSET_DIR_HOST}"

# Remove stale NW.js singleton locks if present (safe when no process is using the profile)
for f in SingletonLock SingletonSocket SingletonCookie; do
  rm -f "${ASSET_DIR_HOST}/${f}" >/dev/null 2>&1 || true
done

# Remove any existing container with the same name to avoid port/name conflicts
docker rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true

# Optional mount if WOWEXPORT_WOW_DIR is provided

# Fixed port mapping to localhost only (never random)
MAP_FLAG=""

docker run -d --name "${CONTAINER_NAME}" --restart unless-stopped \
  -p 127.0.0.1:${HOST_PORT}:17751 \
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

# Wait for RPC to become ready, then run healthcheck
info "Waiting for RPC on 127.0.0.1:${HOST_PORT}..."
for i in $(seq 1 "${WAIT_SECONDS}"); do
  if python3 "${ROOT_DIR}/docker/helpers/healthcheck.py" --quiet --host 127.0.0.1 --port "${HOST_PORT}" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done

if [ "${ready:-0}" != "1" ]; then
  die "RPC did not become ready within ${WAIT_SECONDS}s"
fi

info "Running healthcheck..."
python3 "${ROOT_DIR}/docker/helpers/healthcheck.py" --host 127.0.0.1 --port "${HOST_PORT}"
info "Healthcheck OK. Selecting CASC..."
if ! WOWEXPORT_HOST=127.0.0.1 WOWEXPORT_PORT="${HOST_PORT}" python3 "${ROOT_DIR}/docker/helpers/select-casc.py"; then
  die "Failed to select CASC. Check env CASC_LOCAL_WOW/CASC_LOCAL_PRODUCT or CASC_REMOTE_REGION/CASC_REMOTE_PRODUCT."
fi
info "SUCCESS: wow.export container is ready with CASC loaded on port ${HOST_PORT}."