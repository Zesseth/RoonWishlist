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
#   sudo ./install.sh --web
#
# Override defaults with environment variables:
#   INSTALL_DIR=/opt/roon-wishlist \
#   DATA_DIR=/var/lib/roon-wishlist \
#   SERVICE_USER=roon \
#   HTTP_HOST=127.0.0.1 HTTP_PORT=3141 \
#   sudo -E ./install.sh
#
set -euo pipefail

err() { echo "ERROR: $*" >&2; exit 1; }
info() { echo ">>> $*"; }
show_help() {
  cat <<'EOF'
Usage:
  sudo ./install.sh [--web]

Options:
  --web, -web, -w   Expose the web UI/API on the LAN by setting HTTP_HOST=0.0.0.0
  --help, -h        Show this help

Environment overrides:
  INSTALL_DIR=/opt/roon-wishlist
  DATA_DIR=/var/lib/roon-wishlist
  SERVICE_USER=roon
  HTTP_HOST=127.0.0.1
  HTTP_PORT=3141

Examples:
  sudo ./install.sh
  sudo ./install.sh --web
  sudo HTTP_PORT=4242 ./install.sh --web
EOF
}

INSTALL_DIR="${INSTALL_DIR:-/opt/roon-wishlist}"
DATA_DIR="${DATA_DIR:-/var/lib/roon-wishlist}"
SERVICE_USER="${SERVICE_USER:-roon}"
SERVICE_NAME="roon-wishlist"
HTTP_HOST="${HTTP_HOST:-127.0.0.1}"
HTTP_PORT="${HTTP_PORT:-3141}"

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --web|-web|-w)
      HTTP_HOST="0.0.0.0"
      ;;
    --help|-h)
      show_help
      exit 0
      ;;
    *)
      err "Unknown option: $1 (run './install.sh --help')"
      ;;
  esac
  shift
done

[ "$(id -u)" -eq 0 ] || err "Please run as root (e.g. 'sudo ./install.sh')."

# --- Prerequisites -----------------------------------------------------------
# Detect the system package manager (best-effort; used to auto-install git/node).
PKG=""
if command -v apt-get >/dev/null 2>&1; then PKG="apt"
elif command -v dnf >/dev/null 2>&1; then PKG="dnf"
elif command -v yum >/dev/null 2>&1; then PKG="yum"
elif command -v pacman >/dev/null 2>&1; then PKG="pacman"
elif command -v zypper >/dev/null 2>&1; then PKG="zypper"
fi

pkg_install() {
  # pkg_install <pkg-name>
  case "$PKG" in
    apt)    apt-get update -y && apt-get install -y "$1" ;;
    dnf)    dnf install -y "$1" ;;
    yum)    yum install -y "$1" ;;
    pacman) pacman -Sy --noconfirm "$1" ;;
    zypper) zypper --non-interactive install -y "$1" ;;
    *)      return 1 ;;
  esac
}

# git is required (npm fetches the Roon API packages from GitHub over https).
if ! command -v git >/dev/null 2>&1; then
  info "git not found — attempting to install it"
  if ! pkg_install git; then
    err "Could not auto-install git (unknown package manager). Install git manually, then re-run."
  fi
fi

