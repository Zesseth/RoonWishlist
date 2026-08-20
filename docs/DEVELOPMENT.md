# Development and testing

How to run, test and verify the extension. This describes the software as it is, not
the state of any one branch — anything that is only true while a particular change is
being reviewed belongs on its GitHub issue, not in this file.

---

## Running it locally

```bash
npm ci          # never `npm install` — see AGENTS.md
node index.js   # HTTP API and web UI on port 3141
```

---

## Automated tests

The automated tests are the technical test suite. There is no parallel document
listing them: `npm test` is the authoritative statement of what is covered.

```bash
npm test          # node --test, a couple of seconds
npm run test:watch
```

| File | Covers |
|---|---|
| `test/wishlist.test.js` | `add` / `remove` / `getAll` / `upsert` / `replaceAll`, normalization, deduplication, persistence |
| `test/lossless_checker.test.js` | format detection, album classification, multi-location scanning, `checkAndClean`, low-quality scan |
| `test/roon_tag_sync.test.js` | tag sync against a stubbed browse tree: adds, removals on untag, empty-tag handling, tag-write probing |
| `test/owned_tagged.test.js` | tagged albums already owned in lossless — flagged, never deleted |
| `test/scan_locations.test.js` | path parsing, manual paths, exclusions, location validation |
| `test/roon_storage.test.js` | parsing Roon's storage probe, and telling its failure modes apart |
| `test/search.test.js` | Bandcamp and Qobuz search |

> `test/search.test.js` calls the **real** Bandcamp and Qobuz APIs. It can fail from
> rate limiting or a provider outage rather than from your change. Retry before
> investigating. Mocked HTTP tests are not implemented yet.

Everything else runs offline: no network, no Roon Core, no real music library.
Fixture directories are created in a temporary directory and removed afterwards.

### A fake music library

`scripts/make-test-fixture.sh` builds a small library of empty files whose extensions
exercise every classification (fully lossless, fully lossy, mixed, non-FLAC lossless,
and the same album held in two locations). Only the extensions matter.

```bash
./scripts/make-test-fixture.sh /var/tmp/roon-wishlist-fixture
```

---

## Manual acceptance testing

Some behaviour cannot be unit tested: it needs a paired Roon Core, a real library and
a person looking at the screen.

**Those checklists live on the GitHub issue or pull request the change belongs to —
never in this repository.** A checklist committed to the repo describes one branch at
one moment; it is stale the day it merges, and a stale checklist sends the next
session off re-testing work that was finished months ago. That is exactly why
`TODO.md` and `PRIORITY.md` were deleted.

The convention:

1. Write the checklist as a **comment on the issue** before asking for a test.
2. Report results as a **reply comment** — say what you saw, not just pass/fail.
3. Anything that fails becomes **its own issue**, linked from that comment.
4. When the pull request merges, the checklist stays in the issue history as the
   record of how the change was verified.

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

That is the complete list. There is deliberately **no** log-level or music-path
environment variable — configurable logging is tracked in
[issue #8](https://github.com/Zesseth/RoonWishlist/issues/8), and the music library
path comes from Roon or from Settings, not from the environment.

---

## Not covered by automated tests

| Area | Why |
|---|---|
| Tag write-back (wishlist → Roon) | The Roon Browse API exposes no tag writes. `GET /roon-tag/write-support` measures this against the live Core rather than assuming it. See [`ROON_API_LIMITATIONS.md`](./ROON_API_LIMITATIONS.md) |
| Track-level tagging | Roon exposes album-level browse only |
| Multiple Roon Cores | The extension pairs with a single Core |
| Probing Roon for storage locations | `src/roon_storage.js` needs a live Browse service; only the parsing of its output is unit tested. Roon exposes no storage folders, so this probe is expected to come back empty |

---

## Upgrading an install

`install.sh` preserves `config.json` (the Roon pairing token) and the wishlist data.
An upgrade therefore does not require re-enabling the extension in Roon.

```bash
sudo ./install.sh --web    # --web binds the web UI to the LAN
```
