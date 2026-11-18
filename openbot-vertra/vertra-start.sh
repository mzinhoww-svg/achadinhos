#!/bin/bash
# Vertra start wrapper for the official OpenBot image. See Dockerfile and README.md.
set -euo pipefail
umask 077
cd "$HOME"

ctl="$HOME/.openbot-vertra"
mkdir -p "$ctl"

echo "openbot-vertra: uid=$(id -u) gid=$(id -g) home=$HOME"
echo "openbot-vertra: /dev/shm $(df -h --output=size /dev/shm 2>/dev/null | tail -n 1 | tr -d ' ') (OpenBot falls back to /tmp below 1 GiB)"
if unshare --user --map-root-user true 2>/dev/null; then
  echo "openbot-vertra: user namespaces OK (Electron sandbox can start)"
else
  echo "openbot-vertra: user namespaces REFUSED by the runtime; the official entrypoint will stop."
fi

# Helpers run detached (double fork), so tini adopts them and OpenBot keeps PID-1 semantics.
helpers() {
  local sock="$XDG_RUNTIME_DIR/control.sock"
  for _ in $(seq 1 300); do [ -S "$sock" ] && break; sleep 1; done
  if [ ! -S "$sock" ]; then echo "openbot-vertra: control socket not ready after 300 s"; return 0; fi
  sleep 5
  # One-time server claim: written to /app/.openbot-vertra/claim with the Vertra file manager.
  # The claim is single-use and valid 15 minutes; the file is removed after the attempt and the
  # claim is never printed.
  if [ -s "$ctl/claim" ]; then
    name=$(tr -cd 'A-Za-z0-9 _.-' <"$ctl/name" 2>/dev/null || true)
    name=${name:-OpenBot-Vertra}
    if openbot login --claim --name "$name" <"$ctl/claim" >"$ctl/claim.out" 2>&1; then
      echo "openbot-vertra: server claim redeemed (name: $name)"
    else
      echo "openbot-vertra: server claim FAILED; details in $ctl/claim.out"
    fi
    rm -f "$ctl/claim"
  fi
  # Health line in the log every 30 min (state, version, memory), without account details.
  while true; do
    openbot status 2>&1 | grep -v -i -E 'mail|account|user|token|session' | sed 's/^/openbot-vertra status: /' || true
    sleep 1800
  done
}
( helpers </dev/null & ) || true

exec /opt/OpenBot/app/resources/hosting/openbot-container
