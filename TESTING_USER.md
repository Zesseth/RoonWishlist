# Testing guide

A checklist you can work through top to bottom. Every test says what to do, what you
should see, and where to report it if it goes wrong.

- **Time needed:** about 40 minutes for everything, 10 for part 1 alone.
- **Where you test:** `http://192.168.1.100:3141` — the normal install, on the server.
- **What you need:** the Roon app, to tag albums and to look at the extension settings.

Record each test as pass or fail. If it fails, note *what you saw instead* — that is
the part that is actually useful.

---

## Step 1 — Install the version under test

There is **one** install, and it is the one you already use. You upgrade it in place to
the branch you want to test. There is no second instance, no separate port, and nothing
to enable in Roon afterwards.

```bash
cd /repos/RoonWishlist
git fetch origin
git checkout feat/roon-storage-locations
git pull
sudo ./install.sh --web
```

`/repos/RoonWishlist` is the working copy on this server. `--web` binds the web UI to
the LAN so you can reach it from another machine.

**Your Roon pairing and your wishlist both survive the upgrade.** The pairing token is
in `config.json` in the install directory and is explicitly preserved; the wishlist is
in the data directory, which the installer never touches. The extension comes back
already enabled in Roon.

> This was broken until recently: the installer deleted `config.json` on every upgrade,
> so the extension came back unpaired and stopped syncing, with no clear symptom.
> Test 1 below checks that this stays fixed.

Check it came back up:

```bash
systemctl is-active roon-wishlist          # expect: active
curl -s http://127.0.0.1:3141/status       # expect: "paired": true
```

> **Already verified on this server (2026-08-19):** the service is `active`, paired with
> `ParadoxRoon`, browse is available, and the deployed files match the branch. The
> wishlist holds 136 albums (135 low-quality + 1 Roon-tagged). A live `/reconcile` ran
> clean: it found the tag, added nothing, and — correctly — removed nothing, leaving all
> 135 low-quality entries alone. So Step 1 and Test 1 are done; start from Test 2.

If you want a fallback before upgrading:

```bash
sudo cp -a /opt/roon-wishlist ~/roon-wishlist-backup
sudo cp -a /var/lib/roon-wishlist/wishlist.json ~/wishlist.json.bak
```

To roll back: copy the backup over `/opt/roon-wishlist` and
`sudo systemctl restart roon-wishlist`.

---

## Step 2 — The test library

Tests 8–12 need albums whose exact contents are known, so a small fake library sits on
the server. The files are empty — only their extensions matter, which is all the
detection logic looks at. Nothing here touches your real music.

```
/var/tmp/roon-wishlist-fixture/
  libA/Opeth/Blackwater Park/              5 x .flac
  libA/Portishead/Dummy/                   5 x .mp3
  libA/Tool/Lateralus/                     9 x .mp3 + 1 x .flac
  libA/Miles Davis/Kind of Blue/           3 x .wav
  libA/Nils Frahm/Spaces/                  3 x .aiff
  libA/Radiohead/In Rainbows/              3 x .mp3
  libB/Pink Floyd/Wish You Were Here/      3 x .dsf
  libB/Radiohead/In Rainbows/              3 x .flac
```

If it is missing (`/var/tmp` is cleared by some reboots), recreate it with
`./scripts/make-test-fixture.sh`.

> **Switching the library path is destructive to your low-quality list.** "Clear &
> rebuild low-quality albums" empties that list and rebuilds it from whatever path is
> configured at that moment, so pointing it at the fixture replaces your real
> low-quality list with eight fake albums.
>
> It is fully recoverable — set the path back to `/music` and rebuild again — but do
> tests 8–12 in one go, then put the path back.

---

## Part 1 — Does it still work at all?

These are quick and catch an upgrade that went wrong.

### Test 1 — The upgrade kept your pairing and your data

1. Open `http://192.168.1.100:3141`
2. **Expect:** the status chip says **Paired with Roon**, and you did **not** have to
   enable anything in Roon
3. **Expect:** your wishlist has the same albums it had before the upgrade
4. Run `systemctl is-active roon-wishlist` → **expect** `active`

### Test 2 — Navigation

