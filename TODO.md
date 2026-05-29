# TODO — RoonWishlist (agent working list)

> This is the **agent's working memory**. Keep it up to date continuously (see `AGENTS.md`).
> Update statuses as soon as they change, and record blockers + the next step.

**Status markers:** `[ ]` not started · `[~]` in progress · `[x]` done · `[!]` blocked

Last updated: 2026-05-29

---

## Done

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

- [ ] **#3 Harden Bandcamp/Qobuz search providers.** `src/search.js` relies on HTML
  scraping; Qobuz selectors are guesses and fragile. Investigate more stable APIs,
  add retry/timeout/caching and error handling.

- [ ] **#4 Harden the data layer.** `data/wishlist.json`: atomic writes, stable
  schema with item IDs, dedup edge cases, migration/versioning.

- [ ] **#5 Web UI for wishlist management.** Roon's settings UI is limited → serve a
  small frontend on top of the HTTP API (list, add, remove, search, manual check).

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
