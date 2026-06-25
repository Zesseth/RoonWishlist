# Technical Tests - RoonWishlist

Automated/technical tests for verifying the source-based wishlist separation. Run these on a server to validate the backend changes.

---

## Prerequisites

1. **Use the correct branch:**
   ```bash
   git checkout feat/ui-cleanup
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

---

## Test 1: Source Field Assignment

Verify that albums get the correct source field when added through different methods.

```bash
# Clear existing data
rm -rf data/wishlist.json

# Test 1a: Manual addition via API
echo "=== Test 1a: Manual album ==="
curl -X POST http://localhost:3141/wishlist/add \
  -H "Content-Type: application/json" \
  -d '{"artist": "Manual Artist", "title": "Manual Album"}'

curl http://localhost:3141/wishlist | jq '.[] | select(.artist == "Manual Artist") | {artist, title, source}'
# Expected: {"artist": "Manual Artist", "title": "Manual Album", "source": "manual"}

# Test 1b: Roon-tag album (simulated)
echo "=== Test 1b: Roon-tag album ==="
curl -X POST http://localhost:3141/wishlist/add \
  -H "Content-Type: application/json" \
  -d '{"artist": "Roon Artist", "title": "Roon Album", "source": "roon-tag"}'

curl http://localhost:3141/wishlist | jq '.[] | select(.artist == "Roon Artist") | {artist, title, source}'
# Expected: {"artist": "Roon Artist", "title": "Roon Album", "source": "roon-tag"}

# Test 1c: Low-quality album (simulated)
echo "=== Test 1c: Low-quality album ==="
curl -X POST http://localhost:3141/wishlist/add \
  -H "Content-Type: application/json" \
  -d '{"artist": "Low Quality Artist", "title": "Low Quality Album", "source": "low-quality"}'

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
curl -X POST http://localhost:3141/wishlist/add \
  -H "Content-Type: application/json" \
  -d '{"artist": "Manual", "title": "Album1", "source": "manual"}'

curl -X POST http://localhost:3141/wishlist/add \
  -H "Content-Type: application/json" \
  -d '{"artist": "Roon", "title": "Album2", "source": "roon-tag"}'

curl -X POST http://localhost:3141/wishlist/add \
  -H "Content-Type: application/json" \
  -d '{"artist": "LowQual", "title": "Album3", "source": "low-quality"}'

# Test 2a: /wishlist returns all albums
echo "=== Test 2a: /wishlist (all albums) ==="
curl http://localhost:3141/wishlist | jq '.[] | {artist, source}'
# Expected: 3 albums with sources: manual, roon-tag, low-quality

# Test 2b: /wishlist/roon-tag returns only roon-tag
echo "=== Test 2b: /wishlist/roon-tag ==="
curl http://localhost:3141/wishlist/roon-tag | jq '.[] | {artist, title, source}'
# Expected: 1 album with source: roon-tag

# Test 2c: /wishlist/low-quality returns only low-quality
echo "=== Test 2c: /wishlist/low-quality ==="
curl http://localhost:3141/wishlist/low-quality | jq '.[] | {artist, title, source}'
# Expected: 1 album with source: low-quality

# Test 2d: Verify counts
echo "=== Test 2d: Verify counts ==="
echo "Total albums:"
curl http://localhost:3141/wishlist | jq 'length'
# Expected: 3

echo "Roon-tag albums:"
curl http://localhost:3141/wishlist/roon-tag | jq 'length'
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
curl -X POST http://localhost:3141/wishlist/add \
  -H "Content-Type: application/json" \
  -d '{"artist": "Test", "title": "Persistence", "source": "roon-tag"}'

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
curl -X POST http://localhost:3141/wishlist/add \
  -H "Content-Type: application/json" \
  -d '{"artist": "Test Artist", "title": "Test Album", "source": "low-quality", "qualityFlacTracks": 5, "qualityTotalTracks": 10}'

curl -X POST http://localhost:3141/wishlist/add \
  -H "Content-Type: application/json" \
  -d '{"artist": "Roon Artist", "title": "Roon Album", "source": "roon-tag"}'

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
curl -X POST http://localhost:3141/wishlist/add \
  -H "Content-Type: application/json" \
  -d '{"artist": "Ignore Test", "title": "Ignore Album", "source": "low-quality", "qualityFlacTracks": 3, "qualityTotalTracks": 8}'

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
curl -X POST http://localhost:3141/wishlist/add \
  -H "Content-Type: application/json" \
  -d '{"artist": "Artist1", "title": "Album1", "source": "manual"}'

curl -X POST http://localhost:3141/wishlist/add \
  -H "Content-Type: application/json" \
  -d '{"artist": "Artist2", "title": "Album2", "source": "roon-tag"}'

curl -X POST http://localhost:3141/wishlist/add \
  -H "Content-Type: application/json" \
  -d '{"artist": "Artist3", "title": "Album3", "source": "low-quality", "qualityFlacTracks": 2, "qualityTotalTracks": 5}'

# Test 8b: Verify separation
echo "=== Test 8b: Verify endpoint separation ==="
echo "Manual albums:"
curl http://localhost:3141/wishlist | jq '[.[] | select(.source == "manual")] | length'
# Expected: 1

echo "Roon-tag albums:"
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
echo "Manual albums after remove:"
curl http://localhost:3141/wishlist | jq '[.[] | select(.source == "manual")] | length'
# Expected: 0
```

---

## Expected Results Summary

| Test | Endpoint | Expected Result |
|------|----------|-----------------|
| 1a-1c | /wishlist/add | Albums created with correct source |
| 2a | /wishlist | Returns all albums |
| 2b | /wishlist/roon-tag | Returns only roon-tag albums |
| 2c | /wishlist/low-quality | Returns only low-quality albums |
| 3 | Persistence | Source field persists after restart |
| 4 | Quality metadata | Only in low-quality albums |
| 5 | Ignore | Removes from wishlist, adds to ignore list |
| 6 | Roon sync | Adds with source: roon-tag |
| 7 | Low-quality scan | Adds with source: low-quality |
| 8 | Mixed sources | All endpoints return correct subsets |

---

## Clean Up

```bash
# Remove all test data
rm -rf data/wishlist.json data/ignored-low-quality.json

# Optional: Remove test library
rm -rf /tmp/test-library
```

---

*Last updated: 2026-06-25*
*Branch: feat/ui-cleanup*
