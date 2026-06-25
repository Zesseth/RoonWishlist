# User Testing Guide - RoonWishlist

This guide helps you manually test the RoonWishlist extension features after the UI cleanup changes.

---

## Before You Start

### 1. Install and Run the Extension

**Use the installer scripts** (recommended for Linux servers):

```bash
# Fully automatic - clones, installs, and runs everything
curl -fsSL https://raw.githubusercontent.com/Zesseth/RoonWishlist/feat/ui-cleanup/bootstrap.sh \
  | sudo REPO_BRANCH=feat/ui-cleanup bash

# If you want the web UI accessible from other devices on your LAN:
curl -fsSL https://raw.githubusercontent.com/Zesseth/RoonWishlist/feat/ui-cleanup/bootstrap.sh \
  | sudo REPO_BRANCH=feat/ui-cleanup bash -s --web
```

**OR manual installation:**

```bash
# Clone the repository
git clone https://github.com/Zesseth/RoonWishlist.git
cd RoonWishlist

# Switch to the UI cleanup branch
git checkout feat/ui-cleanup

# Run the installer
sudo ./install.sh          # Localhost only
# OR for LAN access:
sudo ./install.sh --web
```

The extension will be available at: http://localhost:3141 (or your server IP if using --web)

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

**What changed:** Now shows non-FLAC albums with full functionality. Scan button moved to Settings -> Library.

**Steps:**
1. In Web UI: Go to **Settings -> Library**
2. Set **"Music library path"** to your music folder (e.g., `/mnt/music` or `C:\Music`)
3. Click **"Scan low-quality albums now"** (in Library section)
4. Navigate to **Low-quality albums** section
5. **Verify:** Scan completes and non-FLAC albums appear
6. For each album in the list:
   - **Verify:** Shows artist and title
   - **Verify:** Shows "FLAC x/y" track count (e.g., "5/10 FLAC tracks")
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
- ✅ Non-FLAC albums appear with track counts
- ✅ Fully FLAC albums are NOT added
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

## Current Known Issues

### Issue #1: Scan & Clean vs Low-Quality Scan Clarification

**Note from server testing (25/06/2026):**
- User ran "Scan & clean now" expecting it to add low-quality albums
- Result: "No fully FLAC albums matched the wishlist"
- User observation: "Scan & clean now ei poistanut low quality albumeja listalta. Kun skannasin niin loytin vanhat vain. Ei siis lisannyt uusia."
  (Translation: "Scan & clean now did not remove low quality albums from the list. When I scanned, I only found the old ones. So it did not add new ones.")

**Analysis:**
- "Scan & clean now" only removes albums from wishlist that ARE fully FLAC in library
- It does NOT remove low-quality albums (those are non-FLAC by definition)
- It does NOT add low-quality albums - that's what "Scan low-quality albums now" does
- User seems to expect "Scan & clean now" to also add new low-quality albums

**Root Cause:** User confusion between two separate functions:
1. **Scan & clean now** = Removes FLAC albums from wishlist (destructive)
2. **Scan low-quality albums now** = Adds non-FLAC albums to wishlist (non-destructive)

**Questions to resolve:**
1. Should "Scan & clean now" also trigger a low-quality scan automatically?
2. Or is current separation intentional and we need better button labeling?

**Note:** The empty state message in Low-quality section now reads:
"No low-quality albums on wishlist. Use Settings -> Library -> 'Scan low-quality albums now' to add albums here."

---

## Success Criteria Checklist

### Wishlist Section
- [x] Only Roon-tagged albums appear
- [x] No "Ignore" button visible
- [x] "Find in stores" button works
- [x] "Remove" button works
- [x] Empty state message is correct

### Low-Quality Albums Section
- [x] Non-FLAC albums appear with track counts
- [x] Fully FLAC albums are NOT added
- [x] "Ignore" button visible and works
- [x] "Find in stores" button works
- [x] "Remove" button works
- [x] Ignored albums don't reappear on rescan
- [x] Empty state message is correct

### Navigation
- [x] Menu has exactly 3 items
- [x] "Add an album" NOT in menu
- [x] Each menu item opens correct section
- [x] Only one section active at a time

---

## Troubleshooting

### Extension doesn't pair with Roon
1. Restart Roon
2. Restart the extension: `sudo systemctl restart roon-wishlist`
3. Check Roon: Settings -> Extensions
4. Enable the Wishlist extension

### Low-quality scan finds no albums
1. Verify music library path is correct in Settings
2. Verify the path contains albums with non-FLAC files
3. Check folder structure: `Artist/Album/tracks.*`

### Search returns no results
Check internet connection. The search uses Bandcamp and Qobuz APIs.

### Albums not appearing after tagging
1. Click "Sync Roon tag" in Web UI
2. If still not appearing, check Roon browse API access:
   - Re-enable the extension in Roon after upgrading

---

*Last updated: 2026-06-25*
*Branch: feat/ui-cleanup*
*Test session validated by user*