1. Click the menu button (☰)
2. **Expect:** exactly three items — **Wishlist**, **Low-quality albums**, **Settings**
3. Click each one
4. **Expect:** the right section opens, and only one is highlighted at a time

### Test 3 — The wishlist list

1. Go to **Wishlist**
2. **Expect:** each album shows artist, title, and when it was added
3. **Expect:** buy links (Bandcamp / Qobuz) are **already visible** for albums that have
   them — you should *not* need to press anything to see them
4. Press **Find in stores** on an album that has no links yet
5. **Expect:** links appear for it
6. **Expect: there is no Remove button here.** The note under the heading tells you to
   remove the Wishlist tag in Roon instead.

Point 6 is a change you asked for. A Remove button on this list was misleading: Roon is
the master, so the next sync simply brought the album back. The tag is the only real way
to take something off this list. (The **Low-quality albums** list still has Remove —
that list is local data, not a mirror of Roon.)

### Test 4 — Settings page

1. Go to **Settings**
2. **Expect:** a **Music folders** panel at the top with a path field and a
   **Save folders** button, and a **Scan low-quality albums now** button
3. **Expect:** a **Danger Zone** with **Clear & rebuild from Roon tag** and
   **Clear & rebuild low-quality albums**
4. Change the folder path, press **Save folders**, reload the page
5. **Expect:** the path you typed is still there

### Test 5 — Empty states

> Do this **during Part 3**, when the wishlist holds fixture albums, not now. Emptying
> the list here would throw away your 135 real low-quality entries. Rebuilding them is
> possible but slow and pointless.

1. With only fixture albums on the list, remove them all
2. **Expect** in **Wishlist**: *Wishlist is empty. Tag albums with "Wishlist" in Roon to
   populate it.*
3. **Expect** in **Low-quality albums**: *No low-quality albums on wishlist.*

---

## Part 2 — Roon tag sync ([issue #31](https://github.com/Zesseth/RoonWishlist/issues/31))

**Roon is the master.** What the `Wishlist` tag holds in Roon is what the wishlist
should contain — including when you take albums *off* the tag. This did not work
before: sync only ever added, so untagged albums stayed on the list forever.

The tag name is exactly `Wishlist`, case-sensitive.

### Test 6 — Tagging adds, untagging removes

1. In Roon, tag **two** albums with `Wishlist`
2. In the web UI, press **Sync Roon tag**
3. **Expect:** both albums appear, and the status line says `added 2`
4. In Roon, remove the tag from **one** of them
5. Press **Sync Roon tag** again
6. **Expect:** that album is **gone** from the wishlist, and the status line says
   `removed 1`

Step 6 is the actual fix. Previously the album stayed and the list quietly drifted out
of step with Roon.

### Test 7 — Untagging everything empties it, and does not error

1. In Roon, remove the `Wishlist` tag from **every** album
2. Press **Sync Roon tag**
3. **Expect:** no error. The tag-derived albums are gone, and the status line mentions
   that the tag was treated as empty.

This failed when you tested it, and the fix was incomplete: a tag that has been emptied
but **still exists** in Roon opens as a level with no albums under it, and that path
still threw *"the album list could not be opened"*. Three shapes of "empty" are now all
read as empty — the tag is gone from the tag list, the tag exists but holds nothing, and
the tag exists but Roon answers with a "nothing to show" message.

Not being able to reach Roon at all still reports an error, and correctly so: failing to
look must never be mistaken for an empty tag, or a dropped connection would wipe the
list.

### Test 8 — Adding an album by hand is gone

You asked for this to be removed outright, so it is: there is no way to type an album
onto the wishlist any more, in the web UI or in Roon.

1. **Roon → Settings → Extensions → Wishlist → Settings**
2. Open the **Actions** dropdown
3. **Expect:** there is **no** *Add album to wishlist* entry. The remaining actions are
   *Remove album from wishlist*, *Refresh & clean* and *Scan low-quality albums*.

The rule this used to test still holds and still matters: a sync only ever removes
albums that came **from the tag**. Your **135 low-quality albums** were found by
scanning, so a sync must never touch them. That was verified live on your install — a
`/reconcile` run found the tag and removed nothing.

---

## Part 3 — Storage locations and lossless detection ([issue #15](https://github.com/Zesseth/RoonWishlist/issues/15))

