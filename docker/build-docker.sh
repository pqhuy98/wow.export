#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="${WORKSPACE:-$(cd "${SCRIPT_DIR}/.." && pwd)}"  # wow.export subrepo

docker build -f "${ROOT_DIR}/Dockerfile" -t wow.export:latest "${ROOT_DIR}"