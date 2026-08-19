# User Testing Guide - RoonWishlist

This guide helps you manually test the RoonWishlist extension features after the UI cleanup changes.

---

## Before You Start

### 1. Install and Run the Extension

**Use the installer scripts** (recommended for Linux servers):

```bash
# Fully automatic - clones, installs, and runs everything
curl -fsSL https://raw.githubusercontent.com/Zesseth/RoonWishlist/main/bootstrap.sh \
  | sudo REPO_BRANCH=main bash

# If you want the web UI accessible from other devices on your LAN:
curl -fsSL https://raw.githubusercontent.com/Zesseth/RoonWishlist/main/bootstrap.sh \
  | sudo REPO_BRANCH=main bash -s --web
```

**OR manual installation:**

```bash
# Clone the repository
git clone https://github.com/Zesseth/RoonWishlist.git
cd RoonWishlist

# Switch to the UI cleanup branch
git checkout main

# Run the installer
sudo ./install.sh          # Localhost only
# OR for LAN access:
sudo ./install.sh --web
```

The extension will be available at: http://localhost:3141 (or your server IP if using --web)

### Testing a feature branch alongside the working install

When you want to try an unreleased branch **without disturbing the install you rely
on**, run it as a second instance. Roon identifies an extension by its `extension_id`,
so the test build must announce a different one — otherwise the two instances fight
over the pairing and the working install stops responding.

```bash
git clone https://github.com/Zesseth/RoonWishlist.git roonwishlist-test
cd roonwishlist-test
git checkout feat/roon-storage-locations
sudo ./install.sh --web --instance test
```

That gives you a second service with its own port (3142 by default), its own data
directory and its own entry in Roon's extension list, so both can be paired at the
same time. The web UI header shows the instance name, so you always know which one you
are looking at.

| | Main install | Test instance |
|---|---|---|
| Service | `roon-wishlist` | `roon-wishlist-test` |
| Web UI | `http://<server-ip>:3141` | `http://<server-ip>:3142` |
| Shown in Roon as | Wishlist | Wishlist (test) |
| Data | `/var/lib/roon-wishlist` | `/var/lib/roon-wishlist-test` |

To remove the test instance afterwards (its data directory is kept):

```bash
sudo ./install.sh --uninstall --instance test
```

### 2. Pair with Roon

1. Open Roon
2. Go to **Settings -> Extensions**
3. Find **Wishlist** and click **Enable**
4. Verify: Status chip in Web UI shows "Paired with Roon"

---

## Feature Tests

### Test 1: Menu Navigation

**What changed:** "Add an album" removed from menu. New structure with 3 items.

**Steps:**
1. Open Web UI: http://localhost:3141
2. Click the menu button (☰) in top-left
3. **Verify:** Menu shows exactly these 3 items:
   - Wishlist
   - Low-quality albums
   - Settings
4. **Verify:** "Add an album" is NOT in the menu
5. Click each menu item
6. **Verify:** Correct section opens for each
7. **Verify:** Only one section is "active" (highlighted) at a time

**Results:**
✅ Works correctly.

---

### Test 2: Wishlist Section (Roon-tagged albums only)

**What changed:** This section now shows ONLY albums tagged with "Wishlist" in Roon. No ignore button.

**Steps:**
1. In Roon: Find an album and tag it with **"Wishlist"** (case-sensitive)
2. In Web UI: Click **"Sync Roon tag"** button (in Wishlist section toolbar)
3. **Verify:** Tagged album appears in the Wishlist section
4. **Verify:** Album shows:
   - Artist name
   - Album title
   - "added [date]" metadata
   - NO "Ignore" button (managed via Roon tags only)
5. Click **"Find in stores"** for the album
6. **Verify:** Bandcamp and Qobuz search results appear below the album
7. Click **"Remove"** button
8. **Verify:** Album is removed from wishlist

**Expected behavior:**
- ✅ Only Roon-tagged albums appear here
- ✅ No ignore button (managed via Roon tags)
- ✅ "Find in stores" works
- ✅ "Remove" works

**Results:**
✅ **FIXED** - Now works correctly with legacy items.

---

### Test 3: Low-Quality Albums Section

**What changed:** Now shows albums that are not fully lossless, with full functionality. Scan button moved to Settings.

**Steps:**
1. In Web UI: Go to **Settings -> Library**
2. Set **"Music library path"** to your music folder (e.g., `/mnt/music` or `C:\Music`)
3. Click **"Scan low-quality albums now"** (in Library section)
4. Navigate to **Low-quality albums** section
5. **Verify:** Scan completes and albums that are not fully lossless appear
6. For each album in the list:
   - **Verify:** Shows artist and title
   - **Verify:** Shows a lossless track count (e.g. "5/10 lossless tracks")
   - **Verify:** Has "Find in stores" button
   - **Verify:** Has "Ignore" button
   - **Verify:** Has "Remove" button
