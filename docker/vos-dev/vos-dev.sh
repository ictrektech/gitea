#!/usr/bin/env bash
# docker/vos-dev/vos-dev.sh — live debugging inside VOS without pushing an image.
#
# Starts a dev container that mounts this source tree, rebuilds the backend with air and serves
# frontend assets from the vite dev server through Gitea itself. A temporary Traefik route sends
# /app/com.ictrek.gitea to the dev container; the installed app keeps running untouched.
#
# Usage:
#   make vos-dev             # start, follow logs, Ctrl-C cleans up
#   make vos-dev-down        # stop the container and remove the route
#   make vos-dev-logs        # follow logs
#   make vos-dev-status      # container, health and route state
#
# The dev instance keeps its own config and app data, because queues are locked exclusively, and
# reads the installed repositories in place. Only the database is shared, through the copied secrets.
#
# Overrides:
#   VOS_DEV_PORT(38080)           host port for the dev gateway
#   VOS_DEV_STAGE_DIR             dev config and data dir, default ~/dev/build/gitea/vos-dev
#   VOS_DEV_CONFIG_DIR            override the dev config dir
#   VOS_DEV_DATA_DIR              override the dev app data dir
#   VOS_DEV_REPOS_DIR             repositories to expose at /data/git, default the installed one
#   VOS_DEV_HEALTH_TIMEOUT(900)   seconds to wait for the first build
#   VOS_TRAEFIK_CONTAINER(traefik)
#   VOS_HOST_GW_IP(172.17.0.1)
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/docker/vos-dev/docker-compose.yml"
ROUTE_TMPL="$ROOT_DIR/docker/vos-dev/traefik.dev.yml"
APP_ID="com.ictrek.gitea"
APP_NAME="${APP_ID//./-}"
CONTAINER_PREFIX="vos-app-${APP_NAME}-"
PORT="${VOS_DEV_PORT:-38080}"
HOST_GW="${VOS_HOST_GW_IP:-172.17.0.1}"
TRAEFIK_CONTAINER="${VOS_TRAEFIK_CONTAINER:-traefik}"
ROUTE_FILE="/etc/traefik/dynamic-conf/${APP_ID}.dev.yml"
STAGE_DIR="${VOS_DEV_STAGE_DIR:-$HOME/dev/build/gitea/vos-dev}"

# Placeholders so down, logs and status work without reading the installed app.
export GITEA_DEV_SOURCE="${GITEA_DEV_SOURCE:-$ROOT_DIR}"
export GITEA_DEV_CONFIG="${GITEA_DEV_CONFIG:-$STAGE_DIR/config}"
export GITEA_DEV_DATA="${GITEA_DEV_DATA:-$STAGE_DIR/data}"
export GITEA_SHARED_REPOS="${GITEA_SHARED_REPOS:-$STAGE_DIR/data}"
export GITEA_DEV_CONTEXT="${GITEA_DEV_CONTEXT:-$STAGE_DIR/context}"
export GITEA_DEV_RUN_DIR="${GITEA_DEV_RUN_DIR:-$STAGE_DIR/run}"
export VOS_POSTGRES_PASSWORD="${VOS_POSTGRES_PASSWORD:-unused}"
export VOS_DEV_PORT="$PORT"

log() { printf '\033[36m[vos-dev]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[vos-dev] %s\033[0m\n' "$*" >&2; }
die() { printf '\033[31m[vos-dev][ERROR]\033[0m %s\n' "$*" >&2; exit 1; }

compose() { docker compose -f "$COMPOSE_FILE" "$@"; }

app_container() {
  docker ps --format '{{.Names}}' | grep -F "$CONTAINER_PREFIX" | grep -E -- '-gitea-(amd|arm)-1$' | head -n1
}

app_env() {
  docker inspect "$1" --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n "s/^$2=//p"
}

app_mount() {
  docker inspect "$1" --format "{{range .Mounts}}{{if eq .Destination \"$2\"}}{{.Source}}{{end}}{{end}}"
}

route_on() {
  if ! docker ps --format '{{.Names}}' | grep -qx "$TRAEFIK_CONTAINER"; then
    warn "Traefik container $TRAEFIK_CONTAINER not found: no route written, use http://127.0.0.1:${PORT}/app/${APP_ID}/"
    return 0
  fi
  sed -e "s|__NAME__|$APP_NAME|g" -e "s|__APP_ID__|$APP_ID|g" \
      -e "s|__HOST__|$HOST_GW|g" -e "s|__PORT__|$PORT|g" "$ROUTE_TMPL" \
    | docker exec -i "$TRAEFIK_CONTAINER" sh -c "cat > '$ROUTE_FILE'"
  log "Route enabled: /app/${APP_ID} -> http://${HOST_GW}:${PORT} (removed on exit)"
}

route_off() {
  docker ps --format '{{.Names}}' | grep -qx "$TRAEFIK_CONTAINER" || return 0
  docker exec -i "$TRAEFIK_CONTAINER" sh -c "rm -f '$ROUTE_FILE'" 2>/dev/null || true
  log "Route removed; platform traffic returns to the installed app"
}

