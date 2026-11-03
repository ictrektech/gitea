#!/bin/sh
set -eu
mkdir -p /data/gitea /data/git/repositories /config/conf /config/templates/custom
chown node:node /data /data/gitea /data/git /data/git/repositories /config /config/conf /config/templates /config/templates/custom
if test -r /var/lib/vos-context/access-token; then
  VOS_CONTEXT_TOKEN="$(cat /var/lib/vos-context/access-token)"
  export VOS_CONTEXT_TOKEN
fi
exec su-exec node node /opt/vos/start.mjs
