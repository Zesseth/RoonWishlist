# Testing Guide — RoonWishlist

This guide covers both automated tests and manual testing instructions for local deployment.

## Quick Start — Automated Tests

```bash
# Clone the repository
git clone https://github.com/Zesseth/RoonWishlist.git
cd RoonWishlist

# Install dependencies
npm ci

# Run all automated tests
npm test

# Watch mode (re-run on changes)
npm run test:watch
```

**Current Status:** ✅ 35 automated tests passing
- 9 tests: search module (Bandcamp/Qobuz API calls)
- 26 tests: wishlist module (data persistence, CRUD operations)

---

## Automated Tests (Unit)

### Search Module Tests (`test/search.test.js`)

**9 tests** covering album search across Bandcamp and Qobuz APIs:

```
✔ searchBandcamp() — Valid searches, empty input, partial input
✔ searchQobuz() — Valid searches, empty input, partial input  
✔ searchAll() — Combined searches, deduplication
```

**What's tested:**
- Empty/null input handling
- Network resilience (timeouts, retries)
- Result deduplication
- Cache validation (10-minute TTL)

**Notes:**
- These are **integration tests** (call real APIs)
- Takes ~1-2 seconds per test (network latency)
- Bandcamp/Qobuz may rate-limit or block requests if called too frequently
- If tests fail: Wait a few minutes and retry (API throttling)

### Wishlist Module Tests (`test/wishlist.test.js`)

**26 tests** covering local wishlist CRUD and persistence:

```
✔ add() — 7 tests (duplicate detection, normalization, buyLinks)
✔ remove() — 4 tests (case-insensitive removal)
✔ getAll() — 3 tests (array isolation, retrieval)
✔ upsert() — 4 tests (update or insert logic)
✔ replaceAll() — 6 tests (bulk replace, deduplication)
✔ data persistence — 2 tests (file I/O, mocking)
```

**What's tested:**
- Album deduplication (case-insensitive)
- Data format validation (artist + title required)
- Buy link filtering (invalid entries removed)
- File I/O and recovery

**Notes:**
- Pure unit tests (no network calls)
- Fast: ~20ms total
- All tests pass ✅

---

## Manual Testing — Local Installation

After running automated tests, install locally to test with Roon:

### 1. Clone & Install

```bash
# Clone the repo
git clone https://github.com/Zesseth/RoonWishlist.git
cd RoonWishlist

# Install dependencies
npm ci

# Verify tests pass
npm test

# If Windows, run bootstrap to set up
./bootstrap.sh
```

### 2. Start the Extension

```bash
# Start HTTP API server (port 3141)
node index.js
```

**Expected output:**
```
✓ WebSocket client listening on port 3141
✓ Extension loaded and pairing...
✓ Waiting for Roon Core connection...
```

**If using systemd (Linux/Debian):**
```bash
# Install as service
./deploy/install.sh

# Start service
sudo systemctl start roon-wishlist

# Check status
sudo systemctl status roon-wishlist

# View logs
sudo journalctl -u roon-wishlist -f
```

### 3. Pair with Roon Core

1. Open Roon Settings → Extensions
2. Find "RoonWishlist"
3. Click "Enable" or "Open" to connect
4. **Important:** Keep Roon Settings open briefly to complete handshake

### 4. Manual Test Scenarios

#### Scenario 1: Basic Search & Add

```
1. Open http://localhost:3141 in browser
2. Search for: "The Beatles" / "Abbey Road"
3. Should show:
   - Bandcamp link (if available)
   - Qobuz link (if available)
   - "Add to Wishlist" button
4. Click "Add to Wishlist"
5. Verify album appears in wishlist
6. Refresh page — album still there? ✓
```

**Pass Criteria:**
- ✅ Search returns results in < 5 seconds
- ✅ Buy links point to real album pages
- ✅ Album persists after page refresh
- ✅ No duplicate entries on re-add

---

#### Scenario 2: Wishlist Sync with Roon

```
1. In Roon, add album with tag: "Wishlist"
   - Example: Navigate to Library → Albums
   - Find album → Tag it with custom tag "Wishlist"
2. Restart extension: 
   systemctl restart roon-wishlist
   (or: stop + start node index.js)
3. Check wishlist at http://localhost:3141
   - Album should appear automatically
```

**Pass Criteria:**
- ✅ Tagged album syncs to wishlist
- ✅ Sync completes within 10 seconds
- ✅ Roon status shows "reconciliation_completed"
- ⚠️ If sync fails: Check that Roon Settings still show extension enabled

---

#### Scenario 3: Storage Location Detection

```
1. Extension running and paired with Roon
2. Call: curl http://localhost:3141/storage-locations
3. Response should be JSON:
   [
     {"path": "/path/to/music", "source": "browse_api"},
     {"path": "/fallback/path", "source": "env_var"}
   ]
```

**Pass Criteria:**
- ✅ Returns array (empty is OK if no storage found)
- ✅ Paths are strings or null
- ✅ No errors thrown
- ℹ️ Paths may be unavailable if Roon Core unreachable

---

#### Scenario 4: Auto-Clean Lossless Detection