# Node.js + npm. Auto-install (or upgrade) Node LTS if missing or too old.
# cheerio/undici in the lockfile require Node >= 20.18.1; Debian 12's distro nodejs is
# often 18.x, so an "exists" check is not enough — we check the version too.
REQUIRED_NODE="20.18.1"
ver_ge() { [ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -n1)" = "$2" ]; } # $1 >= $2 ?
node_ok() {
  local b="$1" v
  [ -n "$b" ] || return 1
  v="$("$b" --version 2>/dev/null | sed 's/^v//')"
  [ -n "$v" ] || return 1
  ver_ge "$v" "$REQUIRED_NODE"
}

NODE_BIN="$(command -v node || true)"
NPM_BIN="$(command -v npm || true)"
if [ -z "$NPM_BIN" ] || ! node_ok "$NODE_BIN"; then
  if [ -n "$NODE_BIN" ]; then
    info "Node $("$NODE_BIN" --version 2>/dev/null) is missing or older than v${REQUIRED_NODE} — installing Node.js LTS via NodeSource"
  else
    info "Node.js/npm not found — attempting to install Node.js LTS"
  fi
  case "$PKG" in
    apt)
      # Debian/Ubuntu: NodeSource needs curl, ca-certificates and gnupg present first
      # (a minimal Debian 12 'bookworm' install ships none of them).
      export DEBIAN_FRONTEND=noninteractive
      apt-get update -y
      apt-get install -y ca-certificates curl gnupg
      curl -fsSL https://deb.nodesource.com/setup_lts.x | bash -
      apt-get install -y nodejs
      ;;
    dnf|yum)
      command -v curl >/dev/null 2>&1 || pkg_install curl || true
      curl -fsSL https://rpm.nodesource.com/setup_lts.x | bash -
      pkg_install nodejs
      ;;
    pacman)
      pacman -Sy --noconfirm nodejs npm
      ;;
    zypper)
      zypper --non-interactive install -y nodejs npm
      ;;
    *)
      cat >&2 <<EOF
ERROR: Node.js >= v${REQUIRED_NODE} (with npm) was not found and could not be auto-installed.

Install Node.js LTS manually, for example on Debian/Ubuntu:
  curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
  sudo apt-get install -y nodejs

Then re-run this script.
EOF
      exit 1
      ;;
  esac
  NODE_BIN="$(command -v node || true)"
  NPM_BIN="$(command -v npm || true)"
  [ -n "$NODE_BIN" ] && [ -n "$NPM_BIN" ] || err "Node.js install appears to have failed. Install it manually and re-run."
  node_ok "$NODE_BIN" || err "Installed Node $("$NODE_BIN" --version) is still older than v${REQUIRED_NODE}. Your CPU architecture may be unsupported by NodeSource (only amd64/arm64); install a newer Node manually."
fi
info "Using node: $NODE_BIN ($("$NODE_BIN" --version))"
if [ "$HTTP_HOST" = "0.0.0.0" ]; then
  info "LAN web UI enabled (--web / HTTP_HOST=0.0.0.0)"
fi

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
# Be a quiet neighbour to Roon Server on the same box: lower CPU/IO priority and cap
# the V8 heap. Soft/relative limits so the extension yields under contention without
# being OOM-killed mid-scan.
Nice=10
CPUWeight=20
IOSchedulingClass=best-effort
IOSchedulingPriority=6
MemoryHigh=192M
NoNewPrivileges=true
PrivateTmp=true
ExecStart=${NODE_BIN} --max-old-space-size=128 ${INSTALL_DIR}/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

# --- Enable & (re)start -------------------------------------------------------
# 'enable --now' won't restart an already-running service, so on a re-run (update)
# the new code/deps/unit wouldn't take effect. Enable, then explicitly restart.
info "Enabling and (re)starting ${SERVICE_NAME}"
systemctl daemon-reload
systemctl enable "${SERVICE_NAME}.service"
systemctl restart "${SERVICE_NAME}.service"

sleep 2
systemctl --no-pager --full status "${SERVICE_NAME}.service" || true

cat <<EOF

Done. RoonWishlist is installed and running.

Next steps:
  1. Open Roon -> Settings -> Extensions and confirm "Wishlist" is enabled/paired.
  2. Open its settings to set the "Music library path" and use the Actions menu.
  3. Open the web UI in a browser: http://${HTTP_HOST}:${HTTP_PORT}
     (to reach it from another computer, re-run with HTTP_HOST=0.0.0.0 and use
      http://<this-server-ip>:${HTTP_PORT} — see the README security note.)

Useful commands:
  systemctl status ${SERVICE_NAME}        # service state
  journalctl -u ${SERVICE_NAME} -f        # live logs
  systemctl restart ${SERVICE_NAME}       # restart after an update

Install dir:  ${INSTALL_DIR}
Data dir:     ${DATA_DIR}
Web UI / API: http://${HTTP_HOST}:${HTTP_PORT}
EOF
