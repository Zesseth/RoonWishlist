# Technical Tests - Roon Browse Integration

Automated/technical tests for verifying the Roon browse integration and storage locations support. Run these on a server to validate the backend changes.

---

## Prerequisites

1. **Use the correct branch:**
   ```bash
   git checkout feat/roon-browse-integration
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

4. **Create test library structure:**
   ```bash
   mkdir -p /tmp/test-music-flac/Artist1/Album1
   mkdir -p /tmp/test-music-flac/Artist2/Album2
   mkdir -p /tmp/test-music-mixed/Artist3/Album3
   mkdir -p /tmp/test-music-low/Artist4/Album4
   
   # Fully FLAC album
   touch /tmp/test-music-flac/Artist1/Album1/track1.flac
   touch /tmp/test-music-flac/Artist1/Album1/track2.flac
   
   # Another fully FLAC album
   touch /tmp/test-music-flac/Artist2/Album2/track1.flac
   touch /tmp/test-music-flac/Artist2/Album2/track2.flac
   
   # Mixed album (some FLAC, some MP3)
   touch /tmp/test-music-mixed/Artist3/Album3/track1.flac
   touch /tmp/test-music-mixed/Artist3/Album3/track2.mp3
   
   # Low-quality album (all MP3)
   touch /tmp/test-music-low/Artist4/Album4/track1.mp3
   touch /tmp/test-music-low/Artist4/Album4/track2.mp3
   touch /tmp/test-music-low/Artist4/Album4/track3.mp3
   ```

---

## Test 1: Storage Locations Detection (Manual Mode)

Verify that manual storage path can be set and used.

```bash
# Clear existing data
rm -rf data/wishlist.json

# Test 1a: Set manual library path
echo "=== Test 1a: Set manual library path ==="
curl -X POST http://localhost:3141/settings \
  -H "Content-Type: application/json" \
  -d '{"music_library_path": "/tmp/test-music-flac"}'

# Verify path is saved
echo "=== Test 1b: Verify path saved ==="
curl http://localhost:3141/settings | jq '.music_library_path'
# Expected: "/tmp/test-music-flac"
```

---

## Test 2: Scan with Manual Path

Verify that scanning works with a manual library path.

```bash
# Test 2a: Add an album to wishlist first
echo "=== Test 2a: Add album to wishlist ==="
curl -X POST http://localhost:3141/wishlist/add \
  -H "Content-Type: application/json" \
  -d '{"artist": "Artist1", "title": "Album1"}'

# Test 2b: Run scan with manual path
echo "=== Test 2b: Run scan & clean ==="
curl -X POST http://localhost:3141/check-lossless

# Verify album was removed (it's fully FLAC)
echo "=== Test 2c: Verify album removed ==="
curl http://localhost:3141/wishlist | jq '[.[] | select(.artist == "Artist1")] | length'
# Expected: 0 (album was removed because it's fully FLAC)

# Test 2d: Add low-quality album to wishlist
echo "=== Test 2d: Add low-quality album ==="
curl -X POST http://localhost:3141/wishlist/add \
  -H "Content-Type: application/json" \
  -d '{"artist": "Artist4", "title": "Album4"}'

# Test 2e: Run low-quality scan
echo "=== Test 2e: Run low-quality scan ==="
curl -X POST http://localhost:3141/scan-low-quality

# Verify low-quality album not removed (it's not FLAC)
echo "=== Test 2f: Verify low-quality album not removed ==="
curl http://localhost:3141/wishlist | jq '[.[] | select(.artist == "Artist4")] | length'
# Expected: 1 (album kept because it's not fully FLAC)
```

---

## Test 3: Browse Action - Add Album from Roon (Simulated)

Verify that the Browse Action handler works by simulating an album addition via API.

```bash
# Clear existing data
rm -rf data/wishlist.json

# Test 3a: Simulate adding album via Roon browse action
echo "=== Test 3a: Add via Roon browse (simulated) ==="
curl -X POST http://localhost:3141/wishlist/add \
  -H "Content-Type: application/json" \
  -d '{"artist": "Roon Artist", "title": "Roon Album", "source": "roon-browse"}'

# Test 3b: Verify album in wishlist with correct source
echo "=== Test 3b: Verify source ==="
curl http://localhost:3141/wishlist | jq '.[] | select(.artist == "Roon Artist") | {artist, title, source}'
# Expected: {"artist": "Roon Artist", "title": "Roon Album", "source": "roon-browse"}

