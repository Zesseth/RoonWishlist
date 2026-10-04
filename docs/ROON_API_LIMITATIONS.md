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
- Storage location reading from Roon (implemented; see the measured note below - it returns nothing on Roon 2.71, so the manual path is what actually runs)

### ❌ BLOCKED BY ROON API LIMITATIONS
- **Write tags back to Roon:** The Browse API does not expose `setMultipleMetadata` or any tag-write methods. Tags are read-only from Roon's perspective. This is an API limitation, not an implementation issue.

  **Still to be measured, not assumed.** This entry was written from reading the SDK, and
  an equivalent assumption on this page (that Roon's settings screen could not show a
  per-album status) turned out to be wrong. `GET /roon-tag/write-support` therefore asks
  the live Core: it navigates into a tagged album, read-only, and reports every action
  Roon offers there. If a tag-editing action ever appears, the "untag the albums I
  already own" button in issue #32 becomes possible. Until that measurement is filed,
  treat this row as unconfirmed.
- **Track-level tagging:** Only album-level tagging is possible via Browse. Track-level tagging would require metadata write access.

## Storage locations over the Browse API — measured, 2026-08-19

**Re-measured after the user reported "this information is definitely in Roon".** It is —
in Roon's own app. It is not offered to extensions. The Browse API's `settings` hierarchy
returned only `Profile` and `Display Settings` on Roon 2.71 (build 1683). The lookup now
also descends one level into each of those entries before concluding anything, and the
diagnostic reports the whole tree it saw, so the answer shown in the UI is evidence
rather than a claim. There is no Storage entry at either level, so the manual library
path is not a workaround for a bug — it is the only route available.


The note above claimed storage location reading was complete. Measured against a live
core it is **implemented but does not yield anything**, so the wording was misleading.

Observed on the production install, Roon **2.71 (build 1683)**, paired, with
`browseAvailable: true`:

```
GET /storage-locations
  locations:  []          <- nothing came from Roon
  active:     ["/music"]  <- the manual path
  manualOnly: true   <- normal: Roon supplies nothing
```

`getStorageLocations()` browses the `settings` hierarchy and looks for an entry whose
title contains "storage" or "library". On this version no such entry is offered, so it
returns an empty list and the manual `music_library_path` is what actually gets
scanned. Every install therefore still depends on the typed path.

This is **not** a reason to remove the code:

- it costs one browse call on pairing and degrades cleanly to the manual path
- Roon's browsable settings tree is version-dependent, so it may start working
- the manual path now accepts several folders, so multi-location scanning works
  regardless of what Roon reports

**What was changed as a result:** the lookup now returns a *diagnostic* alongside the
locations, distinguishing `not-paired`, `not-exposed` (with the list of settings
entries Roon did offer), `empty`, `error` and `ok`. Previously a failure produced a
`console.warn` into the service journal and an empty list — indistinguishable, from the
user's side, from "Roon has no storage configured". The diagnostic is surfaced in
`/status`, in `/storage-locations`, in the web UI panel and in Roon's own settings
screen.

### Closed, 2026-08-19: Roon does not expose storage locations at all

The open question above is answered, three independent ways, and they agree:

1. **The SDK carries no such service.** `node-roon-api` and its companion packages
   register `com.roonlabs.browse:1`, `settings:1`, `status:1`, `pairing:1`, `ping:1` and
   `registry:1`. There is no storage or library-configuration service to call, so Browse
   was never a shortcut around a missing API — it was the only door, and it is shut.
2. **The live Core offers nothing.** Roon 2.71 (build 1683): the `settings` hierarchy is
   `["Profile", "Display Settings"]`, and descending one level into each finds nothing
   storage-shaped.
3. **Roon intends this.** Their documentation and support answers state that storage and
   watched-folder configuration is not exposed to third-party extensions.

**Consequence, and the design change it forced:** the manual folder list is not a
fallback. It is the only route Roon leaves open, and the product now says so:

- `music_library_path` is presented first, as **Music folders**, and accepts several
  folders separated by a semicolon
- the *Refresh from Roon* button in the web UI and the *Refresh storage locations from
  Roon* action in Roon's settings screen are **removed** — a control that can only ever
  fail is worse than no control
- the probe still runs **once at pairing** rather than before every scan, so a future
  Roon that starts exposing storage would still be picked up, at no recurring cost
- the `not-exposed` diagnostic is now shown as a collapsed *Why not from Roon?* note
  rather than an error, because it describes normal behaviour
- `usedFallback` was renamed `manualOnly`: nothing here is a fall back from anything

## No list or table widget in the native settings UI — worked around, 2026-08-19

Issue #15 asked for a **per-wishlist-entry status** (not found / found lossy, kept /
found lossless, removed) inside Roon's own settings screen.

`node-roon-api-settings` does not validate the layout it is given — the Roon client
decides what it renders — and the client has **no table, list or repeater widget**. So
an interactive, sortable, per-row status list is genuinely not available.

What *is* available is the `label` widget, which renders multi-line text. The wishlist
was already shown that way, so the status is appended to each line:

```
1. Tool — Lateralus
     ↳ in library, only partly lossless — still wanted (1/2 tracks lossless)
2. Portishead — Dummy
     ↳ in library, lossy — still wanted
3. Nobody — Nothing
     ↳ not in library
```

For this to survive a restart the entry has to carry its own state, so `checkAndClean()`
now writes a `lastCheck` object (`status`, `reason`, `checkedAt`, `foundAt`,
`losslessTracks`, `totalTracks`) onto each kept wishlist entry. It is skipped when the
outcome is unchanged, so a scheduled scan over an unchanged library performs no writes.
`owned-lossless` never appears in this list — those entries have just been removed.

