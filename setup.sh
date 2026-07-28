#!/bin/bash
# setup.sh — Clone RoonWishlist and install locally
# Usage: ./setup.sh [INSTALL_DIR]
# Default: ~/RoonWishlist

set -e

INSTALL_DIR="${1:-$HOME/RoonWishlist}"
REPO_URL="https://github.com/Zesseth/RoonWishlist.git"

echo "════════════════════════════════════════════════════════════════════════════════"
echo "                   RoonWishlist — Local Setup & Installation"
echo "════════════════════════════════════════════════════════════════════════════════"
echo ""
echo "📦 Installation Path: $INSTALL_DIR"
echo ""

# Check if directory already exists
if [ -d "$INSTALL_DIR" ]; then
  echo "⚠️  Directory already exists: $INSTALL_DIR"
  read -p "Overwrite? (y/N): " -n 1 -r
  echo
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "🗑️  Removing existing installation..."
    rm -rf "$INSTALL_DIR"
  else
    echo "❌ Aborted."
    exit 1
  fi
fi

# Clone repository
echo "📥 Cloning repository from GitHub..."
git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"
cd "$INSTALL_DIR"

echo "✅ Repository cloned"
echo ""

# Check Node.js version
echo "🔍 Checking Node.js installation..."
if ! command -v node &> /dev/null; then
  echo "❌ Node.js not found. Please install Node.js v18.13+ first:"
  echo "   https://nodejs.org/en/download/"
  exit 1
fi

NODE_VERSION=$(node --version)
echo "✅ Node.js $NODE_VERSION found"
echo ""

# Install dependencies
echo "📦 Installing dependencies (npm ci)..."
npm ci
echo "✅ Dependencies installed"
echo ""

# Run tests
echo "🧪 Running automated tests..."
if npm test; then
  echo "✅ All tests passed!"
  TESTS_OK=1
else
  echo "⚠️  Some tests failed"
  TESTS_OK=0
fi
echo ""

# Print next steps
echo "════════════════════════════════════════════════════════════════════════════════"
echo "                              ✅ SETUP COMPLETE"
echo "════════════════════════════════════════════════════════════════════════════════"
echo ""
echo "📋 Next Steps:"
echo ""
echo "1️⃣  Read the Testing Guide:"
echo "   cat $INSTALL_DIR/TESTING.md"
echo ""
echo "2️⃣  Start the extension:"
echo "   cd $INSTALL_DIR"
echo "   node index.js"
echo ""
echo "   (Keep this running in the background)"
echo ""
echo "3️⃣  Access the web interface:"
echo "   http://localhost:3141"
echo ""
echo "4️⃣  Pair with Roon Core:"
echo "   - Open Roon Settings → Extensions"
echo "   - Find 'RoonWishlist' and enable it"
echo "   - Keep Roon Settings open briefly for handshake"
echo ""
echo "────────────────────────────────────────────────────────────────────────────────"
echo ""
echo "📖 Documentation:"
echo "   • README.md ................. Project overview"
echo "   • TESTING.md ................ Complete testing guide"
echo "   • ROON_API_LIMITATIONS.md ... API constraints"
echo "   • TODO.md ................... Issue tracking"
echo ""
echo "🐛 Troubleshooting:"
echo "   • If tests failed above, run: npm test"
echo "   • Check logs: tail -f data/roon-wishlist.log (if using systemd)"
echo "   • View status: curl http://localhost:3141/status"
echo ""
echo "⚙️  Optional: Install as systemd service (Linux only)"
echo "   cd $INSTALL_DIR"
echo "   sudo ./deploy/install.sh"
echo "   sudo systemctl start roon-wishlist"
echo ""
echo "════════════════════════════════════════════════════════════════════════════════"
echo ""

if [ $TESTS_OK -eq 1 ]; then
  echo "✅ Ready to test! Start the extension with: node $INSTALL_DIR/index.js"
else
  echo "⚠️  Please review the test output above and ensure all tests pass."
  echo "   Run: cd $INSTALL_DIR && npm test"
fi
echo ""
