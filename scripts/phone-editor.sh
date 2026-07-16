#!/usr/bin/env bash
# Expose the dev-only Map Builder to your phone from a Claude Code *cloud* session,
# privately over Tailscale. See docs/MOBILE-EDITOR-ACCESS.md for the full story
# (why the obvious tunnels do NOT work in that environment, and how saving works).
#
# Usage:
#   scripts/phone-editor.sh <tskey-auth-...>      # or: TS_AUTHKEY=... scripts/phone-editor.sh
#
# Prereq: an *ephemeral* Tailscale auth key from
#   https://login.tailscale.com/admin/settings/keys
#
# What it does: joins THIS container to your Tailnet as node `mostowo-editor`,
# then serves Vite on all interfaces so a Tailnet peer (your phone) can reach it
# by IP. It does NOT need any change to vite.config.ts — Vite's dev-server host
# check blocks unknown *hostnames* but always allows a raw IP, so we hand out the
# IP URL, not the MagicDNS name.
set -euo pipefail

AUTHKEY="${1:-${TS_AUTHKEY:-}}"
PORT="${PORT:-5173}"
HOSTNAME_TS="${TS_HOSTNAME:-mostowo-editor}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [[ -z "$AUTHKEY" ]]; then
  echo "ERROR: pass a Tailscale auth key (arg 1 or \$TS_AUTHKEY)." >&2
  echo "Generate an ephemeral key: https://login.tailscale.com/admin/settings/keys" >&2
  exit 1
fi

# The cloud session's only egress is an HTTPS CONNECT proxy; tailscaled honours
# HTTPS_PROXY for its control-plane + DERP connections, so pass it through.
PROXY="${HTTPS_PROXY:-${https_proxy:-}}"

# 1) Install Tailscale if missing (from its apt repo; the host is reachable via the proxy).
if ! command -v tailscale >/dev/null 2>&1; then
  echo "==> installing tailscale"
  . /etc/os-release
  curl -fsSL "https://pkgs.tailscale.com/stable/${ID}/${VERSION_CODENAME}.noarmor.gpg" \
    | sudo tee /usr/share/keyrings/tailscale-archive-keyring.gpg >/dev/null
  curl -fsSL "https://pkgs.tailscale.com/stable/${ID}/${VERSION_CODENAME}.tailscale-keyring.list" \
    | sudo tee /etc/apt/sources.list.d/tailscale.list >/dev/null
  sudo apt-get update -o Dir::Etc::sourcelist="sources.list.d/tailscale.list" \
    -o Dir::Etc::sourceparts="-" -o APT::Get::List-Cleanup="0"
  sudo apt-get install -y tailscale
fi

# 2) Start tailscaled. Prefer kernel/TUN mode (peers reach the local port by IP
#    directly); fall back to userspace networking if /dev/net/tun is unavailable.
if ! tailscale status >/dev/null 2>&1; then
  echo "==> starting tailscaled"
  sudo mkdir -p /var/lib/tailscale /var/run/tailscale
  if [[ -c /dev/net/tun ]]; then
    sudo -b env HTTPS_PROXY="$PROXY" ALL_PROXY="$PROXY" \
      tailscaled --state=/var/lib/tailscale/tailscaled.state \
                 --socket=/var/run/tailscale/tailscaled.sock >/tmp/tailscaled.log 2>&1
  else
    echo "   (no TUN device — using userspace networking; reach the editor via 'tailscale serve')"
    sudo -b env HTTPS_PROXY="$PROXY" ALL_PROXY="$PROXY" \
      tailscaled --tun=userspace-networking \
                 --state=/var/lib/tailscale/tailscaled.state >/tmp/tailscaled.log 2>&1
  fi
  sleep 4
fi

# 3) Join the Tailnet (ephemeral node; auto-removed when the container dies).
echo "==> tailscale up as '$HOSTNAME_TS'"
sudo env HTTPS_PROXY="$PROXY" ALL_PROXY="$PROXY" \
  tailscale up --authkey="$AUTHKEY" --hostname="$HOSTNAME_TS" \
               --accept-dns=false --accept-routes=false --timeout=90s

TS_IP="$(tailscale ip -4 | head -1)"

# 4) Start the editor (Vite) on all interfaces if it isn't already up.
#    EDITOR_AUTOCOMMIT=1 makes every editor Save stage/commit/push automatically, so the ephemeral
#    host can die without losing work (set EDITOR_AUTOCOMMIT=0 before running to opt out).
if ! curl -fsS -m 3 -o /dev/null "http://127.0.0.1:${PORT}/editor.html" 2>/dev/null; then
  echo "==> starting the editor on :${PORT} (autosave-commit ${EDITOR_AUTOCOMMIT:-1})"
  ( cd "$ROOT" && [[ -d node_modules ]] || npm ci )
  ( cd "$ROOT" && EDITOR_AUTOCOMMIT="${EDITOR_AUTOCOMMIT:-1}" \
      nohup node_modules/.bin/vite --host 0.0.0.0 --port "$PORT" >/tmp/vite-editor.log 2>&1 & )
  sleep 3
fi

echo
echo "================================================================"
echo "  Editor is live on your Tailnet. Open this on your phone:"
echo
echo "      http://${TS_IP}:${PORT}/editor.html"
echo
echo "  (use the IP, not the '$HOSTNAME_TS' name — Vite blocks unknown hostnames)"
echo "  Container is ephemeral: commit your map often (ask Claude to 'save')."
echo "================================================================"
