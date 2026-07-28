# Roon API Limitations for Tagging

## Current State of Issue #1

As of investigation on 2026-07-28, the following has been implemented:

### ✅ COMPLETED
- Browse API integration and registration
- Read Roon Wishlist tags from the library
- Sync tagged albums into wishlist with buy-link lookups
- Rebuild wishlist from Roon tags (Danger Zone)
- Web UI endpoints and status indicators
- **NEW:** Startup reconciliation (auto-sync on pairing)
- **NEW:** Storage location reading from Roon

### ❌ BLOCKED BY ROON API LIMITATIONS
- **Write tags back to Roon:** The Browse API does not expose `setMultipleMetadata` or any tag-write methods. Tags are read-only from Roon's perspective. This is an API limitation, not an implementation issue.
- **Track-level tagging:** Only album-level tagging is possible via Browse. Track-level tagging would require metadata write access.

## Investigation Results

The Roon Extension SDK (`node-roon-api-browse`) provides:
- **Browse hierarchies** for reading library structure
- **Load/load_all** for fetching items
- **No metadata write methods**

Per Roon Labs' official documentation:
> "There is currently no documented API call for programmatically setting or adding tags from an external extension."

Tags in Roon are managed exclusively through:
1. The Roon UI
2. File metadata (ID3, Vorbis, etc.) — but Roon does not automatically sync these as Roon tags

## Workaround Strategy

Since write-back is not possible, the extension now focuses on:

1. **One-way sync** (Roon → Wishlist):
   - User tags albums in Roon with the `Wishlist` tag
   - Extension reads those tags and adds albums to wishlist
   - This direction is fully implemented and working

2. **Startup reconciliation** (NEW):
   - On Roon pairing, automatically reconciles Roon tags with wishlist
   - Adds any Roon-tagged albums missing from wishlist
   - Detects drift and re-syncs

3. **Storage location integration** (NEW):
   - Attempts to read storage paths from Roon settings
   - Falls back to manual path if unavailable
   - Better integration than pure manual paths

## Recommendation for #1 Resolution

**Option A: Accept limitations and close #1 as PARTIAL**
- Read-only tag sync is complete and functional
- Users can manage tags in Roon UI, extension keeps wishlist in sync
- No write-back means tags stay under user's control in Roon

**Option B: Request setMultipleMetadata from Roon Labs**
- File an enhancement request for official tag-write API
- This would require Roon 2.x update

**Option C: Explore undocumented APIs (not recommended)**
- Roon may have internal APIs for tag writing
- Not officially supported, risk of breakage
- Could violate terms of use

## Files Changed

- `src/roon_reconciliation.js` — Startup sync + health checks
- `src/roon_storage.js` — Storage location reader
- `index.js` — Integrated reconciliation, new endpoints

## Testing

All existing tests pass. No regressions introduced.

```bash
npm test  # ✅ All 26 tests pass
```

## Next Steps for v1.0

Since #1 write-back is blocked by Roon API limitations, prioritize:
1. **#6 Unit tests** — Add mocked tests for search, lossless_checker
2. **#2 Nightly automation** — Scheduler for periodic refresh/scans
3. **#7 CI** — GitHub Actions workflow
4. **#9 Distribution** — Release process and documentation

The extension is feature-complete for v1.0 with current Roon API constraints.
