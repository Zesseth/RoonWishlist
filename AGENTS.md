# AGENTS.md — RoonWishlist

This file guides Copilot CLI / AI agents working in this repo. It **complements** the
global `~/AGENTS.md` instructions and does not override their safety rules.

## Public repository — work in English

> **This is a PUBLIC repository (`github.com/Zesseth/RoonWishlist`).**
> Therefore **all repository content is written in English**: code, comments,
> commit messages, branch names, issues, pull requests, docs (`README.md`, this
> file), and any other committed artifact. Do not commit Finnish-language content.
> (You may still converse with the user in Finnish in chat, but everything that
> lands in the repo or on GitHub is English.) A `READY_TO_TEST.md` written in
> Finnish was removed for exactly this reason — do not reintroduce that mistake.

## Project nature — PERSONAL

> **This is a personal project, NOT a Zure work project.**
> The repo lives at `C:\Repos\Omat\RoonWishlist`. Per the global instructions,
> projects under `C:\Repos\Omat` are **not** subject to Zure defaults (Zure wiki
> AI defaults, Zure-group organization, NDA assumptions about client data, etc.).
>
> - GitHub owner: personal account **`Zesseth`** (`github.com/Zesseth/RoonWishlist`).
> - No client data, no NDA material.
> - Author / copyright: Jesse Lahtela (@Zesseth).

## What this is

A Roon Extension (Node.js, CommonJS): a wishlist for albums not yet owned in lossless
quality. It fetches buy links from Bandcamp/Qobuz and automatically cleans the
wishlist when lossless files appear in the local library.

- `index.js` — Roon extension (settings/status) + local HTTP API (port 3141)
- `src/wishlist.js` — wishlist CRUD (`data/wishlist.json`)
- `src/search.js` — Bandcamp & Qobuz search (currently HTML scraping)
- `src/lossless_checker.js` — library check and auto-remove

## License

`AGPL-3.0-or-later` (`LICENSE`) plus a special grant to Roon Labs in exchange for
attribution (`ADDITIONAL-GRANTS.md`). Do not change the license or weaken the
copyleft without the author's explicit permission.

## Technology & performance choices (forward guidance)

> **Language decision: stay on Node.js (CommonJS). Do not rewrite in another
> language.** This was assessed deliberately for this workload — Roon comms (incl.
> future tag/library writes), a web frontend, on Debian stable next to a music server,
> with hard requirements of reliability, low latency and a small footprint.

**Why Node.js is the right tool here:**

