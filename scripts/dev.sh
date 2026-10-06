#!/usr/bin/env bash
set -Eeuo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
command -v docker >/dev/null 2>&1 || {
  echo 'Docker is required. Install Docker Engine or Docker Desktop with Compose v2.' >&2
  exit 1
}
docker compose version >/dev/null
docker info >/dev/null 2>&1 || {
  echo 'Cannot access Docker. Start Docker and ensure your user has permission to access its daemon.' >&2
  exit 1
}
compose() { docker compose -p statistics-diy-dev -f "$ROOT/deploy/dev.compose.yaml" "$@"; }
source "$ROOT/scripts/dev-ports.sh"
web_port=${STATISTICS_DIY_DEV_PORT:-8000}
socket_port=${STATISTICS_DIY_DEV_SOCKETIO_PORT:-9000}
if [[ "$web_port" == "$socket_port" ]]; then
  echo 'Web and Socket.IO host ports must be different.' >&2
  exit 1
fi
ensure_dev_port "$web_port" STATISTICS_DIY_DEV_PORT
ensure_dev_port "$socket_port" STATISTICS_DIY_DEV_SOCKETIO_PORT
compose build dev
compose up -d --wait db
# Run in the foreground so Ctrl+C reaches bench and its child processes.
exec docker compose -p statistics-diy-dev -f "$ROOT/deploy/dev.compose.yaml" run --rm --service-ports dev
