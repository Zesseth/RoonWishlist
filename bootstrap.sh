#!/usr/bin/env bash
#
# bootstrap.sh — one-command installer for RoonWishlist on a Linux host.
#
# This is for people who just want it running and don't want to think about git,
# Node.js, cloning, or systemd. It will:
#   1. install git (if missing),
#   2. clone (or update) this repository,
#   3. hand off to install.sh, which installs Node.js (if missing), the app, and a
#      systemd service that auto-starts.
#
# Run it with a single command (as root):
#
#   curl -fsSL https://raw.githubusercontent.com/Zesseth/RoonWishlist/main/bootstrap.sh | sudo bash
#
# Or, if you prefer to inspect it first (recommended):
#
#   curl -fsSL https://raw.githubusercontent.com/Zesseth/RoonWishlist/main/bootstrap.sh -o bootstrap.sh
#   less bootstrap.sh
#   sudo bash bootstrap.sh
#
# NOT for ROCK / Nucleus (locked-down Roon OS appliances). Run it on any other
# always-on Linux machine on the same network — it will find your Roon core.
#
# Optional environment variables (all forwarded to install.sh too):
#   REPO_URL    git URL to clone (default: this repo over https)
#   CLONE_DIR   where to keep the source (default: /usr/local/src/RoonWishlist)
#   INSTALL_DIR DATA_DIR SERVICE_USER HTTP_HOST HTTP_PORT  (see install.sh)
#
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/Zesseth/RoonWishlist.git}"
CLONE_DIR="${CLONE_DIR:-/usr/local/src/RoonWishlist}"

err() { echo "ERROR: $*" >&2; exit 1; }
info() { echo ">>> $*"; }

[ "$(id -u)" -eq 0 ] || err "Please run as root, e.g. pipe into 'sudo bash' or run 'sudo bash bootstrap.sh'."

# --- Detect package manager (to install git if needed) -----------------------
PKG=""
if command -v apt-get >/dev/null 2>&1; then PKG="apt"
elif command -v dnf >/dev/null 2>&1; then PKG="dnf"
elif command -v yum >/dev/null 2>&1; then PKG="yum"
elif command -v pacman >/dev/null 2>&1; then PKG="pacman"
elif command -v zypper >/dev/null 2>&1; then PKG="zypper"
fi

ensure_git() {
  command -v git >/dev/null 2>&1 && return 0
  info "git not found — installing it"
  case "$PKG" in
    apt)    apt-get update -y && apt-get install -y git ;;
    dnf)    dnf install -y git ;;
    yum)    yum install -y git ;;
    pacman) pacman -Sy --noconfirm git ;;
    zypper) zypper --non-interactive install -y git ;;
    *)      err "Could not auto-install git (unknown package manager). Install git manually and re-run." ;;
  esac
}

ensure_git

# --- Clone or update ----------------------------------------------------------
if [ -d "$CLONE_DIR/.git" ]; then
  info "Updating existing checkout in $CLONE_DIR"
  git -C "$CLONE_DIR" pull --ff-only
else
  info "Cloning $REPO_URL into $CLONE_DIR"
  mkdir -p "$(dirname "$CLONE_DIR")"
  git clone "$REPO_URL" "$CLONE_DIR"
fi

# --- Hand off to the main installer ------------------------------------------
info "Running install.sh"
chmod +x "$CLONE_DIR/install.sh"
# Forward the current environment (INSTALL_DIR, DATA_DIR, etc.) to install.sh.
exec bash "$CLONE_DIR/install.sh"