What changed, in plain terms:

1. The extension **asks Roon** where your music is stored, instead of relying only on a
   typed path. (Spoiler: on current Roon versions it answers nothing — Test 9 is about
   confirming that and seeing *why*.)
2. The manual path accepts **several folders**, separated by `;`.
3. You can **exclude** a folder from scanning.
4. **"Lossless" no longer means "FLAC only"** — WAV, AIFF, APE, WavPack, ALAC and DSD
   count too.
5. An album is removed **only when the whole album is lossless**. One FLAC track among
   ten MP3s no longer counts as owning it.

### Test 9 — Roon does not supply the folders, so you configure them

You were right that something was wrong here, and right to push back. The answer turned
out to be that **Roon never gives extensions its storage folders** — not that yours are
missing. Three independent checks agree:

- Roon's SDK registers no service that could carry them (only browse, settings, status,
  pairing, ping, registry).
- Asking your own Core returns only *Profile* and *Display Settings*, with nothing
  storage-shaped inside either.
- Roon's own position, per their API documentation and community answers, is that
  storage configuration is not offered to third parties.

So the feature has been turned the right way round: **the folders you configure here are
the source**, not a fallback. The misleading *Refresh from Roon* button is gone — a
button that can only ever fail is worse than no button — and the same action has been
removed from Roon's own settings screen.

1. Go to **Settings**
2. **Expect:** the first thing on the page is **Music folders**, with your folders in the
   box and a **Save folders** button
3. **Expect:** underneath, one line of explanation, and a small collapsed *Why not from
   Roon?* that opens to show exactly what Roon did offer
4. **Expect:** there is **no** *Refresh from Roon* button anywhere
5. In **Roon → Settings → Extensions → Wishlist → Settings**, open the **Action**
   dropdown
6. **Expect:** no *Refresh storage locations from Roon* entry

If some future Roon does start exposing storage, the probe still runs once when pairing
and would show up here. It is no longer run before every scan, since the answer does not
change.

### Test 10 — Several library folders at once

1. In **Settings** → **Music folders**, enter both fixture folders:

   ```
   /var/tmp/roon-wishlist-fixture/libA; /var/tmp/roon-wishlist-fixture/libB
   ```

2. Press **Save folders**
3. **Expect:** the panel below lists **both** folders, each marked *typed here*, and
   says two of two locations will be scanned

### Test 11 — Removing and excluding a folder

The two buttons now mean different things, which is the change you asked for.

1. **Expect:** each folder you typed has a **Remove** button
2. Press **Remove** on `libB` and confirm
3. **Expect:** it disappears from the list *and* from the Music folders box — it is
   genuinely gone, not just skipped
4. Put it back by typing the path again and pressing **Save folders**

If Roon ever does report a folder, that entry gets an **Exclude** button instead of
Remove, and its line says *remove it in Roon*. A Roon-supplied path is not ours to
delete — deleting it here would only bring it back at the next refresh — but you can
still stop it being scanned.

> On Roon 2.71 you will not see a Roon-supplied entry at all, so only the Remove button
> is testable today. Excluding is still exercised by the Roon settings screen and by the
> automated tests.

### Test 12 — The detection rules

Put all eight fixture albums on the wishlist, plus one that exists nowhere (e.g.
*Nobody — Missing Album*). With the library path set to both fixture folders, run
**Clear & rebuild low-quality albums** once.

| Album | Expect | Why |
|---|---|---|
| Opeth — Blackwater Park | **removed** | every track FLAC |
| Miles Davis — Kind of Blue | **removed** | every track WAV — lossless, but not FLAC |
| Nils Frahm — Spaces | **removed** | every track AIFF |
| Pink Floyd — Wish You Were Here | **removed** | every track DSD, and it is in the *second* folder |
| Radiohead — In Rainbows | **removed** | MP3 in libA but FLAC in libB — owning it anywhere counts |
| Portishead — Dummy | **kept** | every track MP3 — you still want it in lossless |
| Tool — Lateralus | **kept** | 1 FLAC among 10 — **the main fix**; this used to be deleted |
| Nobody — Missing Album | **kept** | not in the library at all |

The four "removed" rows on lines 2–4 are the second fix: those albums were previously
kept and offered for purchase even though you already owned them properly, because only
`.flac` counted.