wait_healthy() {
  local timeout="${VOS_DEV_HEALTH_TIMEOUT:-900}" waited=0
  while [ "$waited" -lt "$timeout" ]; do
    if curl -fsS -m 3 "http://127.0.0.1:${PORT}/healthz" >/dev/null 2>&1; then
      echo
      return 0
    fi
    printf '\r\033[36m[vos-dev]\033[0m waiting for the first build and Gitea start... %ss/%ss' "$waited" "$timeout"
    sleep 5
    waited=$((waited + 5))
  done
  echo
  return 1
}

cleanup() {
  local rc=$?
  printf '\n'
  log "Stopping live debugging"
  set +e
  route_off
  compose down
  return "$rc"
}

cmd_up() {
  command -v docker >/dev/null || die "docker is required"
  command -v curl >/dev/null || die "curl is required"

  local container config data
  container="$(app_container)"
  [ -n "$container" ] || die "No installed Gitea container found; install the app in VOS first"

  VOS_POSTGRES_PASSWORD="$(app_env "$container" VOS_POSTGRES_PASSWORD)"
  [ -n "$VOS_POSTGRES_PASSWORD" ] || die "Cannot read VOS_POSTGRES_PASSWORD from $container"
  export VOS_POSTGRES_PASSWORD

  GITEA_PUBLIC_URL="$(app_env "$container" GITEA_PUBLIC_URL)"
  export GITEA_PUBLIC_URL="${GITEA_PUBLIC_URL:-http://${HOST_GW}:1182/app/${APP_ID}/}"

  config="$(app_mount "$container" /config)"
  data="$(app_mount "$container" /data)"
  [ -n "$config" ] || die "Cannot resolve the installed /config mount"
  [ -n "$data" ] || die "Cannot resolve the installed /data mount"

  export GITEA_DEV_SOURCE="$ROOT_DIR"
  export GITEA_DEV_CONFIG="${VOS_DEV_CONFIG_DIR:-$STAGE_DIR/config}"
  export GITEA_DEV_DATA="${VOS_DEV_DATA_DIR:-$STAGE_DIR/data}"
  export GITEA_SHARED_REPOS="${VOS_DEV_REPOS_DIR:-$data/git}"
  export GITEA_DEV_CONTEXT="$(app_mount "$container" /var/lib/vos-context)"
  export GITEA_DEV_RUN_DIR="$(app_mount "$container" "/var/run/vos/apps/${APP_ID}")"
  export VOS_DEV_PORT="$PORT"

  mkdir -p "$GITEA_DEV_DATA" "$GITEA_DEV_CONTEXT"
  [ -n "$GITEA_DEV_RUN_DIR" ] || GITEA_DEV_RUN_DIR="$GITEA_DEV_CONTEXT/platform-run"
  mkdir -p "$GITEA_DEV_RUN_DIR"

  if [ ! -f "$GITEA_DEV_CONFIG/conf/secrets.json" ]; then
    log "Seeding $GITEA_DEV_CONFIG from the installed configuration so both instances share one database"
    mkdir -p "$GITEA_DEV_CONFIG/conf"
    docker cp "$container:/config/conf/secrets.json" "$GITEA_DEV_CONFIG/conf/secrets.json" >/dev/null
  fi

  if ! docker image inspect gitea-vos-dev:local >/dev/null 2>&1; then
    log "Building the dev image (Go and Node toolchains, first run only)"
    compose build
  fi

  log "Starting the dev container (source: $GITEA_DEV_SOURCE)"
  compose up -d
  if ! wait_healthy; then
    warn "Not ready within ${VOS_DEV_HEALTH_TIMEOUT:-900}s; the route was not written"
    compose logs --tail 60 gitea-dev || true
    return 1
  fi
  log "Dev container is healthy on port ${PORT}"

  route_on
  log "Open Gitea from the VOS sidebar; source edits rebuild the backend and hot-reload the frontend"
  log "Ctrl-C stops the container and removes the route"
  printf '\n'

  trap cleanup EXIT
  compose logs -f gitea-dev
}

cmd_down() {
  set +e
  route_off
  compose down
  log "Dev container stopped"
}

cmd_status() {
  echo "-- container --"
  compose ps gitea-dev --format '  {{.Name}}  {{.Status}}  {{.Ports}}' 2>/dev/null || echo "  not running"
  echo "-- health --"
  if curl -fsS -m 3 "http://127.0.0.1:${PORT}/healthz" >/dev/null 2>&1; then
    echo "  OK http://127.0.0.1:${PORT}/healthz"
  else
    echo "  unreachable (not started, or still building)"
  fi
  echo "-- route ${ROUTE_FILE} --"
  docker exec -i "$TRAEFIK_CONTAINER" sh -c "test -f '$ROUTE_FILE' && cat '$ROUTE_FILE' || echo '  (not enabled)'" 2>/dev/null \
    || echo "  (Traefik container unavailable)"
}

case "${1:-up}" in
  up) cmd_up ;;
  down) cmd_down ;;
  route-off) route_off ;;
  status) cmd_status ;;
  logs) compose logs -f gitea-dev ;;
  -h|--help|help) sed -n '2,20p' "${BASH_SOURCE[0]}" ;;
  *) die "Unknown command: $1 (up|down|route-off|status|logs)" ;;
esac