```
1. Add album to wishlist: "Test Album" / "Test Artist"
2. Create folder with FLAC files:
   /music/Test Artist/Test Album/
   ├── 01.flac
   ├── 02.flac
   └── cover.jpg
3. Trigger library scan: curl -X POST http://localhost:3141/scan
4. Wait 10-30 seconds (scans full library)
5. Check wishlist: album should be gone
```

**Pass Criteria:**
- ✅ FLAC files detected correctly
- ✅ Album auto-removed when all tracks FLAC
- ✅ Partial FLAC doesn't trigger removal (mixed with lossy)
- ✅ Non-audio files ignored (jpg, txt, cue, etc.)
- ⚠️ Scan may be slow on large libraries (>10,000 albums)

---

#### Scenario 5: Error Recovery

```
1. Stop Roon Core (disconnect network or stop service)
2. Extension should still serve HTTP API
3. Call: curl http://localhost:3141/status
4. Response should include: "roon_connected": false
5. Restart Roon Core
6. Extension should auto-reconnect
```

**Pass Criteria:**
- ✅ No HTTP crashes when Roon disconnects
- ✅ Status accurately reflects connection state
- ✅ Auto-reconnection works
- ✅ No file corruption in wishlist.json

---

## Test Checklist — Deployment Ready

Use this checklist before deploying v1.0:

### Automated Tests
- [ ] `npm test` passes (35/35 tests)
- [ ] No console errors during test run
- [ ] Test suite completes in < 2 minutes

### Manual Tests (with Roon Core)
- [ ] Extension pairs and stays connected
- [ ] Search API works (Bandcamp + Qobuz)
- [ ] Wishlist persists (file I/O working)
- [ ] Roon tag sync works (one-way: Roon → Wishlist)
- [ ] Storage location detection works
- [ ] Auto-clean for FLAC detection works
- [ ] Error recovery: disconnection → reconnection
- [ ] No memory leaks (check `top` / Task Manager)
- [ ] Logs are clean (no spam or errors)

### Performance Targets
- [ ] Search: < 5 seconds per query
- [ ] Wishlist sync: < 10 seconds (Roon tags → JSON)
- [ ] Library scan: < 1 minute for < 10,000 albums
- [ ] HTTP response time: < 100ms for /status
- [ ] Memory: < 256MB stable (steady after warm-up)

---

## Environment Variables (Optional)

Add to `.env` or systemd service for configuration:

```bash
# Music library path (fallback if Roon Browse API unavailable)
ROON_MUSIC_PATH="/mnt/music"

# Data directory (default: ./data/)
ROON_WISHLIST_DATA_DIR="/var/lib/roon-wishlist"

# HTTP port (default: 3141)
ROON_WISHLIST_PORT=3141

# Qobuz app ID (for API calls; optional, has fallbacks)
ROON_WISHLIST_QOBUZ_APP_ID="your_app_id"

# Log level (default: info)
ROON_WISHLIST_LOG_LEVEL=debug
```

---

## Troubleshooting

### "Extension not pairing"
1. Check that Roon Settings is open (required for handshake)
2. Verify node process is running: `ps aux | grep node`
3. Check firewall: port 3141 should be accessible
4. Check logs: `journalctl -u roon-wishlist -f`

### "API returns 503 StorageError"
- Roon Browse API not available (Roon Core busy or outdated)
- Workaround: Set `ROON_MUSIC_PATH` environment variable
- Try restarting Roon and extension

### "Wishlist not syncing from Roon tags"
1. Verify tag name is exactly "Wishlist" (case-sensitive)
2. Restart extension after tagging
3. Check `/status` endpoint: look for `lastReconcile` timestamp
4. Manual reconcile: `curl -X POST http://localhost:3141/reconcile`

### "Tests timeout (> 2 seconds)"
- Network slowdown or API rate-limiting
- Wait 5 minutes and retry
- Check internet connection
- If persistent: Bandcamp/Qobuz API may be down (check their status)

### "File permission denied in data/"
- Linux: `sudo chown -R roon-wishlist:roon-wishlist /var/lib/roon-wishlist`
- Windows: Run PowerShell as Administrator, right-click folder → Properties → Security

---

## What's NOT Tested (Known Limitations)

❌ **Tag write-back (Roon → Wishlist)** 
- Not possible: Roon SDK Browse API is read-only
- See: ROON_API_LIMITATIONS.md

❌ **Track-level tagging**
- Roon API only supports album-level browse
- Track tagging is not exposed to extensions

❌ **Multiple Roon Cores**
- Extension connects to one Core only
- Tested with single-core setups

❌ **Custom metadata fields**
- Would require Roon SDK enhancement
- Not available in current API version

---

## Version Information

- **Tested with:** Node.js v18.13+ (LTS)
- **Roon:** Core 1.8+ (compatibility with Browse API)
- **OS:** Linux (Debian), Windows 11 (WSL2 recommended)
- **Database:** File-based JSON (data/wishlist.json)

---

## Next Steps

After testing locally:

1. **Review findings** in GitHub issue #6 (Unit Tests)
2. **Deploy to production** using systemd service (Linux) or Task Scheduler (Windows)
3. **Monitor logs** for errors in first week
4. **File issues** if you find bugs: https://github.com/Zesseth/RoonWishlist/issues

---

**Questions?** Check the README.md or open an issue on GitHub.

**Happy testing!** 🎵