### Test 13 — Per-album status in Roon's own settings screen

Roon has no table widget, so the status is written into the wishlist text itself.

1. Run any scan
2. Open **Roon → Settings → Extensions → Wishlist → Settings**
3. **Expect:** under *Current wishlist*, each album has a second line:

   ```
   1. Tool — Lateralus
        ↳ in library, only partly lossless — still wanted (1/10 tracks lossless)
   2. Portishead — Dummy
        ↳ in library, lossy — still wanted
   3. Nobody — Missing Album
        ↳ not in library
   ```

4. **Expect:** an album you added by hand and have not scanned yet shows **no** second
   line, rather than a misleading "not in library"
5. Run `sudo systemctl restart roon-wishlist` and reopen the settings screen
6. **Expect:** the statuses are still there

Fully lossless albums never appear in this list — they have just been removed, which is
the point.

### Test 14 — An unreachable folder is not treated as an empty library

1. Set the library path to include a folder that does not exist, e.g.
   `/var/tmp/roon-wishlist-fixture/libA; /mnt/not-mounted`
2. Press **Save folders**
3. **Expect:** the folder list marks the missing folder as unreadable, and scans still
   run against the folder that works

An unmounted NAS must never look like "you own nothing", because that would delete
nothing but would report your whole library as missing.

> **Set the path back to `/music` before you go on.** Tests 10, 11 and 14 all change the
> library path, and leaving a wrong one behind makes every later test look broken: nothing
> is found in the library, so nothing can be recognised as already owned. This is exactly
> what happened on your install — the path was left as `/mnt/music`, which does not
> exist. A check that cannot run now says so instead of quietly reporting "not found".

---

## Part 4 — Albums you already own in lossless ([issue #32](https://github.com/Zesseth/RoonWishlist/issues/32))

You tagged *Nachtmystium — The World We Left Behind* and it appeared on the wishlist even
though you already own it as FLAC. That was wrong, and the cause was simple: the tag sync
added every tagged album without ever looking at your library.

It now checks. A tagged album that already has a **complete lossless copy** is no longer
listed as wanted — it moves to its own section, **Already owned in lossless**, on the
wishlist page.

It is **not deleted**, deliberately. Roon is the master for tagged albums, so deleting it
here would only mean the next sync added it straight back. The thing that is stale is the
tag, and the tag lives in Roon.

### Test 15 — An album you already own moves out of the wishlist

**Check the library path first:** Settings → it must say `/music`. See the warning under
Test 14.

1. In Roon, tag an album you **own as FLAC** (or any lossless format) with `Wishlist`
2. In the web UI, press **Sync Roon tag**
3. **Expect:** it does **not** appear in the main wishlist. A second panel, *Already
   owned in lossless*, appears below it and lists the album.
4. **Expect:** the message after the sync mentions `already owned 1`
5. **Expect:** the album in that panel has **no *Find in stores* button and no buy
   links** — you already own it, so there is nothing to shop for. Any links it had are
   dropped when it moves there, and later syncs stop looking up stores for it.
6. **Expect:** under the panel, a line saying whether Roon lets the extension remove the
   tag for you. It is measured against your Core, not assumed.

*Nachtmystium — The World We Left Behind* is the exact case to try, since that is the one
that failed. Its folder is named `Nachtmystium/Nachtmystium - The World We Left Behind`,
with the artist repeated, and that layout is now covered by a test.

### Test 15b — A check that cannot run says so

The first time round this failed silently: the library path was pointing at a folder that
does not exist, so nothing could be found, and the sync still reported plain success.

1. In Settings, set the library path to `/mnt/not-a-real-folder`
2. Press **Save folders**, then press **Sync Roon tag**
3. **Expect:** a red message — *"Synced, but could not check what you already own: no
   readable storage location…"*. It must **not** claim success, and albums already marked
   as owned must **not** move back onto the wishlist.
4. Set the path back to `/music` and sync again

### Test 16 — An album you own only as MP3 is still wanted

1. In Roon, tag an album you own only in a lossy format
2. Press **Sync Roon tag**
3. **Expect:** it stays in the **main wishlist**, with buy links. It must **not** be
   moved to *Already owned*.

