#!/usr/bin/env bash
#
# install.sh — install RoonWishlist as a systemd service on a Linux host.
#
# Target: a general-purpose Linux machine running Roon Server (Debian/Ubuntu, a NUC,
#         a VM, a mini-PC, a Raspberry Pi, a NAS, etc.).
#
# NOT for ROCK / Nucleus: those are locked-down Roon OS appliances where you cannot
# install Node.js or systemd services. If your Roon Core runs on ROCK/Nucleus, run
# this on any other always-on Linux machine on the same LAN — the extension finds the
# core over the network.
#
# Usage (as root, from inside a cloned copy of this repo):
#   sudo ./install.sh
#
# Override defaults with environment variables:
#   INSTALL_DIR=/opt/roon-wishlist \
#   DATA_DIR=/var/lib/roon-wishlist \
#   SERVICE_USER=roon \
#   HTTP_HOST=127.0.0.1 HTTP_PORT=3141 \
#   sudo -E ./install.sh
#
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/roon-wishlist}"
DATA_DIR="${DATA_DIR:-/var/lib/roon-wishlist}"
SERVICE_USER="${SERVICE_USER:-roon}"
SERVICE_NAME="roon-wishlist"
HTTP_HOST="${HTTP_HOST:-127.0.0.1}"
HTTP_PORT="${HTTP_PORT:-3141}"

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

err() { echo "ERROR: $*" >&2; exit 1; }
info() { echo ">>> $*"; }

[ "$(id -u)" -eq 0 ] || err "Please run as root (e.g. 'sudo ./install.sh')."

# --- Prerequisites -----------------------------------------------------------
command -v git >/dev/null 2>&1 || err "git is required (npm fetches the Roon API packages from GitHub over https). Install it, e.g. 'apt-get install -y git'."

NODE_BIN="$(command -v node || true)"
NPM_BIN="$(command -v npm || true)"
if [ -z "$NODE_BIN" ] || [ -z "$NPM_BIN" ]; then
  cat >&2 <<'EOF'
ERROR: Node.js (with npm) was not found.

Install Node.js LTS first, for example on Debian/Ubuntu:
  curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
  sudo apt-get install -y nodejs

Then re-run this script.
EOF
  exit 1
fi
info "Using node: $NODE_BIN ($("$NODE_BIN" --version))"

# --- Service user ------------------------------------------------------------
if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  info "Creating system user '$SERVICE_USER'"
  useradd --system --create-home --shell /usr/sbin/nologin "$SERVICE_USER"
fi

# --- Copy application files ---------------------------------------------------
info "Installing application to $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"
# Copy the repo contents but never the local node_modules / .git / data.
if command -v rsync >/dev/null 2>&1; then
  rsync -a --delete \
    --exclude '.git' --exclude 'node_modules' --exclude 'data' \
    "$SRC_DIR"/ "$INSTALL_DIR"/
else
  cp -a "$SRC_DIR"/. "$INSTALL_DIR"/
  rm -rf "$INSTALL_DIR/.git" "$INSTALL_DIR/node_modules" "$INSTALL_DIR/data"
fi

# --- Install production dependencies (https only, no SSH keys needed) ---------
info "Installing dependencies with 'npm ci' (this fetches the Roon API over https)"
( cd "$INSTALL_DIR" && "$NPM_BIN" ci --omit=dev --no-audit --no-fund )

# --- Data directory -----------------------------------------------------------
mkdir -p "$DATA_DIR"

# config.json (Roon pairing token) is written by node-roon-api into the working
# directory, so the service user must own the install dir as well as the data dir.
chown -R "$SERVICE_USER":"$SERVICE_USER" "$INSTALL_DIR" "$DATA_DIR"

# --- systemd unit -------------------------------------------------------------
UNIT_PATH="/etc/systemd/system/${SERVICE_NAME}.service"
info "Writing systemd unit to $UNIT_PATH"
cat > "$UNIT_PATH" <<EOF
[Unit]
Description=RoonWishlist - Roon extension for a lossless album wishlist
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${SERVICE_USER}
WorkingDirectory=${INSTALL_DIR}
Environment=NODE_ENV=production
Environment=ROON_WISHLIST_DATA_DIR=${DATA_DIR}
Environment=ROON_WISHLIST_HTTP_HOST=${HTTP_HOST}
Environment=ROON_WISHLIST_HTTP_PORT=${HTTP_PORT}
ExecStart=${NODE_BIN} ${INSTALL_DIR}/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

# --- Enable & start -----------------------------------------------------------
info "Enabling and starting ${SERVICE_NAME}"
systemctl daemon-reload
systemctl enable --now "${SERVICE_NAME}.service"

sleep 2
systemctl --no-pager --full status "${SERVICE_NAME}.service" || true

cat <<EOF

Done. RoonWishlist is installed and running.

Next steps:
  1. Open Roon -> Settings -> Extensions and confirm "Wishlist" is enabled/paired.
  2. Open its settings to set the "Music library path" and use the Actions menu.

Useful commands:
  systemctl status ${SERVICE_NAME}        # service state
  journalctl -u ${SERVICE_NAME} -f        # live logs
  systemctl restart ${SERVICE_NAME}       # restart after an update

Install dir:  ${INSTALL_DIR}
Data dir:     ${DATA_DIR}
HTTP API:     http://${HTTP_HOST}:${HTTP_PORT}  (local control API)
EOF
