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
# To expose the web UI/API on the LAN during install, forward the installer's
# --web flag:
#
#   curl -fsSL https://raw.githubusercontent.com/Zesseth/RoonWishlist/main/bootstrap.sh \
#     | sudo bash -s -- --web
#
# To install/update a non-main branch instead (for testing), set REPO_BRANCH and
# download bootstrap.sh from that branch:
#
#   curl -fsSL https://raw.githubusercontent.com/Zesseth/RoonWishlist/<branch>/bootstrap.sh \
#     | sudo REPO_BRANCH=<branch> bash
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
#   REPO_BRANCH git branch to clone/update (default: repo default branch / current branch)
#   CLONE_DIR   where to keep the source (default: /usr/local/src/RoonWishlist)
#   INSTALL_DIR DATA_DIR SERVICE_USER HTTP_HOST HTTP_PORT  (see install.sh)
#
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/Zesseth/RoonWishlist.git}"
REPO_BRANCH="${REPO_BRANCH:-}"
CLONE_DIR="${CLONE_DIR:-/usr/local/src/RoonWishlist}"

err() { echo "ERROR: $*" >&2; exit 1; }
info() { echo ">>> $*"; }
show_help() {
  cat <<'EOF'
Usage:
  curl -fsSL https://raw.githubusercontent.com/Zesseth/RoonWishlist/main/bootstrap.sh | sudo bash
  curl -fsSL https://raw.githubusercontent.com/Zesseth/RoonWishlist/main/bootstrap.sh | sudo bash -s -- --web
  curl -fsSL https://raw.githubusercontent.com/Zesseth/RoonWishlist/<branch>/bootstrap.sh | sudo REPO_BRANCH=<branch> bash

Arguments forwarded to install.sh:
  --web, -web, -w   Expose the web UI/API on the LAN (HTTP_HOST=0.0.0.0)
  --help, -h        Show this help

Environment overrides:
  REPO_URL, REPO_BRANCH, CLONE_DIR
  INSTALL_DIR, DATA_DIR, SERVICE_USER, HTTP_HOST, HTTP_PORT
EOF
}

for arg in "$@"; do
  case "$arg" in
    --help|-h)
      show_help
      exit 0
      ;;
  esac
done

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
  if [ -n "$REPO_BRANCH" ]; then
    info "Checking out branch $REPO_BRANCH"
    git -C "$CLONE_DIR" fetch origin
    if git -C "$CLONE_DIR" show-ref --verify --quiet "refs/heads/$REPO_BRANCH"; then
      git -C "$CLONE_DIR" checkout "$REPO_BRANCH"
    else
      git -C "$CLONE_DIR" checkout -b "$REPO_BRANCH" --track "origin/$REPO_BRANCH"
    fi
    git -C "$CLONE_DIR" pull --ff-only origin "$REPO_BRANCH"
  else
    git -C "$CLONE_DIR" pull --ff-only
  fi
else
  info "Cloning $REPO_URL into $CLONE_DIR"
  mkdir -p "$(dirname "$CLONE_DIR")"
  if [ -n "$REPO_BRANCH" ]; then
    git clone --branch "$REPO_BRANCH" --single-branch "$REPO_URL" "$CLONE_DIR"
  else
    git clone "$REPO_URL" "$CLONE_DIR"
  fi
fi

# --- Hand off to the main installer ------------------------------------------
info "Running install.sh"
chmod +x "$CLONE_DIR/install.sh"
# Forward the current environment (INSTALL_DIR, DATA_DIR, etc.) and any install flags
# like --web to install.sh.
exec bash "$CLONE_DIR/install.sh" "$@"