An album where only *some* tracks are lossless also stays wanted — half an album in FLAC
is not owning it.

### Test 17 — Removing the tag in Roon clears it from both lists

1. In Roon, remove the `Wishlist` tag from the album used in Test 15
2. Press **Sync Roon tag**
3. **Expect:** the *Already owned in lossless* panel disappears (or loses that album)

### Test 18 — Can the extension untag albums in Roon for you?

**Measured on your Core, 2026-08-19:** `supported: false` — Roon offered only *Shuffle*
and *Start Radio*, no tag editing. One flaw in that first measurement has since been
fixed (it had opened the tag's own *Play Tag* row instead of an album), so please re-run
it once after this upgrade to confirm the verdict on a real album.


You asked for a button that removes the tag in Roon for albums you already own. Roon's
documented Browse API has no tag-writing method, so the honest answer so far is "no" —
but that answer was written from reading the SDK, not from asking your actual Core, and
I got a similar assumption wrong earlier in this branch. So there is now a check that
asks Roon directly.

With at least one album tagged `Wishlist`, run this on the server:

```bash
curl -s http://localhost:3141/roon-tag/write-support | head -40
```

**Expect** JSON listing every action Roon offers on a tagged album, plus a verdict:

- `"supported": false` — Roon offers no tag-editing action, so the button genuinely
  cannot be built. This is the expected result.
- `"supported": true` — Roon does offer one, and the button becomes possible. Paste the
  output into issue #32 and it will be implemented.

Either way, **paste the `offered` list into issue #32**. That is the measurement that
settles it. Nothing in this test changes anything — it only navigates and reads.

Until then, the *Already owned in lossless* panel is your work list: remove the
`Wishlist` tag from those albums in Roon yourself.

---

## When you are done

Set the library path back to your real library:

```
/music
```

and run **Clear & rebuild low-quality albums** once to restore the real list.

---

## The two scan actions are not the same

Frequently confused:

| Action | What it does |
|---|---|
| **Scan low-quality albums now** | Scans and **adds** albums that are not fully lossless. Purely additive — never removes. |
| **Clear & rebuild low-quality albums** | Empties the low-quality entries, **removes** wishlist albums the library has a complete lossless copy of, then re-runs the scan to add them back from scratch. |

A rebuild will never remove an album *for being low quality* — a low-quality album is by
definition not fully lossless, which is exactly why it stays. If your wishlist holds
only low-quality entries, a rebuild that removes nothing is correct.

Whether these should be one button is [issue #28](https://github.com/Zesseth/RoonWishlist/issues/28).

---

## Where to report

| Tests | Report on |
|---|---|
| 1–5 | a new issue, unless it is obviously covered by an existing one |
| 6–8 | [issue #31](https://github.com/Zesseth/RoonWishlist/issues/31) |
| 9–14 | [issue #15](https://github.com/Zesseth/RoonWishlist/issues/15) — include your Roon version for Test 9 |
| 15–18 | [issue #32](https://github.com/Zesseth/RoonWishlist/issues/32) — paste the Test 18 output there |

---

## Troubleshooting

**It will not pair.** Restart Roon, then `sudo systemctl restart roon-wishlist`, then
check Roon → Settings → Extensions and enable Wishlist.

**Tagged albums do not appear.** Check the tag is exactly `Wishlist` (case-sensitive),
press **Sync Roon tag**, and confirm the status chip says paired — browse access is
needed to read tags.

**The low-quality scan finds nothing.** Check the library path in Settings, and that the
folders are laid out as `Artist/Album/tracks.*`.

**An album I own is still on the wishlist.** Check the library path in Settings first —
it should be `/music`. If the path is wrong, nothing can be found and nothing can be
recognised as owned. Then press **Sync Roon tag** and read the message: if it says
*"could not check what you already own"*, that is the reason.

**Store search returns nothing.** It needs internet access; it queries Bandcamp and
Qobuz.

**The web UI is unreachable from another machine.** The server binds to `127.0.0.1`
unless started with `--web`. Reinstall with `sudo ./install.sh --web`.

**Permission denied writing data.** `sudo chown -R roon:roon /var/lib/roon-wishlist`,
and check `journalctl -u roon-wishlist -f`.
