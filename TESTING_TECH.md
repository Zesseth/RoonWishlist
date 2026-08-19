# Technical Tests - RoonWishlist

Automated unit tests plus API-level tests for verifying the source-based wishlist
separation. Run these on a server to validate the backend.

---

## Automated unit tests

```bash
npm ci
npm test          # node --test
npm run test:watch
```

**147 tests total**, roughly 1–2 seconds.

### `test/wishlist.test.js` — 26 tests

Pure unit tests, no network. ~20 ms.

| Group | Tests | Covers |
|---|---|---|
| `add()` | 7 | duplicate detection, normalization, `buyLinks` filtering |
| `remove()` | 4 | case-insensitive removal |
| `getAll()` | 3 | array isolation, retrieval |
| `upsert()` | 4 | update-or-insert logic |
| `replaceAll()` | 6 | bulk replace, deduplication |
| persistence | 2 | file I/O and recovery |

### `test/lossless_checker.test.js` — 33 tests

Pure unit tests against temporary fixture directories; no network, no Roon.

| Group | Tests | Covers |
|---|---|---|
| format detection | 4 | every lossless container counts, `.m4a` stays lossy, case insensitivity |
| `classifyAlbumFolder()` | 6 | `owned-lossless` / `owned-mixed` / `owned-lossy` / `not-audio` |
| `normalizeLocations()` | 3 | strings, Roon objects, blanks and duplicates |
| `scanLibraries()` | 3 | multiple roots, per-location counts, a missing root |
| `mergeAlbumsAcrossLocations()` | 2 | best copy wins, duplicates collapse |
| `checkAndClean()` | 7 | removal rules and the kept-with-reason reporting |
| persisted `lastCheck` | 4 | status written to the entry, no write when unchanged, survives a module without `upsert()` |
| `scanLowQualityAlbums()` | 4 | what gets added, the ignore list, recorded quality |

### `test/roon_tag_sync.test.js` — 21 tests

Stubbed Roon browse tree (Library -> Tags -> Wishlist -> Albums); no Roon core.

| Group | Tests | Covers |
|---|---|---|
| `listTaggedAlbumsDetailed()` | 7 | all three shapes of an empty tag read as empty; a missing browse service still throws |
| `syncTaggedAlbums()` | 6 | adds, removes on untag, clears an emptied tag, never touches manual entries |
| `reconcileOnStartup()` | 3 | the same removal rule on startup, and no action without browse |
| `probeTagWriteSupport()` | 5 | reports the actions Roon offers on an album, spots a tag action if one ever appears, never guesses |

### `test/owned_tagged.test.js` — 15 tests

