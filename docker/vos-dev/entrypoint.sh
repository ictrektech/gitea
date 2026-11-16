#!/bin/sh
set -eu
cd /src

if test -r /var/lib/vos-context/access-token; then
  VOS_CONTEXT_TOKEN="$(cat /var/lib/vos-context/access-token)"
  export VOS_CONTEXT_TOKEN
fi

if ! command -v air >/dev/null 2>&1; then
  go install github.com/air-verse/air@v1.67.4
fi

# Module URLs must carry the VOS sub path, otherwise the browser asks the platform root and gets 404.
dev_base="$(printf '%s' "${GITEA_PUBLIC_URL:-}" | sed -E 's#^[a-z]+://[^/]+##')"
[ -n "$dev_base" ] || dev_base="/"
case "$dev_base" in */) ;; *) dev_base="$dev_base/" ;; esac

pnpm install --frozen-lockfile --prefer-offline
NODE_ENV=development pnpm exec vite --logLevel warn --base "$dev_base" &
vite_pid=$!
trap 'kill "$vite_pid" 2>/dev/null || true' EXIT INT TERM

# Start Gitea only after the dev server answers, otherwise it reads a missing manifest at boot.
i=0
ready=""
while [ "$i" -lt 30 ]; do
  port="$(cat /src/public/assets/.vite/dev-port 2>/dev/null || true)"
  # the check middleware runs before Vite's base middleware, so it answers without the sub path
  if [ -n "$port" ] && curl -sf -m 2 -o /dev/null "http://127.0.0.1:${port}/web_src/js/__vite_dev_server_check"; then
    ready="1"
    break
  fi
  i=$((i + 1))
  sleep 1
done
[ -n "$ready" ] || echo "Vite dev server did not answer within 30s, starting Gitea anyway" >&2

exec "$@"
