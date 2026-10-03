# Changelog

All notable changes to this project are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/); versioning follows
[Semantic Versioning](https://semver.org/) (see [`docs/RELEASING.md`](./docs/RELEASING.md)
for what that means for this Roon extension).

## [Unreleased]

## [1.7.0] - 2026-10-03

### Added

- The extension now has an icon (#64): an indigo **RW** lettermark (matching the
  web UI's accent colors) served as `favicon.svg` with PNG/ICO fallbacks and an
  opaque `apple-touch-icon.png`, referenced from the web UI's `<head>`. Roon's
  extension API offers no way to register an icon for Roon's own settings list,
  so the icon shows in the browser tab and home-screen shortcuts.

### Fixed

- Static web UI assets (the page and the icons) are served with
  `Cache-Control: no-cache` (#64): browsers previously fell back to heuristic
  caching, so an upgrade install could leave the old page or favicon on screen
  even after a hard reload.

## [1.6.0] - 2026-10-03

### Changed

- The Wishlist tab has one **"Sync and refresh"** action instead of separate
  "Sync Roon tag" and "Reload wishlist now" buttons (#47): it reads the Roon
  `Wishlist` tag, updates the tagged wishlist and store links, refreshes the
  visible UI, and reports progress and errors — Roon stays the master for tagged
  albums.
- Low-quality albums expose only the persistent **Ignore — never re-add** action;
  the reversible Remove button is gone because the next scan would have re-added
  the album anyway (#47). `POST /wishlist/remove` remains available as an API
  endpoint.
- The low-quality **Danger Zone** "Clear & rebuild low-quality albums" is now the
  only operation that resets Ignore decisions (#47): it asks for an explicit
  confirmation stating that every Ignore will be cleared, and reports how many
  ignored albums were reset.

### Fixed

- The Danger Zone **"Clear & rebuild from Roon tag"** no longer wipes low-quality
  and manually added albums: the rebuild now replaces only the Roon-tagged part
  of the wishlist, and the confirmation and result messages say exactly that
  (#67). Previously it emptied the entire wishlist, so every `low-quality`
  entry disappeared even though that source has its own separate Danger Zone
  reset.
- The Roon tag sync/rebuild actions, the low-quality Danger Zone rebuild, and the
  Roon settings actions now write start, per-album progress (at debug level),
  and result lines to the log file (#67). Previously a rebuild that wiped data
  left no trace in the log at any level, because these paths only ever updated
  the ephemeral Roon status message.
- Ignoring a low-quality album no longer removes a Roon-tag-sourced wishlist
  entry — Ignore only hides entries that appear in the low-quality view, so it can
  never remove or modify a Roon `Wishlist` tag (#47).
- The Roon settings "Clear & rebuild low-quality albums" action now requires an
  explicit confirmation dropdown before it runs, matching the web UI's Danger
  Zone confirmation (#47): a stray dropdown selection can no longer wipe every
  Ignore decision.
- `POST /check-lossless` now refuses to start while a library scan is already
  running (409) *before* clearing anything — previously the low-quality list was
  emptied first and the rebuild could then fail, leaving the list cleared with no
  rebuild (#47).
- A running clear & rebuild now blocks concurrent manual scans, nightly
  low-quality automation, and a second rebuild instead of interleaving writes
  with the rebuild's steps (#47).
- The low-quality view filter is defined in one place (`isLowQualityEntry`) shared
  by the low-quality endpoint and the Ignore handler, so the visible list and the
  Ignore removal rule can never drift apart (#47).

## [1.5.1] - 2026-09-29

### Fixed

- The log file no longer goes silent across restarts (#62). A leftover process holding
  the HTTP port used to crash every restart with an unhandled `EADDRINUSE` error whose
  stack only reached journald — on installs where the file is the only readable log,
  the process left no trace in the file, so startup/pairing/scan lines never landed
  while the older process kept serving HTTP. The app now writes a startup line to the
  log file as soon as the file sink is attached, records bind failures there before
  exiting (so systemd's `Restart=always` retries visibly), and library scans log their
  start, finish and failure lines instead of reporting only via Roon status.

## [1.5.0] - 2026-09-26

### Changed

- Adding a music folder is now an **additive "Add folder" action** instead of a
  replace-all "Save folders" (#39): a new `POST /storage-locations/add` appends to
  the configured folders without replacing them, the input field stays empty and is
  never repopulated with the whole list, and pasting a semicolon-separated list adds
  several folders at once. Folders already configured are skipped rather than
  duplicated. `POST /settings` still replaces the whole value, so the native Roon
  settings field and existing automation keep working.
- The folder list in Settings renders under a "Local music folders" heading, with
  Scanned / Not scanned sub-lists (#39).

### Added

- Automated coverage for the storage-location HTTP endpoints (`test/http_api.test.js`):
  the real server is started in an isolated temporary directory and exercised over
  HTTP — add (single, bulk paste, comma-in-name), duplicate no-op, empty-path 400,
  per-entry remove, and `/settings` replace-all — with no Roon core required (#39).

## [1.4.0] - 2026-09-26

### Changed

- The Settings → Music folders section now explains the Roon storage-settings
  limitation in **one** place: a single collapsed "Why must music folders be set
  here?" toggle under the Save folders form ("Roon does not let extensions read its
  storage settings, so the folders have to be set here", with a background link).
  The duplicate "Why not from Roon?" block below the folder list and the
  "Checked at pairing" line in the empty state are gone, and the lookup diagnostic
  appears inside the toggle only when it adds information the explanation does not
  already carry (read error, empty storage list, missing browse access) (#38).
- The folder list is restructured into **Scanned folders** (plain paths; the
  meaningless "scanned - typed here" label is gone, and per-folder detail such as
  "from Roon" only appears when informative) and a separate **Not scanned** list for
  excluded or unreadable folders with their reason and Include action (#38).

## [1.3.1] - 2026-09-26

### Fixed

- "Find in stores" (and `/search`) now returns results for wishlist titles with a
  parenthetical or bracketed edition marker (e.g. "Ride The Lightning
  (Remastered)") instead of none: the outgoing store query is built from the
  title with edition markers stripped, while scoring still uses the raw title
  (#56).
- Store search no longer returns false-positive buy links from cover/tribute/stem
  bands (e.g. a Bandcamp result credited "Metallica (First to Eleven Stems)"):
  artist matching no longer gives credit for parenthetical name segments or
  substring containment (#58).
- Roon tag sync no longer imports a tagged **track** as a wishlist album, which
  previously stored the whole "Track by …" credit line as the artist. Rows already
  imported that way are removed on the first reconciliation after the upgrade (#59).

## [1.3.0] - 2026-09-18

### Changed

- The remove-only "Scan & clean" action is gone. Both the web UI and the Roon settings
  action now expose a single "Clear & rebuild low-quality albums" action that clears
  existing low-quality entries, removes anything now held as a complete lossless copy,
  then rescans for albums that are still not fully lossless — so the two library scans
  can no longer be run out of order or mistaken for each other (#28).
- Fixed a web UI bug where the "Clear & rebuild low-quality albums" button reverted to
  the old "Scan & clean now" label after every status refresh (#28).
- The "Last scan" summary's newly-added-albums list is now collapsed by default behind
  a disclosure toggle; the header (intro text, run-at timestamp, stats) still shows
  without any interaction (#53).

## [1.2.0] - 2026-09-18

### Changed

- Low-quality album list: the permanent `Ignore` action now uses the `danger` style
  with an explicit "never re-add" label, while the reversible `Remove` action uses the
  `secondary` style, so button severity matches actual consequence. The two are also
  reordered (Find in stores → Remove → Ignore) so the most consequential action isn't
  the easiest one to reach (#36).
- The Reload button now disables and shows "Reloading…" while in flight, confirms
  completion with a toast including the album count (or explicitly "no changes" when
  the list is identical), shows an error toast on failure, and can no longer be
  double-clicked into overlapping loads (#35).
- The Wishlist page toolbar is now limited to the title, description and album count;
  "Sync Roon tag", "Reload wishlist now" and the low-quality "Scan low-quality albums
  now" button moved to Settings. The Wishlist and Low-quality albums tabs now
  auto-refresh every 30 seconds, so a manual reload is rarely needed.
- Settings is now grouped into three clearly-labelled sections (Global, Wishlist tab,
  Low-quality albums tab) so it is obvious what each control affects.
- The Low-quality albums tab toolbar now shows an album count, matching the Wishlist
  tab.

## [1.1.1] - 2026-08-23

### Fixed

- The last-scan summary on the Low-quality albums page no longer looks like part of the
  actionable wishlist. It is now a clearly separated, visually distinct `Last scan` panel
  with its own heading and an explanation that its rows are informational only, so the
  report-only entries are no longer mistaken for wishlist rows whose buttons went missing
  (issue #37).
- The scan statistics are shown as a bullet list instead of one dash-separated line, and
  each figure states what it means rather than relying on a label-value pair.

## [1.1.0] - 2026-08-23

### Added

- Configurable Qobuz country selection in Roon Settings and the Web UI.
- Automatic initial country detection from the install host locale, defaulting to Finland.
- Supported-country dropdown and country-specific Qobuz catalog links.
- Store-link refresh when the Qobuz country changes.

[Unreleased]: https://github.com/Zesseth/RoonWishlist/compare/v1.5.1...HEAD
[1.7.0]: https://github.com/Zesseth/RoonWishlist/compare/v1.6.0...v1.7.0
[1.6.0]: https://github.com/Zesseth/RoonWishlist/compare/v1.5.1...v1.6.0
[1.5.1]: https://github.com/Zesseth/RoonWishlist/compare/v1.5.0...v1.5.1
[1.5.0]: https://github.com/Zesseth/RoonWishlist/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/Zesseth/RoonWishlist/compare/v1.3.1...v1.4.0
[1.3.1]: https://github.com/Zesseth/RoonWishlist/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/Zesseth/RoonWishlist/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/Zesseth/RoonWishlist/compare/v1.1.1...v1.2.0
[1.1.1]: https://github.com/Zesseth/RoonWishlist/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/Zesseth/RoonWishlist/compare/v1.0.1...v1.1.0

## [1.0.1] - 2026-08-22

### Fixed

- Low-quality scan now clears albums you have since bought in lossless. It previously
  only ever added, so an album upgraded to lossless was skipped and its stale entry
  stayed on the low-quality list forever (issue #45).
- An album the low-quality scan found and the user later tagged `Wishlist` in Roon is
  now recognised as tag-sourced. Its stored source used to stay `low-quality`, which
  hid the tag from every roon-tag code path: the ownership check skipped it, and the
  clean step deleted an entry the next tag sync added straight back (issue #45).
- The low-quality scan now matches album names as tolerantly as the clean step always
  has, so a lossless purchase that lands in a folder carrying an edition suffix (e.g.
  `Metallica (Remastered 2021)`) is recognised as the album already on the list, and an
  older lossy rip left beside it is no longer added back (issue #45).

## [1.0.0] - 2026-08-21

First tagged release. Prior to this, the project had no version tags or releases —
this tag marks the codebase at the point where all of the [v1.0 milestone](https://github.com/Zesseth/RoonWishlist/milestone/1)'s
originally planned issues were closed, including distribution/documentation polish (#9).

### Added

- Roon extension core: pairing, native Settings-screen UI, status reporting
  (issue #1, #13).
- Wishlist storage (`data/wishlist.json`) with atomic writes (issue #4).
- Bandcamp and Qobuz buy-link search (issue #3).
- Sync of Roon's `Wishlist` tag into the app wishlist, including removal when an
  album is untagged, and de-listing albums already owned in full lossless
  (issue #11, #20, #31, #32).
- Low-quality album scan: finds locally-owned albums that are not fully lossless
  and adds them to the wishlist, with a per-album "Ignore" action (issue #22).
- Web UI: Wishlist / Add an album / Settings views, served locally over HTTP
  (issue #5, #25, #26).
- Configurable music folders (Roon does not expose its own storage locations to
  extensions) (issue #15).
- systemd service + `install.sh`/`bootstrap.sh` one-line installer for Linux
  (issue #12).
- Automated test suite (`node --test`) (issue #6).
- Nightly automation: scheduled low-quality scan + Roon tag sync (issue #2).
- Configurable HTTP port, leveled/structured logging with a size-capped log file,
  and settings persistence (issue #8).
- Distribution & documentation: install/versioning/release process, changelog,
  single source of truth for the version number (issue #9).

[1.0.1]: https://github.com/Zesseth/RoonWishlist/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/Zesseth/RoonWishlist/releases/tag/v1.0.0
