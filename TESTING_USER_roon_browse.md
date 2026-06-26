# User Testing Guide - Roon Browse Integration

This guide helps you manually test the Roon browse integration features in the `feat/roon-browse-integration` branch.

---

## Before You Start

### 1. Install and Run the Extension

**Use the installer scripts** (recommended for Linux servers):

```bash
# Fully automatic - clones, installs, and runs everything
curl -fsSL https://raw.githubusercontent.com/Zesseth/RoonWishlist/feat/roon-browse-integration/bootstrap.sh \
  | sudo REPO_BRANCH=feat/roon-browse-integration bash

# If you want the web UI accessible from other devices on your LAN:
curl -fsSL https://raw.githubusercontent.com/Zesseth/RoonWishlist/feat/roon-browse-integration/bootstrap.sh \
  | sudo REPO_BRANCH=feat/roon-browse-integration bash -s --web
```

**OR manual installation:**

```bash
# Clone the repository
git clone https://github.com/Zesseth/RoonWishlist.git
cd RoonWishlist

# Switch to the browse integration branch
git checkout feat/roon-browse-integration

# Run the installer
sudo ./install.sh          # Localhost only
# OR for LAN access:
sudo ./install.sh --web
```

The extension will be available at: http://localhost:3141 (or your server IP if using --web)

### 2. Pair with Roon

1. Open Roon
2. Go to **Settings -> Extensions**
3. Find **Wishlist** and click **Enable**
4. Verify: Status chip in Web UI shows "Paired with Roon"

---

## Feature Tests

### Test 1: Add Album Directly from Roon Browse UI

**What changed:** New Browse Action allows adding albums directly from Roon without using the web UI.

**Prerequisites:**
- Roon browse API must be paired and available
- User must be viewing an album in Roon

**Steps:**
1. Open Roon
2. Navigate to any album (Browse -> your library)
3. Select an album to view its details page
4. Look for an action menu or context menu (typically "..." or right-click)
5. **Verify:** "Add to wishlist" action is available
6. Click "Add to wishlist"
7. **Verify:** A confirmation appears ("Added to wishlist")
8. Open Web UI: http://localhost:3141
9. **Verify:** The album appears in the Wishlist section with source: "roon-browse"
10. **Verify:** Album shows artist name, album title, and "added [date]" metadata

**Expected behavior:**
- ✅ "Add to wishlist" action visible in Roon album view
- ✅ Album added to wishlist with source: "roon-browse"
- ✅ Album visible in Web UI
- ✅ No duplicates if album already on wishlist

**Results:**

---

### Test 2: Storage Locations Auto-Detection from Roon

**What changed:** Library scans now automatically use storage locations configured in Roon instead of requiring manual path entry.

**Prerequisites:**
- Roon core is paired
- Roon has at least one storage location configured in Settings -> Storage

**Steps:**
1. In Roon: Go to **Settings -> Storage**
2. **Verify:** At least one storage location is configured (e.g., `/music` or `\\NAS\\Music`)
3. In Web UI: Go to **Settings -> Library**
4. Note: Music library path field should now be optional (storage locations fetched from Roon)
5. Click **"Scan & clean now"** button
6. **Verify:** Scan completes successfully
7. Check the extension logs (console where `node index.js` is running)
8. **Verify:** Log shows "Found X storage location(s) from Roon: [list of paths]"

**Expected behavior:**
- ✅ Storage locations automatically detected from Roon
- ✅ Scan works without manual library path
- ✅ Multiple storage locations are all scanned

**Results:**

---

### Test 3: Multiple Storage Locations Support

**What changed:** Scans now work across all configured Roon storage locations, not just a single path.

**Prerequisites:**
- Roon has multiple storage locations configured
- Each location has some albums

**Steps:**
1. In Roon: Configure at least 2 storage locations with different albums
2. In Web UI: Click **"Scan & clean now"**
3. **Verify:** All albums from all storage locations are scanned
4. Check wishlist: albums that are fully FLAC should be removed
5. In Web UI: Click **"Scan low-quality albums now"** (in Settings -> Library)
6. **Verify:** Non-FLAC albums from all storage locations are added to Low-quality albums section

**Expected behavior:**
- ✅ All storage locations are scanned
- ✅ FLAC detection works across all locations
- ✅ Low-quality detection works across all locations

**Results:**

---

### Test 4: Fallback to Manual Path

**What changed:** If Roon browse API is unavailable, the extension falls back to the manual music_library_path setting.

**Prerequisites:**
- Roon browse API not paired or unavailable
- Manual library path is set in Settings

**Steps:**
1. In Web UI: Go to **Settings -> Library**
2. Set **"Music library path"** to a valid path (e.g., `/mnt/music`)
3. Click **"Save path"**
4. Ensure Roon browse API is NOT paired (or disable the extension and re-enable)
5. Click **"Scan & clean now"**
6. **Verify:** Scan uses the manual path
7. Check extension logs
8. **Verify:** Log shows "Using manual library path as fallback: [path]"

**Expected behavior:**
- ✅ Scan works with manual path when Roon API unavailable
- ✅ Appropriate fallback message in logs

**Results:**

---

### Test 5: Mixed Manual and Roon Storage

**What changed:** Manual path can still be used alongside Roon storage locations.

**Steps:**
1. In Roon: Configure 1 storage location
2. In Web UI: Set a different manual library path
3. Click **"Scan & clean now"**
4. **Verify:** Both Roon storage location AND manual path are scanned
5. Check logs for confirmation of multiple paths being scanned

**Expected behavior:**
- ✅ Both Roon storage and manual path are used
- ✅ No conflicts between paths

**Results:**

---

## Current Known Issues

None identified yet for this branch.

---

## Success Criteria Checklist

### Browse Integration
- [ ] "Add to wishlist" action visible in Roon album view
- [ ] Album added with source: "roon-browse"
- [ ] No duplicates when adding already existing album
- [ ] Status message confirms addition

### Storage Locations
- [ ] Storage locations auto-detected from Roon
- [ ] Multiple storage locations all scanned
- [ ] Manual path fallback works when Roon API unavailable
- [ ] Logs show storage location detection

### Multi-Location Scans
- [ ] Scan & clean works across all storage locations
- [ ] Low-quality scan works across all storage locations
- [ ] FLAC detection correct across all locations
- [ ] No errors with multiple paths

---

## Troubleshooting

### "Add to wishlist" action not visible in Roon
1. Verify Roon browse API is paired: Extension should show "Paired with Roon" in Web UI
2. Check extension logs for browse service initialization
3. Try disabling and re-enabling the extension in Roon
4. Ensure you're viewing an album (not track or artist) - action only appears at album level

### Storage locations not detected
1. Verify Roon has storage locations configured: Settings -> Storage in Roon
2. Check extension logs for "Found X storage location(s) from Roon"
3. If using Docker/container, ensure the extension has access to Roon's browse API
4. Try restarting both Roon and the extension

### Scan fails with "No storage locations available"
1. Check if Roon browse API is paired
2. Verify manual library path is set if Roon API unavailable
3. Check logs for detailed error messages
4. Ensure the storage paths exist and are accessible

### Multiple paths cause duplicate albums
1. Verify albums are actually different (same album might exist in multiple locations)
2. This is expected behavior - each location is scanned independently
3. Deduplication happens at wishlist level based on artist/title matching

---

*Last updated: 2026-06-26*
*Branch: feat/roon-browse-integration*
