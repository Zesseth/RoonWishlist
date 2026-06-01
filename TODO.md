# TODO — RoonWishlist (agent working list)

> This is the **agent's working memory**. Keep it up to date continuously (see `AGENTS.md`).
> Update statuses as soon as they change, and record blockers + the next step.

**Status markers:** `[ ]` not started · `[~]` in progress · `[x]` done · `[!]` blocked

Last updated: 2026-06-01

---

## Done

- [x] **Language/tech assessment + runtime optimizations** — confirmed Node.js is the
  right language (official Roon SDK; I/O-bound, event-driven workload) and documented the
  decision + performance methods in `AGENTS.md` ("Technology & performance choices").
  Implemented, keeping current functionality (verified live against Roon core
  "ParadoxRoon" on a test port):
  - `src/lossless_checker.js` now async (`fs/promises`), sequential/low-I/O scan — no
    longer blocks the event loop on large libraries.
  - `scanInProgress` guard prevents overlapping scans (Roon action + HTTP `/check-lossless`,
    which now returns `409` if a scan is running); the Roon settings action shows
    "Scanning library…" and reports the result via status without blocking the callback.
  - `src/wishlist.js`: mtime-keyed in-memory read cache + atomic writes (temp + rename).
  - `src/search.js`: dropped the `axios` dependency for Node's global `fetch`
    (AbortController timeout, `resp.ok` check). Lockfile regenerated; Roon `resolved`
    URLs re-asserted to `git+https`; `npm ci` verified.
  - HTTP JSON POST bodies size-capped (64 KB → `413`).
  - systemd unit (template + `install.sh`): `Nice`/`CPUWeight`/best-effort IO priority,
    soft `MemoryHigh`, `--max-old-space-size=128`, minimal hardening — quiet neighbour
    to the music server.
- [x] **Initial commit & push** — code pushed to `Zesseth/RoonWishlist` (main).
- [x] **Licensing** — `AGPL-3.0-or-later` (`LICENSE`) + Roon special grant in
  exchange for attribution (`ADDITIONAL-GRANTS.md`). `package.json` `license` field
  updated. README + AGENTS.md reference it.
- [x] **Repo made public** — `Zesseth/RoonWishlist` set to public.
- [x] **`main` branch protected** — direct pushes blocked (PRs required), no force
  pushes / deletions, conversation resolution required; `enforce_admins` left off so
  the owner keeps control.
- [x] **AGENTS.md** — project-specific guidance (public repo → English, personal
  project, TODO.md maintenance policy, workflow rules).
- [x] **English-only repo content** — README, AGENTS.md, TODO.md translated to English.
- [x] **GitHub plan created** — milestone "v1.0 - Complete Roon extension", labels,
  issues #1–#9, and epic/tracking issue #10 (project plan).
- [x] **Demo skeleton loads into Roon** — `node index.js` registers the extension,
  pairs with a live Roon core (verified against Roon 2.67 "ParadoxRoon") and listens
  on the HTTP API (port 3141). This is the first testable demo: the plugin loads.
- [x] **#13 Native settings menu (MVP)** — settings-based Action menu rendered by
  Roon (add / remove / refresh & clean), wishlist shown as a label, transient fields
  cleared after action, dry-run guarded, live refresh via `update_settings`.
- [x] **#12 Linux server deployment (initial)** — `install.sh` + systemd service
  (`deploy/roon-wishlist.service` template), env config
  (`ROON_WISHLIST_DATA_DIR/HTTP_HOST/HTTP_PORT`), README "Run on a Roon server
  (Linux)" incl. ROCK/Nucleus caveat.
- [x] **https-only dependency install** — switched Roon deps + lockfile `resolved`
  URLs from `git+ssh` to `git+https`. Verified `npm ci` succeeds with SSH disabled
  (mimics a headless Linux server). The install script uses `npm ci`.
- [x] **#5 Web UI for wishlist management** — `public/index.html` (vanilla, no external
  CDNs) served by the existing HTTP server at `http://<host>:3141`: list (newest first),
  add, remove, search-and-add from Bandcamp/Qobuz results, set the music library path,
  run scan & clean, and a live "paired with Roon core" status chip. Navigation now
  includes a top-left menu with dedicated views for **Wishlist** (home, current list
  only), **Add an album**, and **Settings**; the header `Wishlist` title also routes to
  home. New endpoints: `GET /status`, `GET /settings`, `POST /settings`. Toast
  notifications; path traversal guarded. Documents the Roon Browse-API limitation
  (extensions can't add to the Browse sidebar; only the Settings screen + this web UI
  are available).

