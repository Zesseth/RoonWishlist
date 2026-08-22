# Changelog

All notable changes to this project are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/); versioning follows
[Semantic Versioning](https://semver.org/) (see [`docs/RELEASING.md`](./docs/RELEASING.md)
for what that means for this Roon extension).

## [Unreleased]

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

[Unreleased]: https://github.com/Zesseth/RoonWishlist/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/Zesseth/RoonWishlist/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/Zesseth/RoonWishlist/releases/tag/v1.0.0
