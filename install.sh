#!/usr/bin/env bash
# Install a dedicated Frappe + Statistics DIY stack. Requires Docker Compose v2.
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
DOCKER_REF=f71a386bc13f75dcc0cf7462f025f531576a04fc
case "$INSTALL_DIR" in /*) ;; *) fail 'STATISTICS_DIY_DIR must be an absolute path.' ;; esac
[[ "$APP_REF" =~ ^[A-Za-z0-9._-]+$ ]] || fail 'STATISTICS_DIY_REF must be a branch, tag, or commit without slashes.'
mkdir -p "$INSTALL_DIR"
mkdir "$INSTALL_DIR/.install-lock" 2>/dev/null || fail "Another installation may be running. If it stopped, remove $INSTALL_DIR/.install-lock and retry."
TEMP_DIR=$(mktemp -d)
cleanup() { rm -rf "$TEMP_DIR"; rmdir "$INSTALL_DIR/.install-lock"; }
trap cleanup EXIT

if [[ ! -f "$INSTALL_DIR/.env" ]]; then
  if [[ -n "$(ls -A "$INSTALL_DIR" | sed '/^\.install-lock$/d')" ]]; then
    fail 'The installation directory is not empty. Choose a new STATISTICS_DIY_DIR.'
  fi
  HTTP_PORT=${STATISTICS_DIY_PORT:-8080}
  [[ "$HTTP_PORT" =~ ^[0-9]{1,5}$ ]] || fail 'STATISTICS_DIY_PORT must be a port number.'
  HTTP_PORT=$((10#$HTTP_PORT))
  (( HTTP_PORT >= 1024 && HTTP_PORT <= 65535 )) || fail 'Choose a port between 1024 and 65535.'
  DB_PASSWORD=$(openssl rand -hex 24)
  ADMIN_PASSWORD=$(openssl rand -hex 16)
  cat > "$TEMP_DIR/env" <<EOF
COMPOSE_PROJECT_NAME=statistics-diy
CUSTOM_IMAGE=statistics-diy/frappe
CUSTOM_TAG=local
PULL_POLICY=never
DB_PASSWORD=$DB_PASSWORD
ADMIN_PASSWORD=$ADMIN_PASSWORD
SITE_NAME=statistics.localhost
HTTP_PORT=$HTTP_PORT
EOF
  mv "$TEMP_DIR/env" "$INSTALL_DIR/.env"
else
  printf 'Resuming installation with existing credentials and settings.\n'
fi

printf 'Downloading Statistics DIY and the pinned official Frappe Docker build files…\n'
curl -fsSL --retry 3 "https://github.com/scyllarusllc/statistics.diy/archive/$APP_REF.tar.gz" -o "$TEMP_DIR/app.tar.gz"
mkdir "$TEMP_DIR/app"
tar -xzf "$TEMP_DIR/app.tar.gz" -C "$TEMP_DIR/app" --strip-components=1
[[ -f "$TEMP_DIR/app/deploy/compose.yaml" ]] || fail 'This revision does not contain deployment files.'
cp "$TEMP_DIR/app/deploy/compose.yaml" "$INSTALL_DIR/compose.yaml"
curl -fsSL --retry 3 "https://github.com/frappe/frappe_docker/archive/$DOCKER_REF.tar.gz" -o "$TEMP_DIR/docker.tar.gz"
mkdir "$TEMP_DIR/frappe-docker"
tar -xzf "$TEMP_DIR/docker.tar.gz" -C "$TEMP_DIR/frappe-docker" --strip-components=1
printf '[{"url":"https://github.com/scyllarusllc/statistics.diy","branch":"%s"}]\n' "$APP_REF" > "$TEMP_DIR/apps.json"

printf 'Building Frappe version-16 with Statistics DIY. The first build may take several minutes…\n'
docker build --file "$TEMP_DIR/frappe-docker/images/custom/Containerfile" \
  --build-arg FRAPPE_BRANCH=version-16 \
  --build-arg "CACHE_BUST=$(openssl rand -hex 8)" \
  --secret "id=apps_json,src=$TEMP_DIR/apps.json" \
  --tag statistics-diy/frappe:local "$TEMP_DIR/frappe-docker"

cd "$INSTALL_DIR"
compose() { docker compose --env-file .env --file compose.yaml "$@"; }
compose config --quiet
compose up --detach db redis-cache redis-queue
compose run --rm configurator
compose run --rm create-site
compose up --detach backend frontend websocket queue-short queue-long scheduler
compose exec -T backend bench --site statistics.localhost list-apps

HTTP_PORT=$(sed -n 's/^HTTP_PORT=//p' .env)
printf 'Waiting for the login page…\n'
ready=false
for attempt in {1..60}; do
  if curl -fsS --max-time 5 "http://127.0.0.1:$HTTP_PORT/login" >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 2
done
[[ "$ready" == true ]] || fail "Services started but the login page is not ready. Run: cd \"$INSTALL_DIR\" && docker compose logs --tail=100"
printf '\nInstalled Frappe and Statistics DIY.\nOpen: http://localhost:%s\nLogin: Administrator\nPassword: ADMIN_PASSWORD in %s/.env\n\n' "$HTTP_PORT" "$INSTALL_DIR"
printf 'Manage services: cd "%s" && docker compose ps\n' "$INSTALL_DIR"
printf 'The app currently provides a skeleton; analytics features are under development.\n'
