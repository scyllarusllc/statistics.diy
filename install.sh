#!/usr/bin/env bash
# Install a dedicated Statistics DIY stack (Node.js + SQLite). Requires Docker Compose v2.
set -Eeuo pipefail
umask 077

fail() { printf 'Error: %s\n' "$*" >&2; exit 1; }
trap 'printf "Installation stopped at line %s. Data and credentials are preserved; rerun to retry.\n" "$LINENO" >&2' ERR

for dependency in curl tar openssl docker; do
  command -v "$dependency" >/dev/null 2>&1 || fail "Missing $dependency. Install Docker Engine + Compose v2 (Linux), or Docker Desktop (macOS), and curl/tar/openssl first."
done
docker compose version >/dev/null 2>&1 || fail 'Docker Compose v2 is required.'
docker info >/dev/null 2>&1 || fail 'Docker is not running or your user cannot access it.'

INSTALL_DIR=${STATISTICS_DIY_DIR:-"$HOME/.local/share/statistics-diy"}
APP_REF=${STATISTICS_DIY_REF:-main}
case "$INSTALL_DIR" in /*) ;; *) fail 'STATISTICS_DIY_DIR must be an absolute path.' ;; esac
[[ "$APP_REF" =~ ^[A-Za-z0-9._-]+$ ]] || fail 'STATISTICS_DIY_REF must be a branch, tag, or commit without slashes.'
mkdir -p "$INSTALL_DIR"
mkdir "$INSTALL_DIR/.install-lock" 2>/dev/null || fail "Another installation may be running. If it stopped, remove $INSTALL_DIR/.install-lock and retry."
TEMP_DIR=$(mktemp -d)
cleanup() { rm -rf "$TEMP_DIR"; rmdir "$INSTALL_DIR/.install-lock"; }
trap cleanup EXIT

printf 'Downloading Statistics DIY…\n'
curl -fsSL --retry 3 "https://github.com/scyllarusllc/statistics.diy/archive/$APP_REF.tar.gz" -o "$TEMP_DIR/app.tar.gz"
mkdir "$TEMP_DIR/app"
tar -xzf "$TEMP_DIR/app.tar.gz" -C "$TEMP_DIR/app" --strip-components=1
[[ -f "$TEMP_DIR/app/Dockerfile" && -f "$TEMP_DIR/app/compose.yaml" ]] || fail 'This revision does not contain deployment files.'

printf 'Building the image…\n'
docker build --tag statistics-diy:local "$TEMP_DIR/app"

if [[ ! -f "$INSTALL_DIR/.env" ]]; then
  if [[ -n "$(ls -A "$INSTALL_DIR" | sed '/^\.install-lock$/d')" ]]; then
    fail 'The installation directory is not empty. Choose a new STATISTICS_DIY_DIR.'
  fi
  HTTP_PORT=${STATISTICS_DIY_PORT:-8090}
  [[ "$HTTP_PORT" =~ ^[0-9]{1,5}$ ]] || fail 'STATISTICS_DIY_PORT must be a port number.'
  HTTP_PORT=$((10#$HTTP_PORT))
  (( HTTP_PORT >= 1024 && HTTP_PORT <= 65535 )) || fail 'Choose a port between 1024 and 65535.'
  ADMIN_PASSWORD=$(openssl rand -hex 16)
  ADMIN_PASSWORD_HASH=$(printf '%s' "$ADMIN_PASSWORD" | docker run --rm -i statistics-diy:local node scripts/hash-password.mjs)
  # Single-quoted so the $ separators in the hash survive Compose interpolation.
  cat > "$TEMP_DIR/env" <<EOF
HTTP_PORT=$HTTP_PORT
APP_ORIGIN=http://localhost:$HTTP_PORT
ADMIN_USERNAME=Administrator
ADMIN_PASSWORD=$ADMIN_PASSWORD
ADMIN_PASSWORD_HASH=$(printf '%s' "$ADMIN_PASSWORD_HASH" | sed 's/\$/$$/g')
EOF
  mv "$TEMP_DIR/env" "$INSTALL_DIR/.env"
else
  printf 'Resuming installation with existing credentials and settings.\n'
fi
cp "$TEMP_DIR/app/compose.yaml" "$INSTALL_DIR/compose.yaml"

cd "$INSTALL_DIR"
docker compose --env-file .env --file compose.yaml config --quiet
docker compose --env-file .env --file compose.yaml up --detach

HTTP_PORT=$(sed -n 's/^HTTP_PORT=//p' .env)
printf 'Waiting for Statistics DIY…\n'
ready=false
for attempt in {1..30}; do
  if curl -fsS --max-time 5 "http://127.0.0.1:$HTTP_PORT/api/health" >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 2
done
[[ "$ready" == true ]] || fail "The service started but is not healthy. Run: cd \"$INSTALL_DIR\" && docker compose logs --tail=100"
printf '\nInstalled Statistics DIY.\nOpen: http://localhost:%s\nLogin: Administrator\nPassword: ADMIN_PASSWORD in %s/.env\n\n' "$HTTP_PORT" "$INSTALL_DIR"
printf 'Manage services: cd "%s" && docker compose ps\n' "$INSTALL_DIR"
printf 'Migrating from the old Frappe version? See "Migrating from Frappe" in the README.\n'
