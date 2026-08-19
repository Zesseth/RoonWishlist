# Testing guide

A checklist you can work through top to bottom. Every test says what to do, what you
should see, and where to report it if it goes wrong.

- **Time needed:** about 30 minutes for everything, 10 for part 1 alone.
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
2. **Expect:** a **Music storage locations** panel, a **Library path** field with a
   **Save path** button, and a **Scan low-quality albums now** button
3. **Expect:** a **Danger Zone** with **Clear & rebuild from Roon tag** and
   **Clear & rebuild low-quality albums**
4. Change the library path, press **Save path**, reload the page
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

### Test 8 — Albums added by hand are never deleted by a sync

Manual adding is in **Roon's settings screen**, not the web UI (my earlier instructions
pointed you at the wrong place — sorry).

1. **Roon → Settings → Extensions → Wishlist → Settings**
2. Under **Actions**, pick *Add album to wishlist*, fill in Artist and Album title,
   press **Save**
3. In the web UI, press **Sync Roon tag**
4. **Expect:** the album you added by hand is **still there**, even though it carries no
   Roon tag

The more important everyday case is the same rule: your **135 low-quality albums** were
found by scanning, not by the tag, so a sync must never touch them either. This has
already been verified live on your install — a `/reconcile` run found the tag, and
removed nothing.

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

### Test 9 — What does Roon actually report?

This is the question the whole issue hangs on, and it needs the extension paired.

1. Go to **Settings** → **Music storage locations**
2. Press **Refresh from Roon**
3. **Expect:** the message now tells you the outcome. Either *"Roon reported N storage
   location(s)"*, or *"Roon reported no storage locations"* followed by the reason.

You reported this button as doing nothing. It was in fact querying Roon every time — but
it always said "Storage locations refreshed", which is indistinguishable from a button
that is wired to nothing. It now reports what Roon answered.

Expected on Roon 2.71: no storage locations, because Roon's browsable settings contain
no Storage or Library entry. If instead it lists your real music folders, that is
genuinely new and worth reporting on issue #15 with your Roon version.

### Test 10 — Several library folders at once

1. In **Settings**, set the library path to both fixture folders:

   ```
   /var/tmp/roon-wishlist-fixture/libA; /var/tmp/roon-wishlist-fixture/libB
   ```

2. Press **Save path**
3. **Expect:** the storage panel lists **both** folders, each marked *typed here*, and
   says two of two locations will be scanned

### Test 11 — Removing and excluding a folder

The two buttons now mean different things, which is the change you asked for.

1. **Expect:** each folder you typed has a **Remove** button
2. Press **Remove** on `libB` and confirm
3. **Expect:** it disappears from the list *and* from the Library path field — it is
   genuinely gone, not just skipped
4. Put it back by typing the path again and pressing **Save path**

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
2. Press **Save path**
3. **Expect:** the storage panel marks the missing folder as unreadable, and scans still
   run against the folder that works

An unmounted NAS must never look like "you own nothing", because that would delete
nothing but would report your whole library as missing.

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

---

## Troubleshooting

**It will not pair.** Restart Roon, then `sudo systemctl restart roon-wishlist`, then
check Roon → Settings → Extensions and enable Wishlist.

**Tagged albums do not appear.** Check the tag is exactly `Wishlist` (case-sensitive),
press **Sync Roon tag**, and confirm the status chip says paired — browse access is
needed to read tags.

**The low-quality scan finds nothing.** Check the library path in Settings, and that the
folders are laid out as `Artist/Album/tracks.*`.

**Store search returns nothing.** It needs internet access; it queries Bandcamp and
Qobuz.

**The web UI is unreachable from another machine.** The server binds to `127.0.0.1`
unless started with `--web`. Reinstall with `sudo ./install.sh --web`.

**Permission denied writing data.** `sudo chown -R roon:roon /var/lib/roon-wishlist`,
and check `journalctl -u roon-wishlist -f`.
