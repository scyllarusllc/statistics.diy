#!/usr/bin/env bash
# Sourced by dev.sh; never stop a listener without an explicit yes.
ensure_dev_port() {
  local port=$1 variable=$2 listeners containers line id name ports answer pid
  local -a owners=() pids=()
  if [[ ! "$port" =~ ^[0-9]+$ ]] || ((10#$port < 1 || 10#$port > 65535)); then
    echo "Invalid $variable: $port (expected 1–65535)." >&2
    return 1
  fi
  if ! command -v ss >/dev/null && ! command -v lsof >/dev/null; then
    echo 'Port checks require ss (iproute2) or lsof.' >&2
    return 1
  fi
  if command -v ss >/dev/null; then
    listeners=$(ss -H -ltnp "sport = :$port")
    while IFS= read -r pid; do [[ -n "$pid" ]] && pids+=("$pid"); done < <(
      printf '%s\n' "$listeners" | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u)
  else
    listeners=$(lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)
    while IFS= read -r pid; do [[ -n "$pid" ]] && pids+=("$pid"); done < <(
      lsof -t -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | sort -u || true)
  fi
  containers=$(docker ps --format '{{.ID}}|{{.Names}}|{{.Ports}}')
  while IFS='|' read -r id name ports; do
    if [[ "$ports" =~ (^|,\ )(127\.0\.0\.1|0\.0\.0\.0|\[::\]):${port}-\> ]]; then
      owners+=("$id")
      listeners+=$'\n'"Container: $name ($id) — $ports"
    fi
  done <<< "$containers"
  [[ -z "$listeners" ]] && return 0
  printf '\nPort %s is already in use:\n%s\n' "$port" "$listeners" >&2
  printf 'Stop these listeners and continue? [y/N] ' >&2
  if ! read -r answer || [[ ! "$answer" =~ ^([yY]|[yY][eE][sS])$ ]]; then
    echo "Cancelled. Use $variable with a different port, or stop the listener yourself." >&2
    return 1
  fi
  if ((${#owners[@]})); then
    # Stop the owning container, not its docker-proxy process. Preserve volumes.
    docker stop "${owners[@]}" || return 1
  else
    if ((${#pids[@]} == 0)); then
      echo 'Cannot identify the process. Run with sufficient permissions or stop it manually.' >&2
      return 1
    fi
    kill -TERM "${pids[@]}" || return 1
  fi
  for _ in {1..20}; do
    if command -v ss >/dev/null; then
      listeners=$(ss -H -ltn "sport = :$port")
    else
      listeners=$(lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)
    fi
    [[ -z "$listeners" ]] && return 0
    sleep 0.5
  done
  echo "Port $port is still occupied. No forced kill was attempted." >&2
  return 1
}
