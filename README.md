# RoonWishlist

A Roon Extension — a wishlist for albums you don't yet own in lossless quality.

## Features

- **Wishlist**: Add albums to a buy-list
- **Web UI**: A simple browser interface to view, add, remove and search albums
- **Search**: Looks up the album on Bandcamp and Qobuz
- **Auto-clean**: When lossless files appear in your local library, the album is
  automatically removed from the wishlist

> **Where is the UI in Roon?** Roon's public extension API only lets an extension draw
> a UI on its **Settings** screen — it does **not** allow extensions to add their own
> entry to Roon's **Browse** sidebar (Home, Genres, Qobuz, …). So inside Roon you'll
> find this under **Settings → Extensions → Wishlist → Settings**. For a fuller
> interface, use the **web UI** (see [Open the Wishlist web UI](#open-the-wishlist-web-ui)).

## Getting started

There are two ways to run this. Pick the one that fits you:

- **A. Install on a Linux server** (recommended) — runs 24/7 next to your Roon Core.
  Best if you want it always available. See [Install on a Linux server](#install-on-a-linux-server).
- **B. Try it on your own computer** (Windows / macOS / Linux) — quick way to test
  before committing to a server. See [Try it on your computer](#try-it-on-your-computer).

You do **not** need to be a developer to follow either path — every step is spelled out.

---

## Install on a Linux server

This extension is a small background program. It can run on the **same Linux machine
as your Roon Server**, or on **any always-on Linux box on the same network** (a
Raspberry Pi, a NAS, a mini-PC, a small VM, …).

> **⚠️ ROCK and Nucleus are NOT supported as the install target.** Roon OS appliances
> (ROCK, Nucleus) are locked down — you cannot install programs on them. If your Roon
> Core runs on ROCK/Nucleus, install this on **another** always-on Linux machine on the
> same network. It will automatically find and connect to your Roon Core over the LAN.

**Tested target: Debian 12 "Bookworm" (amd64 / arm64).** Other modern Linux distros
(Ubuntu, Fedora, Arch, openSUSE) are supported by the installer too. NodeSource only
ships Node.js for `amd64`/`arm64`, so 32-bit ARM (e.g. an older Raspberry Pi OS) needs a
64-bit OS or a manual Node.js install. Requires **Node.js ≥ 20.18.1** (the installer
sets this up for you).

### Option A — fully automatic (recommended): `bootstrap.sh`

**Use this if you just want it running and don't want to install anything yourself.**
Log into your Linux machine (or open its terminal) and paste this **single line**:

```bash
curl -fsSL https://raw.githubusercontent.com/Zesseth/RoonWishlist/main/bootstrap.sh | sudo bash
```

If you already know you want the web UI/API reachable from other devices on your home
LAN, use the installer's `--web` shortcut:

```bash
curl -fsSL https://raw.githubusercontent.com/Zesseth/RoonWishlist/main/bootstrap.sh \
  | sudo bash -s -- --web
```

That's it. `bootstrap.sh` does **everything** for you, automatically:

1. installs **git** if it's missing,
2. downloads (clones) this project to `/usr/local/src/RoonWishlist`,
3. installs **Node.js** (≥ 20.18.1, via NodeSource) if it's missing or too old,
4. installs the app to `/opt/roon-wishlist` and its dependencies,
5. creates a **systemd service** (`roon-wishlist`) that starts on boot and restarts if
   it crashes, and
6. starts it.

When it finishes it prints the service status and what to do next in Roon.

To install or update a **feature branch** on another machine before it is merged to
`main`, use the same bootstrap flow but set `REPO_BRANCH` and download the script from
that branch:

```bash
curl -fsSL https://raw.githubusercontent.com/Zesseth/RoonWishlist/<branch>/bootstrap.sh \
  | sudo REPO_BRANCH=<branch> bash
```

> **On a minimal Debian 12 install** `curl` may not be present yet. If the one-liner
> says `curl: command not found`, install it first:
>
> ```bash
> sudo apt-get update && sudo apt-get install -y ca-certificates curl
> ```

> Prefer to read the script before running it? (A good habit for anything piped into
> `sudo bash`.)
>
> ```bash
> curl -fsSL https://raw.githubusercontent.com/Zesseth/RoonWishlist/main/bootstrap.sh -o bootstrap.sh
> less bootstrap.sh        # read it, press q to quit
> sudo bash bootstrap.sh
> ```

### Option B — I'll clone it myself: `install.sh`

**Use this if you'd rather download the project yourself** (e.g. you already use git, or
you want the source in a specific place). You only clone it — `install.sh` still
installs Node.js for you if it's missing or too old.

```bash
# 1. Get git if you don't have it (Debian/Ubuntu shown; use your distro's tool otherwise)
sudo apt-get update && sudo apt-get install -y git

# 2. Download this project wherever you like
git clone https://github.com/Zesseth/RoonWishlist.git
cd RoonWishlist

# 3. Run the installer
sudo ./install.sh
```

If you want the web UI/API reachable from another device on your LAN, use:

```bash
sudo ./install.sh --web
```

`install.sh` installs the app to `/opt/roon-wishlist`, installs dependencies with
`npm ci` (over **https** — no SSH keys needed), creates the `roon-wishlist` systemd
service, and starts it. If Node.js (≥ 20.18.1) or git are missing — or Node is too old
— it installs/upgrades them for you (supports apt / dnf / yum / pacman / zypper); on
other systems it prints exact instructions. Re-running it later safely updates an
existing install and restarts the service.

> **In short:** `bootstrap.sh` = "install everything for me, including cloning."
> `install.sh` = "I already cloned it, just install and run it." Both end with the same
> running systemd service.

### Finish in Roon

After either option, on any device with Roon open:

1. Go to **Settings → Extensions**. You should see **Wishlist** listed and paired.
2. Click its **Settings**. Set the **Music library path** (the folder where your
   lossless files live on that machine, e.g. `/mnt/music`).
3. Use the **Action** menu to add/remove albums or run *Refresh & clean*. The menu is
   drawn by Roon itself — pick an action, fill the fields if they appear, press
   **Save**.

### Open the Wishlist web UI

The extension also serves a small **web interface** — this is the easiest way to manage
the wishlist. The top-left menu has three views: **Wishlist** (home, current wishlist
only), **Add an album** (add/search), and **Settings** (library path + scan/clean).
From the browser you can view the list, add/remove albums, **search Bandcamp/Qobuz and
add straight from the results**, set the **music library path**, run a **library scan &
clean**, and see whether the extension is **paired** with your Roon Core.

- **From the server itself**, open: <http://127.0.0.1:3141>
- **From another computer on your network** (e.g. the desktop where you run the Roon
  app), the web UI is **off by default** for safety (it binds to localhost only). To
  reach it from other machines, the simplest option is the installer's `--web` flag:

  ```bash
  curl -fsSL https://raw.githubusercontent.com/Zesseth/RoonWishlist/main/bootstrap.sh \
    | sudo bash -s -- --web
  ```

  Or, for a feature branch:

  ```bash
  curl -fsSL https://raw.githubusercontent.com/Zesseth/RoonWishlist/<branch>/bootstrap.sh \
    | sudo REPO_BRANCH=<branch> bash -s -- --web
  ```

  Or, from your own clone:

  ```bash
  sudo ./install.sh --web
  ```

  `--web` is just a shortcut for `HTTP_HOST=0.0.0.0`; use the environment variable only
  if you want a custom host value.

  Then open `http://<server-ip>:3141` (e.g. `http://192.168.1.50:3141`) in any browser.

  > **⚠️ Security note:** `0.0.0.0` makes the UI/API reachable by **any** device on your
  > network with no authentication. That's usually fine on a trusted home LAN, but don't
  > expose port `3141` to the public internet.

### Updating later

```bash
# If you used Option A (bootstrap), just re-run it — it pulls the latest and reinstalls:
curl -fsSL https://raw.githubusercontent.com/Zesseth/RoonWishlist/main/bootstrap.sh | sudo bash

# Or manually, from your clone:
cd /usr/local/src/RoonWishlist && git pull && sudo ./install.sh
```

If you had enabled LAN web access, repeat the same shortcut on update so the service
keeps binding to `0.0.0.0`:

```bash
curl -fsSL https://raw.githubusercontent.com/Zesseth/RoonWishlist/main/bootstrap.sh \
  | sudo bash -s -- --web

cd /usr/local/src/RoonWishlist && git pull && sudo ./install.sh --web
```

### Managing the service

```bash
systemctl status roon-wishlist        # is it running?
journalctl -u roon-wishlist -f        # live logs (Ctrl+C to stop watching)
systemctl restart roon-wishlist       # restart it
sudo systemctl disable --now roon-wishlist   # stop and disable autostart
```

---

## Try it on your computer

Want to test before installing on a server? You can run it on **Windows, macOS or
Linux**. It will find your Roon Core over the network as long as the computer is on the
same LAN.

### 1. Install the prerequisites

- **Node.js LTS** (≥ 20.18.1) — download the installer from <https://nodejs.org/> and
  run it (accept the defaults). This also gives you `npm`.
- **git** — download from <https://git-scm.com/downloads> and install it (defaults are
  fine).

To confirm they're installed, open a terminal (on Windows: **PowerShell**) and run:

```bash
node --version
git --version
```

Both should print a version number.

### 2. Download the project

```bash
git clone https://github.com/Zesseth/RoonWishlist.git
cd RoonWishlist
```

### 3. Install dependencies

Use `npm ci` (**not** `npm install`):

```bash
npm ci
```

> **Why `npm ci` and not `npm install`?** The Roon API packages are pulled from
> GitHub. `npm install` rewrites the lockfile's `resolved` URLs to `git+ssh://`, which
> fails on any machine without GitHub SSH keys. `npm ci` installs exactly what the
> committed lockfile specifies — `git+https://` URLs that work everywhere with no SSH
> setup. (Only if you deliberately add a new dependency with `npm install <pkg>`,
> re-assert `git+https://` in `package-lock.json`'s `resolved` fields before
> committing.)

### 4. Run it

```bash
node index.js
```

Leave this window open — the extension runs as long as this command runs. Press
**Ctrl+C** to stop it.

### 5. Finish in Roon

1. Open Roon → **Settings → Extensions → Wishlist** (it should appear and pair
   automatically).
2. Open its **Settings**, set the **Music library path** (e.g. `D:\Music` on Windows,
   `/Users/you/Music` on macOS).
3. Use the **Action** menu to add/remove albums or run *Refresh & clean* — pick an
   action, fill the fields if shown, press **Save**.

---

## Configuration (optional)

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ROON_WISHLIST_DATA_DIR` | `<repo>/data` | Where `wishlist.json` is stored. |
| `ROON_WISHLIST_HTTP_HOST` | `127.0.0.1` | HTTP API bind address. Set to `0.0.0.0` to expose it on the LAN (⚠️ this makes the control API reachable by other machines — use with care). |
| `ROON_WISHLIST_HTTP_PORT` | `3141` | HTTP API port. |

> Note: the Roon pairing token is stored in `config.json` in the service's working
> directory, so the service user must own the install directory (the script handles
> this).

You can override the install location and these settings by passing them to either
script:

```bash
# with bootstrap.sh
curl -fsSL https://raw.githubusercontent.com/Zesseth/RoonWishlist/main/bootstrap.sh \
  | sudo INSTALL_DIR=/opt/roon-wishlist DATA_DIR=/var/lib/roon-wishlist \
         SERVICE_USER=roon HTTP_HOST=127.0.0.1 HTTP_PORT=3141 bash

# with install.sh (from your clone)
INSTALL_DIR=/opt/roon-wishlist DATA_DIR=/var/lib/roon-wishlist \
SERVICE_USER=roon HTTP_HOST=127.0.0.1 HTTP_PORT=3141 \
sudo -E ./install.sh
```

The manual systemd unit template is in
[`deploy/roon-wishlist.service`](./deploy/roon-wishlist.service) if you'd rather wire it
up by hand.

For the common "make the UI visible on my LAN" case, you do not need to remember the
full `HTTP_HOST=0.0.0.0` form — both installers support:

```bash
# bootstrap.sh
curl -fsSL https://raw.githubusercontent.com/Zesseth/RoonWishlist/main/bootstrap.sh \
  | sudo bash -s -- --web

# install.sh
sudo ./install.sh --web
```

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
bootstrap.sh          ← one-command Linux installer (installs git/Node, clones, runs install.sh)
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