7. Click **"Find in stores"** for an album
8. **Verify:** Bandcamp and Qobuz links appear
9. Click **"Ignore"** for an album
10. **Verify:** Album is removed from list
11. Run scan again
12. **Verify:** Ignored album does NOT reappear

**Expected behavior:**
- ✅ Albums that are not fully lossless appear with track counts
- ✅ Fully lossless albums are NOT added
- ✅ Ignore button works and prevents re-adding
- ✅ "Find in stores" works
- ✅ "Remove" works

**Results:**
✅ **FIXED** - Now works correctly with legacy low-quality items (quality metadata preserved).

---

### Test 4: Settings Page

**What changed:** 
- Library section now has: Library path input, Save path button, **"Scan low-quality albums now"** button
- Danger Zone now has: **"Scan & clean now"** and **"Clear & rebuild from Roon tag"** buttons

**Steps:**
1. Click **Settings** in menu
2. **Verify:** Library section shows:
   - Library path input field
   - "Save path" button
   - "Scan low-quality albums now" button
3. Set a library path and save
4. Refresh page
5. **Verify:** Path is preserved
6. **Verify:** Danger Zone section shows:
   - "Scan & clean now" button
   - "Clear & rebuild from Roon tag" button

**Results:**
✅ Path is preserved and works. UI reorganization completed.

---

### Test 5: Empty States

**What changed:** Updated empty state messages.

**Steps:**
1. Clear your wishlist (remove all albums)
2. Go to **Wishlist** section
3. **Verify:** Shows: "Wishlist is empty. Tag albums with "Wishlist" in Roon to populate it."
4. Go to **Low-quality albums** section
5. **Verify:** Shows: "No low-quality albums on wishlist."

**Results:**
✅ Works correctly.

---

## Storage locations & lossless detection (issue #15)

> These tests cover the `feat/roon-storage-locations` branch. Run them on the **test
> instance** (port 3142) so your working install stays untouched.

### What changed, in plain terms

1. **You no longer have to type a library path.** The extension asks Roon where your
   music is stored and scans those folders. The manual path still works as an override
   and as a fallback for when Roon does not report anything.
2. **You can exclude a folder** from scanning, in the web UI or in Roon's own settings.
3. **"Lossless" no longer means "FLAC only."** WAV, AIFF, APE, WavPack, ALAC and DSD
   now count too.
4. **An album is only removed when the *whole* album is lossless.** One FLAC track
   among ten MP3s no longer counts as owned.
5. **The result tells you what was kept and why** instead of just a number.

### Test A: See where the extension is scanning

1. Open the test web UI: `http://<server-ip>:3142`
2. Go to **Settings**
3. **Verify:** the "Music storage locations" panel lists at least one folder
4. **Verify:** each entry says whether it is `scanned` or `excluded`, and whether it
   came `from Roon` or is `manual`
5. Click **Refresh from Roon**
6. **Verify:** the list reloads without error

> If the list says "No storage location detected", Roon did not expose its storage
> settings over the API. That is a known Roon limitation, not a bug — type a path into
> "Library path (override / fallback)" and the rest of the tests still apply. Please
> note in the issue which Roon version you are on.

### Test B: Exclude a folder

1. In **Settings**, click **Exclude** next to a location
2. **Verify:** it flips to `excluded` and the count line at the bottom decreases
3. **Verify:** the same change is visible in Roon → Settings → Extensions →
   Wishlist (test) → the "Music storage locations" list
4. Exclude **every** location
5. Try **Clear & rebuild low-quality albums**
6. **Verify:** you get a clear error — "Every storage location is excluded…" — rather
   than a scan that silently finds nothing
7. Click **Include** to restore it

### Test C: A whole-album lossless copy is removed

1. Pick an album you own where **every** track is FLAC (or WAV/AIFF/ALAC)
2. Add it to the wishlist
3. Run **Scan & clean now**
4. **Verify:** it is removed, and the status message says
   "removed 1 fully lossless album(s)"

### Test D: A lossy album is kept, and says so

1. Pick an album you own only as MP3
2. Add it to the wishlist
3. Run **Scan & clean now**
4. **Verify:** it is **still on the wishlist**
5. **Verify:** the message includes "kept (lossy only)"

### Test E: A part-lossless album is kept, not silently removed

This is the main correctness fix.