# Test 3c: Try to add duplicate
echo "=== Test 3c: Add duplicate ==="
curl -X POST http://localhost:3141/wishlist/add \
  -H "Content-Type: application/json" \
  -d '{"artist": "Roon Artist", "title": "Roon Album", "source": "roon-browse"}'

# Verify still only one album
echo "=== Test 3d: Verify no duplicate ==="
curl http://localhost:3141/wishlist | jq '[.[] | select(.artist == "Roon Artist")] | length'
# Expected: 1
```

---

## Test 4: Storage Locations Module

Verify that the storage locations module works correctly.

```bash
# Test 4a: Test storage location detection with mock data
echo "=== Test 4a: Test storage location utilities ==="
node -e "
const { getStorageLocations } = require('./src/roon_storage');
// Test with null browse service (should fallback to manual path)
(async () => {
  const locations = await getStorageLocations(null, '/tmp/test-music-flac');
  console.log('Fallback locations:', locations);
  console.log('Expected: [\"/tmp/test-music-flac\"]');
})();
"
# Expected: Fallback locations: [ '/tmp/test-music-flac' ]

# Test 4b: Test with empty manual path
echo "=== Test 4b: Empty manual path ==="
node -e "
const { getStorageLocations } = require('./src/roon_storage');
(async () => {
  const locations = await getStorageLocations(null, '');
  console.log('Locations with empty path:', locations);
  console.log('Expected: []');
})();
"
# Expected: Locations with empty path: []
```

---

## Test 5: Multi-Location Scan Functions

Verify that multi-location scan functions work correctly.

```bash
# Clear existing data
rm -rf data/wishlist.json

# Test 5a: Add album that exists in test-music-flac
echo "=== Test 5a: Add album that is fully FLAC ==="
curl -X POST http://localhost:3141/wishlist/add \
  -H "Content-Type: application/json" \
  -d '{"artist": "Artist1", "title": "Album1"}'

# Test 5b: Set library path to test-music-flac
echo "=== Test 5b: Set path to FLAC library ==="
curl -X POST http://localhost:3141/settings \
  -H "Content-Type: application/json" \
  -d '{"music_library_path": "/tmp/test-music-flac"}'

# Test 5c: Run check and clean
echo "=== Test 5c: Run check and clean ==="
curl -X POST http://localhost:3141/check-lossless

# Verify FLAC album removed
echo "=== Test 5d: Verify FLAC album removed ==="
curl http://localhost:3141/wishlist | jq '[.[] | select(.artist == "Artist1")] | length'
# Expected: 0

# Test 5e: Add low-quality album
echo "=== Test 5e: Add low-quality album ==="
curl -X POST http://localhost:3141/wishlist/add \
  -H "Content-Type: application/json" \
  -d '{"artist": "Artist4", "title": "Album4"}'

# Test 5f: Set path to low-quality library
echo "=== Test 5f: Set path to low-quality library ==="
curl -X POST http://localhost:3141/settings \
  -H "Content-Type: application/json" \
  -d '{"music_library_path": "/tmp/test-music-low"}'

# Test 5g: Run low-quality scan
echo "=== Test 5g: Run low-quality scan ==="
curl -X POST http://localhost:3141/scan-low-quality

# Verify low-quality album has quality metadata
echo "=== Test 5h: Verify quality metadata ==="
curl http://localhost:3141/wishlist/low-quality | jq '.[] | select(.artist == "Artist4") | {source, qualityFlacTracks, qualityTotalTracks}'
# Expected: {"source": "low-quality", "qualityFlacTracks": 0, "qualityTotalTracks": 3}
```

---

## Test 6: Multiple Library Paths (Manual Simulation)

Verify that the extension can handle multiple paths by setting them manually.

```bash
# Clear existing data
rm -rf data/wishlist.json

# Test 6a: Add albums from both locations
echo "=== Test 6a: Add albums from both locations ==="
curl -X POST http://localhost:3141/wishlist/add \
  -H "Content-Type: application/json" \
  -d '{"artist": "Artist1", "title": "Album1"}'

curl -X POST http://localhost:3141/wishlist/add \
  -H "Content-Type: application/json" \
  -d '{"artist": "Artist4", "title": "Album4"}'

# Test 6b: Set path to FLAC library and scan
echo "=== Test 6b: Scan FLAC library ==="
curl -X POST http://localhost:3141/settings \
  -H "Content-Type: application/json" \
  -d '{"music_library_path": "/tmp/test-music-flac"}'

