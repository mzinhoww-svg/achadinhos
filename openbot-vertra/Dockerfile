# OpenBot (Nightly Labs) on Vertra Cloud.
#
# A thin layer on the official release image. Nothing of OpenBot changes: same binaries, same
# entrypoint (openbot-container), same Electron sandbox. Only what Vertra's runtime requires:
#   * Vertra runs every image as 1000:1000 with a read-only root; /app is the only persistent,
#     writable folder. The official image keeps all its state in $HOME (=/data). Here HOME=/app,
#     so /app holds exactly what /data holds upstream (database, keyring + password, workspaces,
#     provider sign-ins, browser data, logs, ~/.local/bin).
#   * A small start script (vertra-start.sh) that redeems an optional one-time server claim,
#     because Vertra has no `docker exec` for `openbot login`, then execs the official entrypoint.
#
# No --no-sandbox, no privilege, no seccomp change. If Vertra's runtime refuses user namespaces,
# the official entrypoint stops with its own message and the deployment is NOT compatible.
#
# Pinned: OpenBot 0.72.0, linux/amd64 manifest digest (GHCR, checked 2026-11-18).
FROM ghcr.io/nightly-labs/openbot:0.72.0-amd64@sha256:c72c103da87586827547efd926b73a6fc6af0c5332ec05970e3ce2014561e715

USER root
COPY --chmod=0755 vertra-start.sh /usr/local/bin/openbot-vertra-start
USER openbot

# HOME and PATH cannot be set as Vertra app variables (forbidden keys), so they are set here.
# Same PATH as upstream, with /app/.local/bin in place of /data/.local/bin.
ENV HOME=/app \
    PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/app/.local/bin \
    XDG_RUNTIME_DIR=/run/openbot

STOPSIGNAL SIGTERM
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/openbot-vertra-start"]
