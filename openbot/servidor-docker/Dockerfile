# OpenBot (Nightly Labs) on Vertra Cloud, with an admin web gateway.
#
# A thin layer on the official release image. Nothing of OpenBot changes: same binaries, same
# entrypoint (openbot-container), same Electron sandbox. Added only what Vertra needs:
#   * Vertra runs every image as 1000:1000 with a read-only root; /app is the only persistent,
#     writable folder. The official image keeps all its state in $HOME (=/data). Here HOME=/app,
#     so /app holds exactly what /data holds upstream (database, keyring + password, workspaces,
#     provider sign-ins, browser data, logs, ~/.local/bin).
#   * gateway/: a small Node server (built-ins only) with an admin web interface (email + password)
#     and a token API/MCP endpoint for other chats. It uses only OpenBot's official local
#     interfaces: the control socket of `openbot` and the Local scripts API on 127.0.0.1.
#   * vertra-start.sh: starts the gateway, then execs the official entrypoint.
#
# No --no-sandbox, no privilege, no seccomp change. If Vertra's runtime refuses user namespaces,
# the official entrypoint stops with its own message and the deployment is NOT compatible.
#
# Pinned (checked 2026-11-18): OpenBot 0.72.0 linux/amd64 manifest digest on GHCR; Node 22.23.5
# (Debian bookworm, glibc 2.36; runs on the Ubuntu 24.04 base, glibc 2.39).
FROM node:22.23.5-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee AS node

FROM ghcr.io/nightly-labs/openbot:0.72.0-amd64@sha256:c72c103da87586827547efd926b73a6fc6af0c5332ec05970e3ce2014561e715

USER root
# Root owns everything added here, so agents (UID 1000) cannot change the gateway.
COPY --from=node /usr/local/bin/node /opt/openbot-gateway/bin/node
COPY gateway/ /opt/openbot-gateway/
COPY --chmod=0755 vertra-start.sh /usr/local/bin/openbot-vertra-start
RUN chmod -R a+rX,go-w /opt/openbot-gateway && /opt/openbot-gateway/bin/node --version
USER openbot

# HOME and PATH cannot be set as Vertra app variables (forbidden keys), so they are set here.
# Same PATH as upstream, with /app/.local/bin in place of /data/.local/bin.
ENV HOME=/app \
    PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/app/.local/bin \
    XDG_RUNTIME_DIR=/run/openbot

# The gateway's port. Vertra publishes it over HTTPS on the app's subdomain.
EXPOSE 8080
STOPSIGNAL SIGTERM
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/openbot-vertra-start"]
