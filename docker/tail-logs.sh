#!/usr/bin/env bash
set -euo pipefail

# Tail wow.export logs safely for use by Cursor agent.
# - Shows last N lines by default to avoid large outputs
# - Optional bounded follow via --duration SECONDS

CONTAINER_NAME="${WOWEXPORT_NAME:-wow.export}"
TAIL_LINES=200
DURATION=0
PROFILE_LOG_PATH="/tmp/wow.profile/Default/runtime.log"
CONTAINER_ONLY=false

print_usage() {
  cat <<EOF
Usage: $(basename "$0") [options]

Options:
  --name NAME           Docker container name (default: ${CONTAINER_NAME})
  --lines N             Number of lines to show from each log (default: ${TAIL_LINES})
  --duration SECONDS    Follow logs for bounded duration; 0 means no follow (default: ${DURATION})
  --profile-log PATH    Path inside container to runtime log (default: ${PROFILE_LOG_PATH})
  --container           Show Docker container logs instead of runtime log
  -h, --help            Show this help

Notes:
  - Defaults are conservative to avoid overloading tool contexts.
  - By default, only the runtime log is printed.
  - With --container, only Docker container logs are printed.
  - When --duration > 0, the selected log stream is followed for SECONDS, then exit.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --name)
      CONTAINER_NAME="$2"; shift 2 ;;
    --lines)
      TAIL_LINES="$2"; shift 2 ;;
    --duration)
      DURATION="$2"; shift 2 ;;
    --profile-log)
      PROFILE_LOG_PATH="$2"; shift 2 ;;
    --container)
      CONTAINER_ONLY=true; shift 1 ;;
    -h|--help)
      print_usage; exit 0 ;;
    --)
      shift; break ;;
    *)
      echo "Unknown option: $1" >&2
      print_usage; exit 2 ;;
  esac
done

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || { echo "Missing required command: $1" >&2; exit 127; }
}

require_cmd docker

# Validate container exists
if ! docker ps -a --format '{{.Names}}' | grep -xq "${CONTAINER_NAME}"; then
  echo "Container not found: ${CONTAINER_NAME}" >&2
  exit 1
fi

FOLLOW_FLAG=""
USE_TIMEOUT=false
if [[ "${DURATION}" != "0" ]]; then
  FOLLOW_FLAG="-f"
  USE_TIMEOUT=true
  # timeout is generally available; if not, we proceed without bounded follow
  if ! command -v timeout >/dev/null 2>&1; then
    echo "warning: 'timeout' not found; falling back to non-follow mode" >&2
    FOLLOW_FLAG=""
    USE_TIMEOUT=false
  fi
fi

if [[ "${CONTAINER_ONLY}" == true ]]; then
  echo "=== [${CONTAINER_NAME}] docker logs — last ${TAIL_LINES} lines${FOLLOW_FLAG:+, bounded follow ${DURATION}s} ==="
  if [[ -n "${FOLLOW_FLAG}" && "${USE_TIMEOUT}" == true ]]; then
    timeout "${DURATION}" docker logs --tail "${TAIL_LINES}" ${FOLLOW_FLAG} "${CONTAINER_NAME}" || true
  else
    docker logs --tail "${TAIL_LINES}" "${CONTAINER_NAME}" || true
  fi
else
  echo "=== [${CONTAINER_NAME}] runtime log (${PROFILE_LOG_PATH}) — last ${TAIL_LINES} lines${FOLLOW_FLAG:+, bounded follow ${DURATION}s} ==="
  if docker exec "${CONTAINER_NAME}" sh -c "test -f '${PROFILE_LOG_PATH}'" >/dev/null 2>&1; then
    if [[ -n "${FOLLOW_FLAG}" && "${USE_TIMEOUT}" == true ]]; then
      timeout "${DURATION}" docker exec "${CONTAINER_NAME}" sh -lc "tail -n ${TAIL_LINES} ${FOLLOW_FLAG} '${PROFILE_LOG_PATH}'" || true
    else
      docker exec "${CONTAINER_NAME}" sh -lc "tail -n ${TAIL_LINES} '${PROFILE_LOG_PATH}'" || true
    fi
  else
    echo "(runtime log not found inside container)"
  fi
fi

echo
echo "Done. Consider increasing --lines or --duration if more context is needed."