1. Find (or make) an album folder with a mix, e.g. 9 × `.mp3` and 1 × `.flac`
2. Add it to the wishlist
3. Run **Scan & clean now**
4. **Verify:** it is **still on the wishlist** — the old behaviour would have deleted
   it because it contained "a" lossless file
5. **Verify:** the message includes "kept (only partly lossless)"
6. **Verify:** the album row shows something like "1/10 lossless tracks - partly lossless"

### Test F: Non-FLAC lossless formats count

1. Find an album you own entirely as WAV, AIFF, ALAC or DSD
2. Add it to the wishlist
3. Run **Scan & clean now**
4. **Verify:** it is removed. Previously only FLAC counted, so this album would have
   been wrongly kept and offered for purchase.

### Test G: Same album in two places

Only relevant if Roon reports more than one storage location.

1. Ensure the same album exists as MP3 in one location and FLAC in another
2. Add it to the wishlist
3. Run **Scan & clean now**
4. **Verify:** it is removed — owning a proper copy anywhere means you own it
5. Run **Scan low-quality albums now**
6. **Verify:** it is **not** re-added as a low-quality album

### Test H: The main install is undisturbed

1. Open `http://<server-ip>:3141`
2. **Verify:** it still loads and still says "Paired"
3. **Verify:** Roon → Settings → Extensions lists **both** "Wishlist" and
   "Wishlist (test)"

### What to report

For each test, note pass/fail and — if it failed — what you saw instead. Post it on
[issue #15](https://github.com/Zesseth/RoonWishlist/issues/15). Include your Roon
version for Test A.

---

## Understanding the two scan actions

These are frequently confused during testing. They are **separate, opposite** actions:

| Action | Direction | What it does |
|---|---|---|
| **Scan & clean now** | Removes | Removes an album from the wishlist when the library holds a **complete lossless** copy of it |
| **Scan low-quality albums now** | Adds | Scans the library and **adds** albums that are *not* fully lossless |

So "Scan & clean now" will never add anything, and it will never remove a low-quality
album — a low-quality album is by definition not fully lossless, which is exactly why
it stays. A clean that removes nothing is normal when your wishlist contains only
low-quality entries; since issue #15 the result message says so explicitly.

Whether these two should be merged into one button is an open design question tracked
in [issue #28](https://github.com/Zesseth/RoonWishlist/issues/28), not here.

---

## Success Criteria Checklist

Tick these off during a test run.

### Wishlist Section
- [ ] Only Roon-tagged albums appear
- [ ] No "Ignore" button visible
- [ ] "Find in stores" button works
- [ ] "Remove" button works
- [ ] Empty state message is correct

### Low-Quality Albums Section
- [ ] Albums that are not fully lossless appear with track counts
- [ ] Fully lossless albums are NOT added
- [ ] "Ignore" button visible and works
- [ ] "Find in stores" button works
- [ ] "Remove" button works
- [ ] Ignored albums don't reappear on rescan
- [ ] Empty state message is correct

### Navigation
- [ ] Menu has exactly 3 items
- [ ] "Add an album" NOT in menu
- [ ] Each menu item opens correct section
- [ ] Only one section active at a time

---

## Troubleshooting

### Extension doesn't pair with Roon
1. Restart Roon
2. Restart the extension: `sudo systemctl restart roon-wishlist`
3. Check Roon: Settings -> Extensions
4. Enable the Wishlist extension

### Low-quality scan finds no albums
1. Verify music library path is correct in Settings
2. Verify the path contains albums that are not fully lossless
3. Check folder structure: `Artist/Album/tracks.*`

### Search returns no results
Check internet connection. The search uses Bandcamp and Qobuz APIs.

### Albums not appearing after tagging
1. Click "Sync Roon tag" in Web UI
2. Verify the tag name is exactly `Wishlist` (case-sensitive)
3. If still not appearing, check Roon browse API access:
   - Re-enable the extension in Roon after upgrading
4. Force a sync from the command line:
   `curl -X POST http://localhost:3141/reconcile`

### The web UI is not reachable from another device
By default the server binds to `127.0.0.1`, which only accepts local connections.
Start it with `ROON_WISHLIST_HTTP_HOST=0.0.0.0` (or use `install.sh --web`) to expose
it on the LAN, then browse to `http://<server-ip>:3141`.

### "Permission denied" writing to the data directory
- Linux: `sudo chown -R roon-wishlist:roon-wishlist /var/lib/roon-wishlist`
- Check the service logs: `journalctl -u roon-wishlist -f`

---

## Reporting a problem

Do **not** record findings in a file in the repository. Open or comment on a
[GitHub issue](https://github.com/Zesseth/RoonWishlist/issues) instead — GitHub is
the single source of truth for status and planning.

---

*Last updated: 2026-08-19*
*Branch: `main`*