Tagged albums the user already owns in lossless (issue #32). Temporary fixture
directories, no Roon.

| Group | Tests | Covers |
|---|---|---|
| `classifyWantedAlbums()` | 3 | only the wanted folders are opened, absent albums, nothing wanted |
| `markOwnedTaggedAlbums()` | 9 | flags a fully lossless copy, ignores lossy and mixed, clears a stale flag, skips non-tag entries, never deletes, refuses to conclude anything with no readable location, matches an `Artist - Album` folder |
| `checkAndClean()` with tags | 3 | a tagged album is flagged not removed, a scanned one is still removed, stale flags cleared |

### `test/scan_locations.test.js` — 35 tests

| Group | Tests | Covers |
|---|---|---|
| `looksLikeFilesystemPath()` | 3 | POSIX, Windows and UNC paths; display-only labels rejected |
| `extractRoonPaths()` | 4 | path in subtitle or title, unusable entries skipped |
| `splitManualPaths()` | 5 | single path, semicolon/newline separators, commas kept |
| `resolveScanLocations()` | 9 | Roon locations, manual fallback, several manual paths, dedupe, exclusions |
| `toggleExclusion()` | 4 | add, remove, no duplicates, blank input |
| `validateLocations()` | 4 | readable dir, missing dir, a file, mixed input |
| `removeManualPath()` | 6 | drops a typed path, canonical matching, null for a path that is not manual |

### `test/roon_storage.test.js` — 8 tests

Covers `getStorageLocationsDetailed()` against a stubbed Browse service: reading
storage entries, the path arriving in either `subtitle` or `title`, header rows being
skipped, and — the point of the diagnostic — telling `not-paired`, `not-exposed`,
`empty` and `error` apart instead of returning a bare empty list for all four. Also
asserts it never throws, since the caller has to be able to fall back to the manual
path.

### `test/search.test.js` — 9 tests

Covers `searchBandcamp()`, `searchQobuz()` and `searchAll()`: valid queries, empty
input, artist-only input, and result combination.

> **These are integration tests — they call the real Bandcamp and Qobuz APIs.**
> They can fail for reasons unrelated to your change: rate limiting, throttling or a
> provider outage. If they fail, wait a few minutes and retry before investigating.
> Mocked HTTP tests are not implemented yet.

---

## Environment variables

All are optional. Set them in the systemd unit or the shell that starts `node index.js`.

```bash
# Data directory (default: ./data/)
ROON_WISHLIST_DATA_DIR="/var/lib/roon-wishlist"

# HTTP bind address (default: 127.0.0.1; use 0.0.0.0 to expose on the LAN)
ROON_WISHLIST_HTTP_HOST="0.0.0.0"

# HTTP port (default: 3141)
ROON_WISHLIST_HTTP_PORT=3141

# Qobuz app ID for search (optional; built-in fallbacks are used if unset)
ROON_WISHLIST_QOBUZ_APP_ID="your_app_id"

# Roon extension identity. Change these ONLY to run a second, parallel instance --
# two processes sharing one extension id fight over the Roon pairing.
ROON_WISHLIST_EXTENSION_ID="com.zesseth.roon-wishlist"
ROON_WISHLIST_DISPLAY_NAME="Wishlist"
```

That is the complete list. There is currently **no** log-level or music-path
environment variable — configurable logging is tracked in
[issue #8](https://github.com/Zesseth/RoonWishlist/issues/8), and the music library
path comes from Roon or from Settings, not from the environment.

---

## Not covered by tests

| Area | Why |
|---|---|
| Tag write-back (wishlist → Roon) | Believed impossible; the Roon Browse API exposes no tag writes. `GET /roon-tag/write-support` measures this against the live Core instead of assuming it. See [`ROON_API_LIMITATIONS.md`](./ROON_API_LIMITATIONS.md) |
| Track-level tagging | Roon exposes album-level browse only |
| Multiple Roon Cores | The extension pairs with a single Core |
| Reading storage locations from Roon | `src/roon_storage.js` needs a live Browse service; only the parsing of its output is unit tested |

---

## Prerequisites for the API tests below

1. **Run the branch you want to test** (not necessarily `main`):
   ```bash
   npm ci
   node index.js
   ```

2. **Clear test data before starting:**
   ```bash
   rm -rf data/wishlist.json data/ignored-low-quality.json
   ```

3. **Install jq** (for JSON parsing in tests):
   ```bash
   # Debian/Ubuntu
   sudo apt-get install -y jq

   # macOS
   brew install jq
   ```

4. **Define the `seed` helper.** There is deliberately no "add an album" API: the
   wishlist is derived from Roon tags and from the library scan, never typed in by
   hand (issue #32). Tests that need a starting state therefore write the store
   directly. Stop the extension first — it caches the file by mtime.
   ```bash
   seed() {
     node -e '
       const fs = require("fs");
       const path = process.env.ROON_WISHLIST_DATA_DIR || "data";
       fs.mkdirSync(path, { recursive: true });
       const file = path + "/wishlist.json";
       const all = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : [];
       const album = JSON.parse(process.argv[1]);
       album.addedAt = album.addedAt || new Date().toISOString();
       album.source = album.source || "roon-tag";
       all.push(album);
       fs.writeFileSync(file, JSON.stringify(all, null, 2));
     ' "$1"
   }
   ```

---

## Test 1: Source Field Assignment

Verify that albums get the correct source field when added through different methods.

```bash
# Clear existing data
rm -rf data/wishlist.json

# Test 1a: An album with no source is treated as tag-derived
echo "=== Test 1a: Album with no source ==="
seed '{"artist": "Legacy Artist", "title": "Legacy Album", "source": null}'

curl http://localhost:3141/wishlist/roon-tag | jq '.[] | select(.artist == "Legacy Artist") | {artist, title}'
# Expected: the album appears — rows written before `source` existed came from the tag.

# Test 1b: Roon-tag album (simulated)
echo "=== Test 1b: Roon-tag album ==="
seed '{"artist": "Roon Artist", "title": "Roon Album", "source": "roon-tag"}'

curl http://localhost:3141/wishlist | jq '.[] | select(.artist == "Roon Artist") | {artist, title, source}'
# Expected: {"artist": "Roon Artist", "title": "Roon Album", "source": "roon-tag"}

# Test 1c: Low-quality album (simulated)
echo "=== Test 1c: Low-quality album ==="
seed '{"artist": "Low Quality Artist", "title": "Low Quality Album", "source": "low-quality"}'

curl http://localhost:3141/wishlist | jq '.[] | select(.artist == "Low Quality Artist") | {artist, title, source}'
# Expected: {"artist": "Low Quality Artist", "title": "Low Quality Album", "source": "low-quality"}
```

---

## Test 2: API Endpoints Filter by Source

Verify that the new endpoints return only albums with the correct source.

```bash
# Clear existing data
rm -rf data/wishlist.json

# Add test albums with different sources
echo "=== Adding test albums ==="
seed '{"artist": "Roon", "title": "Album2", "source": "roon-tag"}'

seed '{"artist": "LowQual", "title": "Album3", "source": "low-quality"}'

seed '{"artist": "Owned", "title": "Album4", "source": "roon-tag", "ownedLossless": true}'

# Test 2a: /wishlist returns all albums
echo "=== Test 2a: /wishlist (all albums) ==="
curl http://localhost:3141/wishlist | jq '.[] | {artist, source}'
# Expected: 3 albums with sources: roon-tag, low-quality, roon-tag

# Test 2b: /wishlist/roon-tag returns only what is still worth buying
echo "=== Test 2b: /wishlist/roon-tag ==="
curl http://localhost:3141/wishlist/roon-tag | jq '.[] | {artist, title, source}'
# Expected: only "Roon". "Owned" is tagged too, but already held in lossless.

# Test 2b2: /wishlist/owned-lossless returns the already-owned tagged albums
echo "=== Test 2b2: /wishlist/owned-lossless ==="
curl http://localhost:3141/wishlist/owned-lossless | jq '.[] | {artist, title}'
# Expected: only "Owned"

# Test 2c: /wishlist/low-quality returns only low-quality
echo "=== Test 2c: /wishlist/low-quality ==="
curl http://localhost:3141/wishlist/low-quality | jq '.[] | {artist, title, source}'
# Expected: 1 album with source: low-quality

# Test 2d: Verify counts
echo "=== Test 2d: Verify counts ==="
echo "Total albums:"
curl http://localhost:3141/wishlist | jq 'length'
# Expected: 3

echo "Roon-tag albums still wanted:"
curl http://localhost:3141/wishlist/roon-tag | jq 'length'
# Expected: 1

echo "Roon-tag albums already owned:"
curl http://localhost:3141/wishlist/owned-lossless | jq 'length'
# Expected: 1

echo "Low-quality albums:"
curl http://localhost:3141/wishlist/low-quality | jq 'length'
# Expected: 1
```

---

## Test 3: Source Field Persistence

Verify that source field persists through operations.

```bash
# Clear existing data
rm -rf data/wishlist.json

# Add album with source
echo "=== Test 3a: Add with source ==="
seed '{"artist": "Test", "title": "Persistence", "source": "roon-tag"}'

# Restart the extension (simulates server restart)
echo "=== Test 3b: Restart and verify persistence ==="
# In another terminal: Ctrl+C, then node index.js again
# Or: pkill -f "node index.js" && node index.js

sleep 2
curl http://localhost:3141/wishlist/roon-tag | jq '.[] | select(.artist == "Test") | {source}'
# Expected: {"source": "roon-tag"}
```

---

## Test 4: Quality Metadata Only in Low-Quality Albums

Verify that quality metadata (qualityFlacTracks, qualityTotalTracks) only appears in low-quality source albums.

```bash
# Clear existing data
rm -rf data/wishlist.json

# Add albums with and without quality metadata
echo "=== Test 4a: Add albums with quality metadata ==="
seed '{"artist": "Test Artist", "title": "Test Album", "source": "low-quality", "qualityFlacTracks": 5, "qualityTotalTracks": 10}'

seed '{"artist": "Roon Artist", "title": "Roon Album", "source": "roon-tag"}'

# Test 4b: Verify low-quality album has quality metadata
echo "=== Test 4b: Low-quality album quality metadata ==="
curl http://localhost:3141/wishlist/low-quality | jq '.[] | select(.artist == "Test Artist") | {hasQuality: (.qualityFlacTracks != null and .qualityTotalTracks != null), flacTracks: .qualityFlacTracks, totalTracks: .qualityTotalTracks}'
# Expected: {"hasQuality": true, "flacTracks": 5, "totalTracks": 10}

# Test 4c: Verify roon-tag album has NO quality metadata
echo "=== Test 4c: Roon-tag album quality metadata ==="
curl http://localhost:3141/wishlist/roon-tag | jq '.[] | select(.artist == "Roon Artist") | {hasQuality: (.qualityFlacTracks != null and .qualityTotalTracks != null)}'
# Expected: {"hasQuality": false}
```

---

## Test 5: Ignore Functionality for Low-Quality Albums

Verify that ignore works only for low-quality albums and removes them from wishlist.

```bash
# Clear existing data
rm -rf data/wishlist.json data/ignored-low-quality.json

# Add a low-quality album with quality metadata
echo "=== Test 5a: Add low-quality album ==="
seed '{"artist": "Ignore Test", "title": "Ignore Album", "source": "low-quality", "qualityFlacTracks": 3, "qualityTotalTracks": 8}'

# Verify it's in low-quality wishlist
echo "=== Test 5b: Verify album in low-quality wishlist ==="
curl http://localhost:3141/wishlist/low-quality | jq '.[] | select(.artist == "Ignore Test") | {artist, title}'
# Expected: {"artist": "Ignore Test", "title": "Ignore Album"}

# Ignore the album
echo "=== Test 5c: Ignore the album ==="
curl -X POST http://localhost:3141/ignore-low-quality \
  -H "Content-Type: application/json" \
  -d '{"artist": "Ignore Test", "title": "Ignore Album"}'

# Verify it's removed from low-quality wishlist
echo "=== Test 5d: Verify album removed ==="
curl http://localhost:3141/wishlist/low-quality | jq '.[] | select(.artist == "Ignore Test") | {artist, title}'
# Expected: No output (empty)

# Verify it's in ignored list
cat data/ignored-low-quality.json | jq '.'
# Expected: [{"artist": "Ignore Test", "title": "Ignore Album"}]
```

---

## Test 6: Roon Tag Sync Adds with Correct Source

**Note:** This test requires a paired Roon core with browse API access.

```bash
# Clear existing data
rm -rf data/wishlist.json

# Manually tag an album in Roon with "Wishlist" tag
# Then run sync:
echo "=== Test 6a: Run Roon tag sync ==="
curl -X POST http://localhost:3141/sync-roon-tag

# Verify synced album has correct source
echo "=== Test 6b: Verify source ==="
curl http://localhost:3141/wishlist/roon-tag | jq '.[] | {artist, title, source}'
# Expected: Synced albums have source: "roon-tag"
```

---

## Test 7: Low-Quality Scan Adds with Correct Source

**Note:** This test requires a configured music library path.

```bash
# Clear existing data
rm -rf data/wishlist.json

# Set library path
curl -X POST http://localhost:3141/settings \
  -H "Content-Type: application/json" \
  -d '{"music_library_path": "/tmp/test-library"}'

# Create test library with non-FLAC files
mkdir -p /tmp/test-library/TestArtist/TestAlbum
touch /tmp/test-library/TestArtist/TestAlbum/track1.mp3
touch /tmp/test-library/TestArtist/TestAlbum/track2.mp3

# Run low-quality scan
echo "=== Test 7a: Run low-quality scan ==="
curl -X POST http://localhost:3141/scan-low-quality

# Verify scanned album has correct source
echo "=== Test 7b: Verify source ==="
curl http://localhost:3141/wishlist/low-quality | jq '.[] | {artist, title, source, qualityFlacTracks, qualityTotalTracks}'
# Expected: Album with source: "low-quality", qualityFlacTracks: 0, qualityTotalTracks: 2

# Clean up
rm -rf /tmp/test-library
```

---

## Test 8: Mixed Source Scenario

Test interactions between different source types.

```bash
# Clear existing data
rm -rf data/wishlist.json

# Add albums from different sources
echo "=== Test 8a: Add mixed source albums ==="
seed '{"artist": "Artist1", "title": "Album1", "source": "roon-tag", "ownedLossless": true}'

seed '{"artist": "Artist2", "title": "Album2", "source": "roon-tag"}'

seed '{"artist": "Artist3", "title": "Album3", "source": "low-quality", "qualityFlacTracks": 2, "qualityTotalTracks": 5}'

# Test 8b: Verify separation
echo "=== Test 8b: Verify endpoint separation ==="
echo "Already-owned tagged albums:"
curl http://localhost:3141/wishlist/owned-lossless | jq 'length'
# Expected: 1

echo "Roon-tag albums still wanted:"
curl http://localhost:3141/wishlist/roon-tag | jq 'length'
# Expected: 1

echo "Low-quality albums:"
curl http://localhost:3141/wishlist/low-quality | jq 'length'
# Expected: 1

# Test 8c: Remove from one endpoint doesn't affect others
echo "=== Test 8c: Remove from wishlist ==="
curl -X POST http://localhost:3141/wishlist/remove \
  -H "Content-Type: application/json" \
  -d '{"artist": "Artist1", "title": "Album1"}'

# Verify it's removed from all endpoints
echo "Already-owned tagged albums after remove:"
curl http://localhost:3141/wishlist/owned-lossless | jq 'length'
# Expected: 0 (it comes back on the next sync — Roon is the master)
```

---

## Expected Results Summary

| Test | Endpoint | Expected Result |
|------|----------|-----------------|
| 1a-1c | `seed` helper | Albums created with correct source |
| 2a | /wishlist | Returns all albums |
| 2b | /wishlist/roon-tag | Returns tagged albums not already owned in lossless |
| 2b2 | /wishlist/owned-lossless | Returns tagged albums already owned in lossless |
| 2c | /wishlist/low-quality | Returns only low-quality albums |
| 3 | Persistence | Source field persists after restart |
| 4 | Quality metadata | Only in low-quality albums |
| 5 | Ignore | Removes from wishlist, adds to ignore list |
| 6 | Roon sync | Adds with source: roon-tag |
| 7 | Low-quality scan | Adds with source: low-quality |
| 8 | Mixed sources | All endpoints return correct subsets |

---

## Test 9: Storage locations & lossless rules (issue #15)

These exercise the API surface added on `feat/roon-storage-locations`. They need no
Roon core: with no Roon pairing the extension falls back to the manual path, which is
exactly the fallback path we want covered.

### 9a. Build a fixture library

```bash
BASE=/tmp/rw-fixture
rm -rf "$BASE"; mkdir -p "$BASE"/{libA,libB}

# Fully lossless -> must be removed from the wishlist
mkdir -p "$BASE/libA/Opeth/Blackwater Park"
touch "$BASE/libA/Opeth/Blackwater Park"/0{1,2}.flac

# Lossless but not FLAC -> must also be removed
mkdir -p "$BASE/libA/Miles Davis/Kind of Blue"
touch "$BASE/libA/Miles Davis/Kind of Blue"/01.wav "$BASE/libA/Miles Davis/Kind of Blue"/02.aiff

# Fully lossy -> must stay
mkdir -p "$BASE/libA/Portishead/Dummy"
touch "$BASE/libA/Portishead/Dummy"/0{1,2}.mp3

# Part lossless -> must stay (the key regression this issue fixes)
mkdir -p "$BASE/libA/Tool/Lateralus"
touch "$BASE/libA/Tool/Lateralus"/01.flac "$BASE/libA/Tool/Lateralus"/02.mp3

# Second location holding a lossless copy of the lossy album above
mkdir -p "$BASE/libB/Portishead/Dummy"
touch "$BASE/libB/Portishead/Dummy"/0{1,2}.flac
```

### 9b. Point the extension at it

```bash
API=http://localhost:3142      # the test instance; use 3141 for a normal install

curl -s -X POST $API/settings -H 'Content-Type: application/json' \
  -d '{"music_library_path":"/tmp/rw-fixture/libA"}' | jq

curl -s $API/storage-locations | jq
```

**Expect:** `active` contains `/tmp/rw-fixture/libA`, `usedFallback` is `true` (no Roon
location), and `unreadable` is empty.

### 9c. Refuse to scan when there is nothing to scan

```bash
curl -s -X POST $API/settings -H 'Content-Type: application/json' \
  -d '{"music_library_path":""}' | jq
curl -s -X POST $API/check-lossless | jq
```

**Expect:** HTTP 400 with a message saying no storage location is available — **not**
an empty successful scan. An empty scan would report "you own nothing", which for the
clean action silently keeps everything.

Restore the path afterwards with the command from 9b.

### 9d. The removal rule

```bash
for a in "Opeth|Blackwater Park" "Miles Davis|Kind of Blue" \
         "Portishead|Dummy" "Tool|Lateralus" "Nobody|Nothing"; do
  seed "{\"artist\":\"${a%%|*}\",\"title\":\"${a##*|}\"}" > /dev/null
done

curl -s -X POST $API/check-lossless | jq '{
  removed: [.removedFromWishlist[] | {artist, title}],
  kept:    [.keptOnWishlist[]      | {artist, status, reason}]
}'
```

**Expect:**

| Album | Outcome | Why |
|---|---|---|
| Opeth — Blackwater Park | removed | every track FLAC |
| Miles Davis — Kind of Blue | removed | every track WAV/AIFF, still lossless |
| Portishead — Dummy | kept, `owned-lossy` | no lossless tracks |
| Tool — Lateralus | kept, `owned-mixed` | only partly lossless |
| Nobody — Nothing | kept, `not-found` | not in the library |

### 9e. Exclusions

```bash
curl -s -X POST $API/storage-locations/exclude -H 'Content-Type: application/json' \
  -d '{"path":"/tmp/rw-fixture/libA","excluded":true}' | jq '{excluded, active}'

curl -s -X POST $API/check-lossless | jq
```

**Expect:** `active` becomes empty, and the scan returns HTTP 400 "Every storage
location is excluded…". Re-include it:

```bash
curl -s -X POST $API/storage-locations/exclude -H 'Content-Type: application/json' \
  -d '{"path":"/tmp/rw-fixture/libA","excluded":false}' | jq '{excluded, active}'
```

### 9f. Two locations, best copy wins

The manual override accepts several folders separated by a semicolon, so this works
even when Roon reports no storage at all.

```bash
curl -s -X POST $API/settings -H 'Content-Type: application/json' \
  -d '{"music_library_path":"/tmp/rw-fixture/libA; /tmp/rw-fixture/libB"}' > /dev/null

curl -s $API/storage-locations | jq '.active'

seed '{"artist":"Portishead","title":"Dummy"}' > /dev/null

curl -s -X POST $API/check-lossless | jq '[.removedFromWishlist[] | .artist]'
```

**Expect:** `active` lists **both** folders, and the result is `["Portishead"]` — a
lossless copy in *any* scanned location counts as owned, even though `libA` holds only
MP3s of the same album.

### 9f2. An unreadable location is reported, not silently treated as empty

```bash
curl -s -X POST $API/settings -H 'Content-Type: application/json' \
  -d '{"music_library_path":"/tmp/rw-fixture/libA; /mnt/definitely-not-mounted"}' > /dev/null

curl -s $API/storage-locations | jq '{active, unreadable}'
curl -s -X POST $API/check-lossless | jq '.scanLocations'
```

**Expect:** `unreadable` names the missing path with a reason, and `scanLocations`
contains only the readable folder — the scan degrades to what it can actually read
instead of reporting an empty library. An unmounted share must never be indistinguishable
from "you own no albums".

### 9g. Running two instances side by side

```bash
curl -s http://localhost:3141/status | jq '{extensionId, displayName}'
curl -s http://localhost:3142/status | jq '{extensionId, displayName}'
```

**Expect:** different `extensionId` values. Identical ids mean the two processes will
fight over the Roon pairing, and one of them will keep dropping out.

---

## Clean Up

```bash
# Remove all test data
rm -rf data/wishlist.json data/ignored-low-quality.json

# Optional: Remove test library
rm -rf /tmp/test-library /tmp/rw-fixture
```

---

*Last updated: 2026-08-19*
*Branch: `main` (issue #15 tests: `feat/roon-storage-locations`)*
