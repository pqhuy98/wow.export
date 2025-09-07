#!/usr/bin/env bash
set -euo pipefail

# Defaults (override via environment)
IMAGE_TAG="${IMAGE_TAG:-wow.export:latest}"
CONTAINER_NAME="${CONTAINER_NAME:-wow-export-test}"
HOST_PORT="${HOST_PORT:-17751}"
WAIT_SECONDS="${WAIT_SECONDS:-60}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="${WORKSPACE:-$(cd "${SCRIPT_DIR}/.." && pwd)}"  # path to wow.export subrepo

info() { echo "${1}"; }
die() { echo "ERROR: ${1}" >&2; exit "${2:-1}"; }

detect_runtime() {
  if command -v docker >/dev/null 2>&1; then
    RUNTIME=docker
  elif command -v podman >/dev/null 2>&1; then
    RUNTIME=podman
  else
    die "Neither docker nor podman is installed." 127
  fi
}

cleanup() {
  # Remove test container on exit (ignore errors)
  if [ -n "${CONTAINER_NAME:-}" ]; then
    if command -v "${RUNTIME:-docker}" >/dev/null 2>&1; then
      "${RUNTIME}" rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true
    else
      docker rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true
      podman rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true
    fi
  fi
}

is_port_in_use() {
  local port="$1"
  if command -v ss >/dev/null 2>&1; then
    ss -ltn "sport = :${port}" | tail -n +2 | grep -q . && return 0 || return 1
  elif command -v lsof >/dev/null 2>&1; then
    lsof -iTCP:"${port}" -sTCP:LISTEN >/dev/null 2>&1 && return 0 || return 1
  elif command -v netstat >/dev/null 2>&1; then
    netstat -tln 2>/dev/null | awk '{print $4}' | grep -E "[:\.]${port}$" -q && return 0 || return 1
  fi
  return 1
}

build_image() {
  info "[1/4] Building image ${IMAGE_TAG} with ${RUNTIME}..."
  "${RUNTIME}" build -f "${ROOT_DIR}/Dockerfile" -t "${IMAGE_TAG}" "${ROOT_DIR}" | cat
}

run_container() {
  info "[2/4] Running container ${CONTAINER_NAME} with ${RUNTIME}..."
  "${RUNTIME}" rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true

  local map_flag
  local use_random=0
  local desired="${HOST_PORT}"

  if [ "${desired}" = "0" ] || [ "${desired}" = "random" ] || [ "${desired}" = "auto" ]; then
    use_random=1
  elif is_port_in_use "${desired}"; then
    info "Port ${desired} is in use; using a random host port for testing."
    use_random=1
  fi

  if [ "${use_random}" = "1" ]; then
    map_flag="-p 17751"   # random host port -> container 17751
  else
    map_flag="-p ${desired}:17751"
  fi

  "${RUNTIME}" run -d --name "${CONTAINER_NAME}" ${map_flag} "${IMAGE_TAG}" | cat

  if [ "${use_random}" = "1" ]; then
    local port_line
    port_line=$("${RUNTIME}" port "${CONTAINER_NAME}" 17751/tcp | head -n1 || true)
    [ -n "${port_line}" ] || die "Failed to determine mapped host port for 17751/tcp"
    HOST_PORT="${port_line##*:}"
  fi
}

wait_for_rpc() {
  info "[3/4] Waiting for RPC on 127.0.0.1:${HOST_PORT}..."
  local i
  for i in $(seq 1 "${WAIT_SECONDS}"); do
    if python3 "${ROOT_DIR}/docker/healthcheck.py" --quiet --host 127.0.0.1 --port "${HOST_PORT}" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  die "RPC did not become ready within ${WAIT_SECONDS}s"
}

run_healthcheck() {
  info "[4/4] Running healthcheck..."
  python3 "${ROOT_DIR}/docker/healthcheck.py" --host 127.0.0.1 --port "${HOST_PORT}"
  info "SUCCESS: wow.export container is up and responding to RPC on port ${HOST_PORT}."
}

main() {
  case "${1:-}" in
    -h|--help)
      cat <<EOF
Usage: [ENV overrides] $(basename "$0")

ENV:
  IMAGE_TAG       Image tag to build/run (default: wow.export:latest)
  CONTAINER_NAME  Container name (default: wow-export-test)
  HOST_PORT       Host port, 0/random/auto for random mapping (default: 17751; auto-fallback if busy)
  WAIT_SECONDS    Seconds to wait for readiness (default: 60)
  WORKSPACE       Path to wow.export subrepo (default: script dir/..)
EOF
      exit 0
      ;;
  esac

  detect_runtime
  trap cleanup EXIT INT TERM
  build_image
  run_container
  wait_for_rpc
  run_healthcheck
}

main "$@"

