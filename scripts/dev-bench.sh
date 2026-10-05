#!/usr/bin/env bash
set -Eeuo pipefail
# The host checkout can have a different owner from the container's frappe user.
git config --global --replace-all safe.directory /src/statistics_diy
WORKSPACE=${STATISTICS_DIY_DEV_WORKSPACE:-/workspace}
cd "$WORKSPACE"
if [[ ! -f bench/.initialized ]]; then
  if [[ -e bench ]]; then
    echo 'Resuming interrupted Bench initialization.'
    cd bench
    [[ -d apps/frappe && -x env/bin/python ]] || {
      echo 'Incomplete Bench initialization. Inspect /workspace/bench before retrying; no data was deleted.' >&2
      exit 1
    }
    bench setup requirements
    bench setup config
    bench build
    cd "$WORKSPACE"
  else
    bench init --frappe-branch version-16 --python /usr/local/bin/python3 bench
  fi
  touch bench/.initialized
fi
cd bench
bench set-config -g db_host db
# Site installation and asset builds can use Redis before bench start owns it.
redis-server config/redis_cache.conf --daemonize no &
CACHE_PID=$!
redis-server config/redis_queue.conf --daemonize no &
QUEUE_PID=$!
stop_setup_redis() {
  kill "$CACHE_PID" "$QUEUE_PID" 2>/dev/null || true
  wait "$CACHE_PID" "$QUEUE_PID" 2>/dev/null || true
}
trap stop_setup_redis EXIT
for attempt in {1..30}; do
  if redis-cli -p 13000 ping >/dev/null 2>&1 && redis-cli -p 11000 ping >/dev/null 2>&1; then
    break
  fi
  if [[ "$attempt" == 30 ]]; then
    echo 'Development Redis did not become ready.' >&2
    exit 1
  fi
  sleep 1
done
if [[ ! -e apps/statistics_diy ]]; then
  bench get-app --soft-link /src/statistics_diy
fi
if [[ ! -f "sites/$SITE_NAME/site_config.json" ]]; then
  bench new-site "$SITE_NAME" --db-host db --db-root-username root \
    --db-root-password "$DB_ROOT_PASSWORD" --admin-password "$ADMIN_PASSWORD" \
    --mariadb-user-host-login-scope='%'
fi
# install-app is safe to repeat and completes installation after interrupted setup.
bench --site "$SITE_NAME" install-app statistics_diy
bench --site "$SITE_NAME" set-config developer_mode 1
bench use "$SITE_NAME"
if [[ ! -f sites/.statistics-dev-ready ]]; then
  bench build --app statistics_diy
  touch sites/.statistics-dev-ready
fi
printf '\nDevelopment site: http://localhost:8000 (host port configurable)\nLogin: Administrator / %s\n' "$ADMIN_PASSWORD"
stop_setup_redis
trap - EXIT
exec bench start
