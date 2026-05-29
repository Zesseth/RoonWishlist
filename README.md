# RoonWishlist

A Roon Extension — a wishlist for albums you don't yet own in lossless quality.

## Features

- **Wishlist**: Add albums to a buy-list from Roon
- **Search**: Looks up the album on Bandcamp and Qobuz
- **Auto-clean**: When lossless files appear in your local library, the album is
  automatically removed from the wishlist

## Install

```bash
npm install
```

## Run

```bash
node index.js
```

After starting:
1. Open Roon → Settings → Extensions → **Wishlist** → Enable
2. Set the `Music library path` in Settings (e.g. `D:\Music`)

## HTTP API (port 3141)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/wishlist` | Get all wishlist albums |
| POST | `/wishlist/add` | Add an album `{"artist":"...","title":"..."}` |
| POST | `/wishlist/remove` | Remove an album `{"artist":"...","title":"..."}` |
| GET | `/search?artist=&title=` | Get buy links from Bandcamp/Qobuz |
| POST | `/check-lossless` | Check the library and clean up the wishlist |

## Project structure

```
index.js              ← Roon extension + HTTP API
src/
  wishlist.js         ← Wishlist CRUD (data/wishlist.json)
  search.js           ← Bandcamp & Qobuz search
  lossless_checker.js ← Library check, auto-remove
data/
  wishlist.json       ← (created automatically, not committed)
```

## License

Licensed under the **GNU Affero General Public License v3.0 or later**
(`AGPL-3.0-or-later`) — see [`LICENSE`](./LICENSE).

The AGPL is a strong copyleft license: if you run a modified version and offer it to
users over a network, you must make the complete source code of your modified version
available to those users (AGPL-3.0 §13). The intent is that the source always stays
open.

**Special grant for Roon Labs:** Roon Labs may adopt this as part of Roon by giving
appropriate credit to the author and the project. See the exact terms in
[`ADDITIONAL-GRANTS.md`](./ADDITIONAL-GRANTS.md).