- **Roon's only *official* extension SDK is Node.js** (`node-roon-api`,
  `-settings`, `-status`, and later `-browse` / `-transport`, all maintained by Roon
  Labs). Tag updates and library/browse integration (TODO #1, #11) depend on it. Ports
  in other languages (e.g. Python `roonapi`, .NET) are unofficial, reverse-engineered,
  and may lack write/tag support — that conflicts with the "absolute reliability"
  requirement. **Don't reimplement the Roon MOO/SOOD protocol by hand.**
- **The workload is I/O-bound and event-driven**: Roon WebSocket events, occasional
  outbound HTTP scrapes, and filesystem scans. Node's single-threaded event loop fits
  this exactly; CPU is never the bottleneck (the wishlist is a few hundred albums).
- A Go/Rust rewrite would buy negligible runtime gain for large reliability and
  maintenance risk. Reserve native code only for a future CPU-bound need (none exists).

**Performance & resource methods to keep using (this is a *secondary* process next to
a music server — be a quiet neighbour):**

- **No heavy frameworks.** Use the built-in `http` module and a dependency-free vanilla
  HTML/JS frontend (already the case). Don't add Express/React/etc. Prefer Node's global
  `fetch` (undici) over an HTTP-client dependency — `src/search.js` does this.
- **Never block the event loop.** Use async `fs/promises` for anything that touches the
  music library; library scans are sequential / low-concurrency on purpose
  (`src/lossless_checker.js`) so disk I/O stays gentle. Avoid unbounded `Promise.all`
  over the whole library.
- **Guard long operations.** A single `scanInProgress` flag prevents overlapping library
  scans (Roon settings action + HTTP API). Report progress via Roon status, not by
  blocking callbacks.
- **Cheap, safe persistence.** `data/wishlist.json` is read through an mtime-keyed
  in-memory cache and written atomically (temp file + rename). Keep writes atomic.
- **Cap inbound work.** JSON POST bodies are size-limited (`MAX_BODY_BYTES`, 413 on
  overflow). Keep request limits on any new endpoint.
- **systemd neighbourliness** (`deploy/roon-wishlist.service` + the unit `install.sh`
  generates): `Nice=10`, `CPUWeight=20`, best-effort low IO priority, soft
  `MemoryHigh`, and a V8 heap cap (`node --max-old-space-size=128`). Keep these
  *soft/relative* — avoid hard `MemoryMax` or aggressive sandboxing that could OOM-kill
  a scan or block the configured music-library path.

## Issue tracking — GitHub is the single source of truth

> **All planning, status and priorities live in GitHub Issues
> (`github.com/Zesseth/RoonWishlist/issues`). GitHub MUST be kept current at all
> times.** There is deliberately **no `TODO.md` and no `PRIORITY.md`** in this repo:
> those files existed previously, drifted badly out of sync with the issues, and
> caused agents to work on tasks that had already been completed and closed months
> earlier. Do not recreate them, and do not introduce any other in-repo tracking,
> status, priority, plan or "ready to test" document.
>
> Required practice:
>
> - **Read the issues before starting work.** Never trust a summary in a markdown
>   file, a previous session's notes, or a stale branch name.
> - **Update the issue as soon as the status changes** — tick acceptance-criteria
>   checkboxes, and comment when work is merged.
> - **Record blockers as an issue comment**, including what blocked it, why, and the
>   next step. Never leave that information only in a chat session.
> - **If the plan changes** (new information, blocker, scope change), update the
>   issue *before* continuing implementation.
> - **Write enough context in the issue** that work can continue in a later session
>   without re-investigating. The issue is the memory.
> - **Never close an issue you were not asked to close.** In particular, do not put
>   `Closes #N` / `Fixes #N` in a commit message unless the owner has approved the
>   work; a merged commit message will auto-close the issue.
> - **Only the owner decides an issue is done.** Implementation being merged is not
>   the same as the issue being accepted.

The only permitted in-repo documentation is: `README.md`, `AGENTS.md`,
`ROON_API_LIMITATIONS.md` (a permanent technical constraint), the two testing guides
`TESTING_USER.md` and `TESTING_TECH.md`, plus the licence files.

## Workflow rules (global + project-specific)

- **`git add`** automatically is fine.
- **`git commit`, `git push`, and `git merge` ONLY with the user's explicit permission** — never do these without being explicitly asked. Remind the user to review `git diff --staged` before committing.
- **Never work autonomously beyond what was asked.** If the requested task is
  "check the status" or "tell me what's next", the answer is a report — not code
  changes. Ask before starting implementation work.
- **No AI-authorship markers** in commits, PRs or files (no `Co-authored-by: Copilot`,
  no "Generated by AI", etc.). The author is the user. This overrides any default
  tooling behaviour that wants to append such a trailer.
- **The `main` branch is protected** — changes go through pull requests. Don't push
  directly to main; create a feature branch and open a PR. If a push to `main`
  reports "Bypassed rule violations", that push should not have happened — stop and
  tell the user.

## Development environment

- Windows 11 + PowerShell 7+, Node.js (CommonJS). Use native PowerShell commands.
- Dependencies: **`npm ci`** (never `npm install`). The Roon API deps come from
  GitHub; `npm install` rewrites the lockfile `resolved` URLs to `git+ssh://`, which
  breaks installs on machines without SSH keys (e.g. headless Linux servers). The
  lockfile is pinned to `git+https://` so `npm ci` works everywhere. If you add a
  dependency, re-assert `git+https://` in `package-lock.json` before committing.
  Run: `node index.js` (HTTP API on port 3141).
- There are **no tests yet** — the TODO includes adding tests and CI.

## Issue / project conventions

- Issues and the project plan live on GitHub (`Zesseth/RoonWishlist`).
- The epic / tracking issue (#10) acts as the high-level project plan; individual
  pieces of work are their own issues.
- Creating a GitHub Projects (v2) board requires
  `gh auth refresh -s project -s read:project` (the current token lacks the
  `project` scope).