curl -X POST http://localhost:3141/check-lossless

# Test 6c: Set path to low-quality library and scan
echo "=== Test 6c: Scan low-quality library ==="
curl -X POST http://localhost:3141/settings \
  -H "Content-Type: application/json" \
  -d '{"music_library_path": "/tmp/test-music-low"}'

curl -X POST http://localhost:3141/scan-low-quality

# Verify both scans worked
echo "=== Test 6d: Verify results ==="
echo "Wishlist count:"
curl http://localhost:3141/wishlist | jq 'length'
echo "Low-quality count:"
curl http://localhost:3141/wishlist/low-quality | jq 'length'
```

---

## Test 7: Module Exports

Verify that all required functions are exported from modules.

```bash
# Test 7a: Check roon_storage exports
echo "=== Test 7a: roon_storage exports ==="
node -e "
const storage = require('./src/roon_storage');
console.log('getRoonStorageLocations:', typeof storage.getRoonStorageLocations);
console.log('getStorageLocations:', typeof storage.getStorageLocations);
console.log('Expected: function, function');
"

# Test 7b: Check lossless_checker exports
echo "=== Test 7b: lossless_checker exports ==="
node -e "
const lossless = require('./src/lossless_checker');
console.log('checkAndClean:', typeof lossless.checkAndClean);
console.log('checkAndCleanMultiple:', typeof lossless.checkAndCleanMultiple);
console.log('scanLowQualityAlbums:', typeof lossless.scanLowQualityAlbums);
console.log('scanLowQualityAlbumsMultiple:', typeof lossless.scanLowQualityAlbumsMultiple);
console.log('scanLibrary:', typeof lossless.scanLibrary);
console.log('classifyAlbumFolder:', typeof lossless.classifyAlbumFolder);
console.log('Expected: all functions');
"
```

---

## Test 8: Source Field Handling for Browse Integration

Verify that albums added through browse integration have correct source.

```bash
# Clear existing data
rm -rf data/wishlist.json

# Test 8a: Add album with roon-browse source
echo "=== Test 8a: Add roon-browse album ==="
curl -X POST http://localhost:3141/wishlist/add \
  -H "Content-Type: application/json" \
  -d '{"artist": "Browse Artist", "title": "Browse Album", "source": "roon-browse"}'

# Test 8b: Verify source in all endpoints
echo "=== Test 8b: Verify in /wishlist ==="
curl http://localhost:3141/wishlist | jq '.[] | select(.artist == "Browse Artist") | {source}'
# Expected: {"source": "roon-browse"}

# Test 8c: Verify not in roon-tag endpoint
echo "=== Test 8c: Verify not in /wishlist/roon-tag ==="
curl http://localhost:3141/wishlist/roon-tag | jq '[.[] | select(.artist == "Browse Artist")] | length'
# Expected: 0

# Test 8d: Verify not in low-quality endpoint
echo "=== Test 8d: Verify not in /wishlist/low-quality ==="
curl http://localhost:3141/wishlist/low-quality | jq '[.[] | select(.artist == "Browse Artist")] | length'
# Expected: 0
```

---

## Expected Results Summary

| Test | Description | Expected Result |
|------|-------------|-----------------|
| 1 | Manual path set and saved | Path saved correctly |
| 2 | Scan with manual path | FLAC albums removed, low-quality kept |
| 3 | Browse action (simulated) | Album added with source: roon-browse |
| 4 | Storage locations module | Module functions work correctly |
| 5 | Multi-location scan | Scans work with single path |
| 6 | Multiple library paths | Each path scanned independently |
| 7 | Module exports | All required functions exported |
| 8 | Source field handling | roon-browse source handled correctly |

---

## Clean Up

```bash
# Remove all test data
rm -rf data/wishlist.json data/ignored-low-quality.json

# Remove test libraries
rm -rf /tmp/test-music-flac /tmp/test-music-mixed /tmp/test-music-low
```

---

## Notes

- The actual Roon Browse Action ("Add to wishlist" in Roon UI) requires a paired Roon core with browse API access. The technical tests simulate this by using the API directly.
- Storage locations auto-detection from Roon requires browse API to be paired and available. Manual path fallback is always tested.
- Multiple storage locations can be tested by configuring them in Roon Settings -> Storage.

---

*Last updated: 2026-06-26*
*Branch: feat/roon-browse-integration*
