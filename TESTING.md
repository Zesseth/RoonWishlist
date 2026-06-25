# Testing Guide - RoonWishlist

> **This branch:** `test/unit-tests` - Contains all testable features + unit tests

## Quick Start

```bash
# 1. Checkout this branch
git checkout test/unit-tests

# 2. Install dependencies
npm ci

# 3. Run all tests
npm test
```

---

## Test Categories

### 1. Unit Tests (Automated)

**Module:** `src/wishlist.js`  
**File:** `test/wishlist.test.js`  
**Tests:** 17 tests covering CRUD operations  
**Command:** `npm test`

| Function | Tests | Coverage |
|----------|-------|----------|
| `add()` | 7 tests | Adding, duplicates, case-insensitivity, whitespace, buyLinks |
| `remove()` | 4 tests | Removal, non-existent, case-insensitivity |
| `getAll()` | 3 tests | Empty, array copy, all items |
| `upsert()` | 4 tests | Add new, update existing, unchanged, preserve timestamps |
| `replaceAll()` | 6 tests | Full replace, deduplication, empty input, null handling |
| Persistence | 2 tests | File writing, reloading |

**Expected Output:**
```
✔ wishlist module
  ✔ add() (7 tests)
  ✔ remove() (4 tests)
  ✔ getAll() (3 tests)
  ✔ upsert() (4 tests)
  ✔ replaceAll() (6 tests)
  ✔ data persistence (2 tests)

ℹ tests 17
ℹ suites 7
ℹ pass 17
ℹ fail 0
```

---

### 2. Feature Tests (Manual)

#### Feature: Low-Quality Library Scan

**What it does:** Scans your music library for albums that are NOT fully FLAC and adds them to the wishlist.

**How to test:**

1. **Set your music library path in Settings:**
   - In Roon: Go to **Settings → Extensions → Wishlist → Settings**
   - Set "Music library path (FLAC detection)" to your library root folder
   - Example: `/mnt/music` or `C:\Music`

2. **Run the scan via Roon Settings:**
   - In the same Settings screen, select "Scan low-quality albums into wishlist" from the Action dropdown
   - Press Save
   - Expected: Albums that are NOT fully FLAC appear in your wishlist

3. **Run the scan via HTTP API:**
   ```bash
   curl -X POST http://localhost:3141/scan-low-quality
   ```
   - Expected: JSON response with `added`, `alreadyPresent`, `ignored` counts

4. **Verify results in Web UI:**
   - Open: http://localhost:3141
   - Check the "Low-Quality Albums" section
   - Expected: Each album shows "FLAC x/y" track count

5. **Test ignore functionality:**
   ```bash
   # Ignore a specific album
   curl -X POST http://localhost:3141/ignore-low-quality \
     -H "Content-Type: application/json" \
     -d '{"artist": "Test Artist", "title": "Test Album"}'
   ```
   - Run scan again
   - Expected: Ignored album does NOT reappear in wishlist

**Success Criteria:**
- [ ] Scan completes without errors
- [ ] Non-FLAC albums appear in wishlist with track counts
- [ ] Fully FLAC albums are NOT added
- [ ] Ignore list prevents re-adding

---

#### Feature: Store Links Fix (Bandcamp/Qobuz Search)

**What changed:** Improved search using official APIs instead of HTML scraping.

**How to test:**

1. **Search via HTTP API:**
   ```bash
   curl "http://localhost:3141/search?artist=Test%20Artist&title=Test%20Album"
   ```
   - Expected: JSON response with Bandcamp and Qobuz results
   - Expected: Results have `store`, `title`, `artist`, `url` fields

2. **Find album in stores via Web UI:**
   - Open: http://localhost:3141
   - Go to "Low-quality albums" section
   - Click "Find in stores" for an album
   - Expected: Search results from Bandcamp and Qobuz appear

3. **Verify buy links persist:**
   - Refresh the page
   - Check the wishlist
   - Expected: Buy link icon/button appears for the album

**Success Criteria:**
- [ ] Search returns results from both Bandcamp and Qobuz
- [ ] Results have valid URLs
- [ ] Buy links are stored with wishlist items
- [ ] Links persist after restart

---

#### Feature: Roon Tag Sync

**What it does:** Syncs albums tagged with "Wishlist" in Roon to the app's wishlist.

**Prerequisites:**
- Roon core paired with the extension
- Browse API enabled (optional service in `index.js`)

**How to test:**

1. **Tag an album in Roon:**
   - In Roon, find an album
   - Tag it with "Wishlist" (case-sensitive)

2. **Sync via HTTP API:**
   ```bash
   curl -X POST http://localhost:3141/sync-roon-tag
   ```
   - Expected: JSON response with `added`, `updated`, `totalTaggedAlbums` counts

3. **Verify in Web UI:**
   - Open: http://localhost:3141
   - Expected: Tagged album appears in wishlist

