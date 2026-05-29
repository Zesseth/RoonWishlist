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
2. Open its settings and set the `Music library path` (e.g. `D:\Music` on Windows,
   `/mnt/music` on Linux)
3. Use the **Actions** menu in the same settings screen to add/remove albums or run a
   manual *Refresh & clean*. The menu is rendered natively by Roon — pick an action,
   fill the fields if shown, then press **Save**.

## Run on a Roon server (Linux)

This extension is a small Node.js process. It can run **on the same Linux machine as
your Roon Server**, or on any always-on Linux box on the same network.

> **⚠️ ROCK and Nucleus are not supported as the install target.** Roon OS appliances
> (ROCK, Nucleus) are locked down — you cannot install Node.js or systemd services on
> them. If your Roon Core runs on ROCK/Nucleus, run this extension on **another**
> always-on Linux machine on the same LAN (Raspberry Pi, NAS, mini-PC, VM, …). It will
> discover and pair with the core over the network.

### Quick install (systemd service)

On a generic Linux host running (or near) Roon Server:

```bash
git clone https://github.com/Zesseth/RoonWishlist.git
cd RoonWishlist
sudo ./install.sh
```

`install.sh` installs the app to `/opt/roon-wishlist`, installs dependencies with
`npm ci` (over **https**, no SSH keys needed), creates a `roon-wishlist` systemd
service that restarts automatically, and starts it. Requires Node.js LTS and `git` to
be installed first (the script prints instructions if Node is missing).

Override defaults with environment variables:

```bash
INSTALL_DIR=/opt/roon-wishlist DATA_DIR=/var/lib/roon-wishlist \
SERVICE_USER=roon HTTP_HOST=127.0.0.1 HTTP_PORT=3141 \
sudo -E ./install.sh
```

Manage the service:

```bash
systemctl status roon-wishlist
journalctl -u roon-wishlist -f      # live logs
systemctl restart roon-wishlist
```

A manual systemd unit template is in [`deploy/roon-wishlist.service`](./deploy/roon-wishlist.service).

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ROON_WISHLIST_DATA_DIR` | `<repo>/data` | Where `wishlist.json` is stored. |
| `ROON_WISHLIST_HTTP_HOST` | `127.0.0.1` | HTTP API bind address. Set to `0.0.0.0` to expose it on the LAN (⚠️ this makes the control API reachable by other machines — use with care). |
| `ROON_WISHLIST_HTTP_PORT` | `3141` | HTTP API port. |

> Note: the Roon pairing token is stored in `config.json` in the service's working
> directory, so the service user must own the install directory (the script handles
> this).

## HTTP API (port 3141)

The HTTP API is an optional local control surface (handy for scripting). Day-to-day
use can go through the native Roon settings menu described above.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/wishlist` | Get all wishlist albums |
| POST | `/wishlist/add` | Add an album `{"artist":"...","title":"..."}` |
| POST | `/wishlist/remove` | Remove an album `{"artist":"...","title":"..."}` |
| GET | `/search?artist=&title=` | Get buy links from Bandcamp/Qobuz |
| POST | `/check-lossless` | Check the library and clean up the wishlist |

## Project structure

```
index.js              ← Roon extension (native settings menu) + HTTP API
src/
  wishlist.js         ← Wishlist CRUD (data/wishlist.json)
  search.js           ← Bandcamp & Qobuz search
  lossless_checker.js ← Library check, auto-remove
deploy/
  roon-wishlist.service ← systemd unit template (manual installs)
install.sh            ← Linux install script (systemd service)
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