**Remaining limitation:** the status is read-only text with no interaction — you cannot
click an entry in Roon's settings to act on it. Anything interactive stays in the web
UI, which was the agreed division of labour: Roon's settings screen carries
configuration, the web page carries the data.

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
npm test  # 101 tests
```

## Next Steps for v1.0

Since #1 write-back is blocked by Roon API limitations, prioritize:
1. **#6 Unit tests** — Add mocked tests for search, lossless_checker
2. **#2 Nightly automation** — Scheduler for periodic refresh/scans
3. **#7 CI** — GitHub Actions workflow
4. **#9 Distribution** — Release process and documentation

The extension is feature-complete for v1.0 with current Roon API constraints.

## Streaming playability is not exposed; catalogue existence is measured instead — 2026-10-04

Issue #34 asked whether wishlist albums whose tracks are unavailable in Roon can be
flagged. Three separate facts settle how:

1. **Playability is not in the Browse payload.** An `Item` carries only `title`,
   `subtitle`, `image_key`, `item_key`, `hint` and `input_prompt` (see
   `node-roon-api-browse/lib.js`). No field or hint value marks a track or album as
   unavailable; the greyed-out "unavailable" state in Roon's own clients is applied
   client-side and never offered to extensions. Roon's own UI cannot even Focus on
   unavailable tracks, and the in-product fix (Playlist Improver) is also client-side.
2. **There is no service-listing call either.** The SDK registers no API to ask which
   streaming services are logged in. The browse tree root — where Roon's own UI shows
   them — is the only carrier, so `GET /streaming/services` reads it once per pairing
   and returns a diagnostic with every root title it saw, evidence rather than a claim.
3. **"Is it streamable somewhere" is answerable without Roon.** The rescoped feature
   asks the catalogues directly: `isOnQobuz()` in `src/search.js` reuses the public
   Qobuz album search (no `purchasable` filter — an album that stopped being buyable
   but is still streamable must count as available), and the checks are wired in
   `src/streaming_availability.js`.

**Consequence:** a wishlist entry carries a `streaming` state
(`available: true|false|"unknown"`, `services`, `checkedAt`, `lastSeenAt`) plus a
`streamUnavailable` flag. A flag is raised only when the album was seen streamable
before, or is `roon-tag` sourced *and not a local rip* (measured: about a third of
tagged entries are local albums, which were never streaming albums — see the live
measurements below), and is now absent from every checked catalogue. Probe errors
always count as `unknown`, never as gone — a flaky catalogue API must not trigger
buy-urgency.

**Known limits, accepted:**
- Catalogue existence is not subscription-tier playability. An album can be in the
  catalogue but not playable on the user's tier; that distinction is invisible to any
  public route and out of scope.
- TIDAL (or any other service) is only checked once a probe exists for it. Until then
  the service list from Roon narrows the check to services with probes, and a missing
  probe never silently counts as "gone".
- The browse-root service read is version-dependent; the diagnostic in
  `/streaming/services` says what the root actually contained.

## Live-core measurements for the streaming watch — Roon 2.73, 2026-10-04

Measured against the paired production core (Roon 2.73, build 1696) with one Qobuz
account logged in, with a one-shot browse probe extension. Raw evidence:
`/streaming/services` on a paired install returns the same diagnostic the probe saw.

**The browse tree root.** Six items, every one with an `item_key` and `hint: "list"`:

```
Library, Playlists, My Live Radio, Genres, Qobuz, Settings
```

- Services appear by their plain name ("Qobuz"), so title matching is the right read.
- "My Live Radio" is a navigation entry the user's saved live-radio stations create;
  it is version-dependent and was added to the known non-service titles so the
  diagnostic does not report it as unrecognized noise.
- The Qobuz subtree offers New Releases, Playlists, Taste of Qobuz, My Qobuz — and
  **no Search entry**. Searching a service's catalogue goes through the global
  `search` hierarchy, not through the service item, which matters if a future
  TIDAL probe tries the browse route.

**Search input is sticky without `pop_all`.** Issuing a new `input` on the same
multi-session key without `pop_all: true` returns the *previous* search's results
(the response's list subtitle still names the old query). Every new search must
`pop_all: true`, or open a fresh session key. The production code already does
this (`openTagViaSearch`); the probe initially did not, which is how it was measured.

**The Qobuz public API answers more than "does it exist".** Every album item in
`album/search` carries explicit `streamable` and `purchasable` flags (measured
live, e.g. The Dark Side of the Moon: `purchasable: true, streamable: true`).
`isOnQobuz()` therefore reads availability as "a credible match that Qobuz itself
does not mark `streamable: false`" — a purchase-only release (in the catalogue, not
streamable anywhere) is exactly the buy-it-now state, not an available one. A
payload without the flag falls back to catalogue existence.

**Tagged wishlist albums are not all streaming albums.** On this library, 57 of the
160 roon-tag entries match local folders under `/music` (e.g. Barathrum
"Hailstorm": local lossy rip, and measured not in the Qobuz catalogue). Flagging
those "gone from streaming" on their first catalogue miss would be a false alarm
for an album that was never streamed. The first-miss rule is therefore gated on
locality: entries with local files (`lossless_checker.findLocalItems`, the same
folder matching the lossless scan uses) are only flagged on a real disappearance —
seen streamable before, gone now — which is a true signal from any album.