4. **Test rebuild from Roon tag:**
   ```bash
   curl -X POST http://localhost:3141/rebuild-from-roon-tag
   ```
   - Expected: Wishlist cleared and rebuilt from Roon tags only

**Success Criteria:**
- [ ] Tagged albums sync to wishlist
- [ ] Buy links are fetched for tagged albums
- [ ] Rebuild clears existing wishlist first

---

#### Feature: Web UI Navigation

**What changed:** Dedicated views for Wishlist, Add Album, and Settings.

**How to test:**

1. **Open Web UI:** http://localhost:3141

2. **Test navigation:**
   - Click "Wishlist" in top-left menu
   - Expected: Shows albums tagged with "Wishlist" in Roon
   - Click "Low-quality albums"
   - Expected: Shows non-FLAC albums from your library
   - Click "Settings"
   - Expected: Shows settings page
   - Click "Wishlist" header
   - Expected: Returns to home view

3. **Test settings persistence:**
   - Go to Settings
   - Set music library path
   - Save
   - Refresh page
   - Expected: Path is preserved

**Success Criteria:**
- [ ] All menu items work
- [ ] Navigation doesn't break
- [ ] Settings persist across page reloads
- [ ] "Wishlist" section shows only Roon-tagged albums
- [ ] "Low-quality albums" section shows non-FLAC albums with find/ignore options 


---

## Full Test Suite

### Run All Automated Tests
```bash
npm test
```

### Run Tests in Watch Mode (auto-reload on changes)
```bash
npm run test:watch
```

---

## Manual Integration Tests

### 1. Extension Loads in Roon
```bash
# Start the extension
node index.js
```
- Open Roon
- Go to Settings → Extensions
- Expected: "Wishlist" extension appears and shows "Paired" status

### 2. Native Settings Menu Works
- In Roon: Settings → Extensions → Wishlist → Settings
- Expected: Menu loads with Wishlist, Actions, Music library path, Low-quality scan
- Try: Run scan or clean via native menu
- Expected: Operation completes successfully

### 3. Auto-Clean Works
1. Add an album to wishlist (via Web UI or Settings)
2. Place a fully FLAC version of that album in your library
3. Run: `curl -X POST http://localhost:3141/check-lossless`
4. Expected: Album is removed from wishlist

---

## Test Data Setup

For testing without a real music library, you can create a test structure:

```bash
# Create test library
mkdir -p /tmp/test-library/Artist1/Album1
mkdir -p /tmp/test-library/Artist2/Album2

# Add some FLAC files (will be auto-removed from wishlist)
touch /tmp/test-library/Artist1/Album1/track1.flac

# Add some MP3 files (will trigger low-quality scan)
touch /tmp/test-library/Artist2/Album2/track1.mp3
```

Then set music library path to `/tmp/test-library` in Settings.

---

## Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `ROON_WISHLIST_DATA_DIR` | Custom data directory | `./data` |
| `ROON_WISHLIST_HTTP_HOST` | HTTP bind address | `127.0.0.1` |
| `ROON_WISHLIST_HTTP_PORT` | HTTP port | `3141` |
| `ROON_WISHLIST_QOBUZ_APP_ID` | Custom Qobuz app ID | `712109809` |

---

## Troubleshooting

### Tests fail with "Data directory not found"
**Fix:** Create the data directory:
```bash
mkdir -p data
```

### Extension doesn't pair with Roon
**Fix:**
1. Restart Roon
2. Restart the extension: `node index.js`
3. Check Roon Settings → Extensions
4. Enable the Wishlist extension

### Search returns no results
**Fix:** Check internet connection and try again. The search uses Bandcamp and Qobuz APIs.

### Low-quality scan finds no albums
**Fix:** 
1. Verify music library path is correct
2. Verify the path contains albums with non-FLAC files
3. Check folder structure: `Artist/Album/tracks.*`

---

## Test Checklist

Before reporting issues, verify:

- [ ] `npm test` passes (17 tests)
- [ ] Extension loads in Roon
- [ ] Web UI accessible at http://localhost:3141
- [ ] Music library path is set
- [ ] Low-quality scan completes
- [ ] Store search returns results
- [ ] Roon tag sync works (if paired)

---

## Expected Results Summary

| Feature | Expected Behavior |
|---------|-------------------|
| Unit tests | 17/17 pass |
| Low-quality scan | Adds non-FLAC albums to wishlist |
| Store search | Returns Bandcamp + Qobuz links |
| Tag sync | Imports Wishlist-tagged albums |
| Web UI | All pages load, navigation works |
| Auto-clean | Removes FLAC albums from wishlist |

---

## Clean Up

To reset after testing:

```bash
# Remove test data
rm -rf data/wishlist.json data/ignored-low-quality.json

# Return to main branch
git checkout main
```

---

*Last updated: 2026-06-22*  
*Branch: test/unit-tests*
