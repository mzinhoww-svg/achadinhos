#!/bin/bash
# Vertra start wrapper for the official OpenBot image. See Dockerfile and README.md.
set -euo pipefail
umask 077
cd "$HOME"

echo "openbot-vertra: uid=$(id -u) gid=$(id -g) home=$HOME"
echo "openbot-vertra: /dev/shm $(df -h --output=size /dev/shm 2>/dev/null | tail -n 1 | tr -d ' ') (OpenBot falls back to /tmp below 1 GiB)"
if unshare --user --map-root-user true 2>/dev/null; then
  echo "openbot-vertra: user namespaces OK (Electron sandbox can start)"
else
  echo "openbot-vertra: user namespaces REFUSED by the runtime; the official entrypoint will stop."
fi

# The gateway runs detached (double fork), so tini adopts it; a loop restarts it if it exits.
# Its variables (OBG_*) are hashes, not secrets; they are removed from OpenBot's environment.
gateway() {
  while true; do
    /opt/openbot-gateway/bin/node /opt/openbot-gateway/server.mjs || true
    echo "openbot-vertra: gateway exited; restarting in 5 s"
    sleep 5
  done
}
( gateway </dev/null & ) || true

# Health line in the log every 30 min (version, server state, memory), without account details.
status_log() {
  sleep 90
  while true; do
    openbot status 2>&1 | grep -v -i -E 'mail|account|token|session' | sed 's/^/openbot-vertra status: /' || true
    sleep 1800
  done
}
( status_log </dev/null & ) || true

unset OBG_ADMIN_EMAIL OBG_ADMIN_PASSWORD_HASH OBG_API_TOKEN_SHA256 OBG_SESSION_HOURS
exec /opt/OpenBot/app/resources/hosting/openbot-container