---

## Backlog — the actual unfinished implementation

Each item maps to a GitHub issue.

- [ ] **#1 Roon library & browse integration (CORE).** The extension currently only
  exposes settings + an HTTP API; there is no real Roon integration. Add
  `node-roon-api-browse` (and `-transport` if needed) so the user can add albums to
  the wishlist directly from Roon, and library lookups can use the Roon library
  rather than only a raw local path. **Most significant unfinished piece.**

- [ ] **#2 Automatic scheduled lossless check.** Currently only a manual
  `POST /check-lossless`. Add a configurable interval and/or filesystem watch that
  runs `checkAndClean` automatically.

- [ ] **#15 Storage locations from Roon + full-album lossless detection.** Read the
  music storage location(s) from Roon's settings (depends on #1) instead of a manual
  path, with an option to exclude a location. Change the removal rule: only remove an
  album when the **whole album** is lossless; if it's present only in a lossy format,
  **keep** it. Surface per-album status (not found / found lossy → kept / found
  lossless → removed) in the native UI. Today `checkAndClean` removes on *any* lossless
  file in the folder — tighten this.

- [ ] **#11 Tag wishlist albums & tracks in Roon (kept in sync).** Tag both albums
  and tracks on the wishlist in Roon (default tag `Wishlist`). Tags must be
  maintained the same way as the wishlist: add tag on add, remove tag on removal /
  auto-clean, and reconcile on startup so Roon tags match the wishlist exactly.
  **Depends on #1.** Research note: confirm what tagging capability the Roon
  extension API exposes (browse/transport) before implementing.

- [ ] **#3 Harden Bandcamp/Qobuz search providers.** `src/search.js` relies on HTML
  scraping; Qobuz selectors are guesses and fragile. (Done so far: migrated off `axios`
  to native `fetch` with an AbortController timeout + `resp.ok` check.) Still TODO:
  investigate more stable APIs, add retry/caching and richer error handling.

- [ ] **#4 Harden the data layer.** `data/wishlist.json`: atomic writes, stable
  schema with item IDs, dedup edge cases, migration/versioning.

- [x] **#5 Web UI for wishlist management.** Initial UI is done (see Done section), and
  the navigation split is now implemented: top-left menu + dedicated views for
  Wishlist / Add an album / Settings.

- [ ] **#6 Unit tests.** `wishlist` (CRUD/dedup), `lossless_checker` (matching +
  auto-remove, mocked fs), `search` (mocked HTTP). Pick a lightweight runner
  (e.g. node:test) and wire up `npm test`.

- [ ] **#7 CI (GitHub Actions).** Workflow: install + lint + tests on PRs and merges
  to main. Requires the `workflow` scope (already present on the token).

- [ ] **#8 Configuration & logging.** Configurable port, log levels, environment
  variable / settings support, clean error logging.

- [ ] **#9 Distribution & documentation.** Install instructions as a Roon extension,
  versioning/release process, optional extension-manager entry.

---

## Blockers & notes

- **`install.sh` not yet tested on a real Linux host.** Written and reviewed, but this
  dev machine has no bash, so it couldn't be syntax-checked or run end-to-end. Validate
  on a clean Debian/Ubuntu host (follow-up on #12).
- **Native menu UX is verified only at the code/runtime level** (extension starts,
  pairs, wishlist add/remove works via the same code path through the HTTP API). The
  actual menu rendering should be eyeballed in Roon → Settings → Extensions → Wishlist.
- **GitHub Projects (v2) board:** the current `gh` token lacks the `project` scope
  (scopes: gist, read:org, repo, workflow). Creating a board requires the user to run:
  `gh auth refresh -s project -s read:project`. Until then the plan lives as the
  epic/tracking issue #10 + the milestone.

---

## Agent working instructions

1. Do work on a feature branch and open a PR to main (main is protected).
2. Don't commit/push without the user's permission; no AI-authorship markers.
3. Everything committed is in English (public repo).
4. Update this file + the matching GitHub issue after every step of progress.
