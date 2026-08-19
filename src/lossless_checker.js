"use strict";

const fsp = require("fs/promises");
const path = require("path");

// Formats that preserve the original signal bit-for-bit. An album counts as "owned"
// (and is therefore dropped from the wishlist) only when every one of its tracks is
// in one of these.
const LOSSLESS_EXTENSIONS = new Set([
  ".flac",
  ".wav",
  ".aiff",
  ".aif",
  ".aifc",
  ".ape",
  ".wv",
  ".alac",
  ".dsf",
  ".dff",
]);

// Everything else we recognise as audio. `.m4a` and `.mp4` are deliberately listed
// here even though an MP4 container *can* hold ALAC: the extension alone cannot tell
// ALAC from AAC without decoding the file header. Treating them as lossy is the safe
// default because the worst case is that an album stays on the wishlist, whereas the
// opposite mistake silently deletes a wanted album.
const LOSSY_EXTENSIONS = new Set([
  ".mp3",
  ".aac",
  ".ogg",
  ".oga",
  ".opus",
  ".wma",
  ".m4a",
  ".mp4",
  ".m4b",
]);

const AUDIO_EXTENSIONS = new Set([...LOSSLESS_EXTENSIONS, ...LOSSY_EXTENSIONS]);

// Album classification, ordered from "most owned" to "least owned". Used both as the
// set of valid statuses and as the precedence order when the same album is found in
// more than one storage location.
const STATUS_PRECEDENCE = ["owned-lossless", "owned-mixed", "owned-lossy", "not-audio"];

function isLosslessExtension(ext) {
  return LOSSLESS_EXTENSIONS.has(String(ext || "").toLowerCase());
}

function betterStatus(a, b) {
  const rankA = STATUS_PRECEDENCE.indexOf(a);
  const rankB = STATUS_PRECEDENCE.indexOf(b);
  if (rankA === -1) return b;
  if (rankB === -1) return a;
  return rankA <= rankB ? a : b;
}

// Sequential, low-concurrency traversal on purpose: this runs on the same box as the
// Roon music server, so we favour being a quiet disk neighbour over raw scan speed.
async function getArtistAlbumFolders(libraryPath) {
  const found = [];
  let errors = 0;
  let artists;
  try {
    artists = await fsp.readdir(libraryPath, { withFileTypes: true });
  } catch {
    return { albums: found, errors: 1 };
  }

  for (const artist of artists) {
    if (!artist.isDirectory()) continue;
    const artistPath = path.join(libraryPath, artist.name);
    let albums;
    try {
      albums = await fsp.readdir(artistPath, { withFileTypes: true });
    } catch {
      errors += 1;
      continue;
    }

    for (const album of albums) {
      if (!album.isDirectory()) continue;
      found.push({
        artist: artist.name,
        album: album.name,
        fullPath: path.join(artistPath, album.name),
      });
    }
  }

  return { albums: found, errors };
}

async function collectAudioFiles(folderPath) {
  const found = [];
  let errors = 0;
  let entries;
  try {
    entries = await fsp.readdir(folderPath, { withFileTypes: true });
  } catch {
    return { audioFiles: found, errors: 1 };
  }

  for (const entry of entries) {
    const fullPath = path.join(folderPath, entry.name);
    if (entry.isDirectory()) {
      const nested = await collectAudioFiles(fullPath);
      found.push(...nested.audioFiles);
      errors += nested.errors;
      continue;
    }

    const ext = path.extname(entry.name).toLowerCase();
    if (!AUDIO_EXTENSIONS.has(ext)) continue;
    found.push({
      fullPath,
      ext,
      isLossless: isLosslessExtension(ext),
    });
  }

  return { audioFiles: found, errors };
}

function collapseWhitespace(str) {
  return String(str || "").replace(/\s+/g, " ").trim();
}

function escapeRegExp(str) {
  return String(str || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function albumKey(artist, title) {
  return `${String(artist || "").toLowerCase().trim()}||${String(title || "").toLowerCase().trim()}`;
}

function cleanArtistName(name) {
  return collapseWhitespace(name);
}

function cleanAlbumTitle(name, artist) {
  let title = collapseWhitespace(name);
  const artistName = collapseWhitespace(artist);
  if (artistName) {
    title = title.replace(new RegExp(`^${escapeRegExp(artistName)}\\s*[-:]\\s*`, "i"), "");
  }
  title = title.replace(/^\s*(?:\[\s*\d{4}\s*\]|\(\s*\d{4}\s*\)|\d{4}\s*[-:])\s*/, "");
  return collapseWhitespace(title);
}

function normalizeForMatch(str) {
  return collapseWhitespace(String(str || ""))
    .toLowerCase()
    .replace(/\[[^\]]*\]|\([^\)]*\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function namesMatchExactly(localValue, wantedValue) {
  const local = normalizeForMatch(localValue);
  const wanted = normalizeForMatch(wantedValue);
  return !!local && !!wanted && local === wanted;
}

async function classifyAlbumFolder(folderPath) {
  const { audioFiles, errors } = await collectAudioFiles(folderPath);
  const totalAudioFiles = audioFiles.length;
  if (!totalAudioFiles) {
    return {
      status: "not-audio",
      totalAudioFiles: 0,
      losslessFiles: 0,
      lossyFiles: 0,
      flacFiles: 0,
      nonFlacFiles: 0,
      formats: [],
      errors,
    };
  }

  const losslessFiles = audioFiles.filter((file) => file.isLossless).length;
  const lossyFiles = totalAudioFiles - losslessFiles;
  const formats = [...new Set(audioFiles.map((file) => file.ext))].sort();

  let status;
  if (lossyFiles === 0) {
    status = "owned-lossless";
  } else if (losslessFiles === 0) {
    status = "owned-lossy";
  } else {
    // Some tracks lossless, some not. Never treated as owned: removing it would lose
    // the lossy tracks, so it is surfaced explicitly instead (issue #15).
    status = "owned-mixed";
  }

  return {
    status,
    totalAudioFiles,
    losslessFiles,
    lossyFiles,
    formats,
    // Retained under the old names so persisted wishlist entries and the web UI keep
    // rendering. "flac" here means "lossless" in the widened sense.
    flacFiles: losslessFiles,
    nonFlacFiles: lossyFiles,
    errors,
  };
}

async function scanLibrary(libraryPath) {
  const { albums: folderAlbums, errors: rootErrors } = await getArtistAlbumFolders(libraryPath);
  const albums = [];
  let errors = rootErrors;

  for (const folder of folderAlbums) {
    const artist = cleanArtistName(folder.artist);
    const album = cleanAlbumTitle(folder.album, folder.artist);
    if (!artist || !album) continue;

    const classification = await classifyAlbumFolder(folder.fullPath);
    errors += classification.errors;
    albums.push({
      artist,
      album,
      fullPath: folder.fullPath,
      location: libraryPath,
      rawArtist: folder.artist,
      rawAlbum: folder.album,
      status: classification.status,
      totalAudioFiles: classification.totalAudioFiles,
      losslessFiles: classification.losslessFiles,
      lossyFiles: classification.lossyFiles,
      formats: classification.formats,
      flacFiles: classification.flacFiles,
      nonFlacFiles: classification.nonFlacFiles,
    });
  }

  return { albums, errors };
}

/**
 * Accepts whatever the caller has: a single path string, an array of path strings, or
 * an array of storage-location objects as reported by Roon. Blank entries and
 * duplicates are dropped so a location listed both by Roon and as the manual override
 * is only scanned once.
 */
function normalizeLocations(locations) {
  const list = Array.isArray(locations) ? locations : [locations];
  const seen = new Set();
  const normalized = [];

  for (const entry of list) {
    const raw = typeof entry === "string" ? entry : entry && (entry.path || entry.fullPath);
    const value = String(raw || "").trim();
    if (!value) continue;
    const key = path.resolve(value);
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(value);
  }

  return normalized;
}

/**
 * Scans every configured storage location. Locations are walked one after another
 * rather than in parallel: this runs alongside a Roon music server, and a burst of
 * concurrent directory reads across several disks is exactly the kind of neighbour we
 * do not want to be.
 */
async function scanLibraries(locations) {
  const roots = normalizeLocations(locations);
  const albums = [];
  const perLocation = [];
  let errors = 0;

  for (const root of roots) {
    const result = await scanLibrary(root);
    albums.push(...result.albums);
    errors += result.errors;
    perLocation.push({
      location: root,
      albums: result.albums.length,
      errors: result.errors,
    });
  }

  return { albums, errors, locations: roots, perLocation };
}

/**
 * Collapses the same album appearing in more than one storage location into a single
 * entry carrying the best quality found anywhere. Without this, an album held as MP3
 * on one disk and FLAC on another would be reported as both owned and not owned.
 */
function mergeAlbumsAcrossLocations(albums) {
  const byKey = new Map();

  for (const album of albums) {
    const key = albumKey(album.artist, album.album);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...album, copies: [album] });
      continue;
    }

    existing.copies.push(album);
    const winner = betterStatus(existing.status, album.status);
    if (winner === album.status && album.status !== existing.status) {
      // Keep the copies list, but adopt the better copy's details.
      const copies = existing.copies;
      byKey.set(key, { ...album, copies });
    }
  }

  return [...byKey.values()];
}

// Why a wishlist album was left alone, in words the UI can show directly.
const KEEP_REASONS = {
  "not-found": "Not found in any storage location",
  "owned-lossy": "Found, but every track is lossy — still worth buying in lossless",
  "owned-mixed": "Found, but only some tracks are lossless — kept so the album is not lost",
  "not-audio": "Matching folder found, but it contains no audio files",
};

/**
 * Checks every wishlist album against all configured storage locations.
 *
 * An album is removed **only** when a complete lossless copy exists (every track in a
 * lossless format). Albums that are present but lossy, or only partly lossless, stay
 * on the wishlist — that is the whole point of the wishlist. See issue #15.
 *
 * @param {string|string[]|Array<{path:string}>} locations One or more scan roots.
 * @param {Object} wishlistModule
 * @returns {Promise<Object>} `{ removed, kept, scannedAlbums, locations, errors }`
 */
async function checkAndClean(locations, wishlistModule) {
  const wishlistItems = wishlistModule.getAll();
  const roots = normalizeLocations(locations);

  if (!wishlistItems.length) {
    return { removed: [], kept: [], alreadyOwned: [], scannedAlbums: 0, locations: roots, perLocation: [], errors: 0 };
  }

  const { albums, errors, perLocation } = await scanLibraries(roots);
  const localAlbums = mergeAlbumsAcrossLocations(albums);
  const removed = [];
  const kept = [];
  const alreadyOwned = [];

  for (const item of wishlistItems) {
    const match = localAlbums.find(
      (local) => namesMatchExactly(local.artist, item.artist) && namesMatchExactly(local.album, item.title),
    );

    const status = match ? match.status : "not-found";
    const details = {
      ...item,
      status,
      foundAt: match ? match.fullPath : null,
      location: match ? match.location : null,
      losslessTracks: match ? match.losslessFiles : 0,
      totalTracks: match ? match.totalAudioFiles : 0,
      formats: match ? match.formats : [],
      // Legacy field name kept so the existing web UI keeps rendering.
      flacTracks: match ? match.losslessFiles : 0,
    };

    if (status === "owned-lossless") {
      const reason = "Complete lossless copy found in the library";
      if (item.source === "roon-tag") {
        // Roon is the master for tagged entries, so deleting one here would only make
        // the next sync add it straight back. Flag it instead and let the UI list it
        // apart, with the advice to drop the tag in Roon. See issue #32.
        if (item.ownedLossless !== true) {
          wishlistModule.upsert({ artist: item.artist, title: item.title, ownedLossless: true });
        }
        alreadyOwned.push({ ...details, reason });
        persistLastCheck(wishlistModule, item, { status, reason, details });
        continue;
      }
      wishlistModule.remove(item);
      removed.push({ ...details, reason });
      continue;
    }

    if (item.ownedLossless === true) {
      // It was owned in lossless last time and is not any more — do not leave a stale flag.
      wishlistModule.upsert({ artist: item.artist, title: item.title, ownedLossless: false });
    }

    const reason = KEEP_REASONS[status] || KEEP_REASONS["not-found"];
    kept.push({ ...details, reason });
    persistLastCheck(wishlistModule, item, { status, reason, details });
  }

  return {
    removed,
    kept,
    alreadyOwned,
    scannedAlbums: localAlbums.length,
    locations: roots,
    perLocation,
    errors,
  };
}

/**
 * Record the outcome of the last library check on the wishlist entry itself, so the
 * status survives a restart and can be shown in Roon's settings screen (which can
 * only render text, not an interactive table).
 */
function persistLastCheck(wishlistModule, item, { status, reason, details }) {
  if (!wishlistModule || typeof wishlistModule.upsert !== "function") return;
  const lastCheck = {
    status,
    reason,
    checkedAt: new Date().toISOString(),
    foundAt: details.foundAt,
    losslessTracks: details.losslessTracks,
    totalTracks: details.totalTracks,
  };
  if (item.lastCheck && sameLastCheck(item.lastCheck, lastCheck)) return;
  try {
    wishlistModule.upsert({ artist: item.artist, title: item.title, lastCheck });
  } catch (err) {
    // Persisting status is a convenience; never let it fail a scan.
    console.warn(`Could not persist check status for ${item.artist} — ${item.title}: ${err.message}`);
  }
}

function sameLastCheck(a, b) {
  return (
    a.status === b.status &&
    a.foundAt === b.foundAt &&
    a.losslessTracks === b.losslessTracks &&
    a.totalTracks === b.totalTracks
  );
}

async function scanLowQualityAlbums(locations, wishlistModule, ignoreModule) {  const roots = normalizeLocations(locations);
  const { albums, errors, perLocation } = await scanLibraries(roots);
  const localAlbums = mergeAlbumsAcrossLocations(albums);
  const existingKeys = new Set(
    wishlistModule.getAll().map((item) => albumKey(item.artist, item.title)),
  );
  const addedAlbums = [];
  const alreadyPresentAlbums = [];
  const ignoredAlbums = [];
  let skippedLossless = 0;
  let skippedNoAudio = 0;

  for (const local of localAlbums) {
    // A lossless copy anywhere means the album is already owned properly, even if a
    // lossy duplicate exists in another storage location.
    if (local.status === "owned-lossless") {
      skippedLossless += 1;
      continue;
    }
    if (local.status !== "owned-lossy" && local.status !== "owned-mixed") {
      skippedNoAudio += 1;
      continue;
    }

    const nextAlbum = { artist: local.artist, title: local.album };
    const result = {
      artist: nextAlbum.artist,
      title: nextAlbum.title,
      foundAt: local.fullPath,
      location: local.location,
      status: local.status,
      losslessTracks: local.losslessFiles,
      totalTracks: local.totalAudioFiles,
      formats: local.formats,
      flacTracks: local.losslessFiles,
      rawArtist: local.rawArtist,
      rawAlbum: local.rawAlbum,
    };

    if (ignoreModule && ignoreModule.has(nextAlbum.artist, nextAlbum.title)) {
      ignoredAlbums.push(result);
      continue;
    }

    const key = albumKey(nextAlbum.artist, nextAlbum.title);
    const exists = existingKeys.has(key);

    wishlistModule.upsert({
      ...nextAlbum,
      source: "low-quality",
      detectedBy: "low-quality-scan",
      qualityStatus: local.status,
      qualityLosslessTracks: local.losslessFiles,
      qualityTotalTracks: local.totalAudioFiles,
      qualityFormats: local.formats,
      qualityLocation: local.location,
      qualityFlacTracks: local.losslessFiles,
      qualityUpdatedAt: new Date().toISOString(),
    });

    if (exists) {
      alreadyPresentAlbums.push(result);
    } else {
      existingKeys.add(key);
      addedAlbums.push(result);
    }
  }

  return {
    scannedAlbums: localAlbums.length,
    lowQualityAlbums: addedAlbums.length + alreadyPresentAlbums.length,
    added: addedAlbums.length,
    alreadyPresent: alreadyPresentAlbums.length,
    ignored: ignoredAlbums.length,
    skippedLossless,
    // Legacy alias; older callers and docs used the FLAC-only wording.
    skippedAllFlac: skippedLossless,
    skippedNoAudio,
    locations: roots,
    perLocation,
    errors,
    addedAlbums,
    alreadyPresentAlbums,
    ignoredAlbums,
  };
}

/**
 * Classifies only the albums we actually care about.
 *
 * `checkAndClean` classifies every album in the library; that is fine for the nightly
 * clean but far too much disk work for the tag sync, which runs whenever the user
 * presses a button. Listing the artist/album folders is two cheap directory reads per
 * location, so we do that first and only open the folders whose names match something
 * on the list.
 *
 * @param {string|string[]|Array<{path:string}>} locations
 * @param {Array<{artist:string,title:string}>} items
 * @returns {Promise<{results: Map<string, Object>, errors: number, locations: string[]}>}
 *   `results` is keyed by `albumKey(artist, title)`; an item with no matching folder
 *   is simply absent.
 */
async function classifyWantedAlbums(locations, items) {
  const roots = normalizeLocations(locations);
  const results = new Map();
  let errors = 0;

  const wanted = (items || [])
    .filter((item) => item && (item.artist || item.title))
    .map((item) => ({ item, key: albumKey(item.artist, item.title) }));

  if (!wanted.length || !roots.length) return { results, errors, locations: roots };

  for (const root of roots) {
    const { albums: folders, errors: rootErrors } = await getArtistAlbumFolders(root);
    errors += rootErrors;

    for (const folder of folders) {
      const artist = cleanArtistName(folder.artist);
      const album = cleanAlbumTitle(folder.album, folder.artist);
      if (!artist || !album) continue;

      const hit = wanted.find(
        (w) => namesMatchExactly(artist, w.item.artist) && namesMatchExactly(album, w.item.title),
      );
      if (!hit) continue;

      const classification = await classifyAlbumFolder(folder.fullPath);
      errors += classification.errors;

      const detail = {
        status: classification.status,
        foundAt: folder.fullPath,
        location: root,
        losslessTracks: classification.losslessFiles,
        totalTracks: classification.totalAudioFiles,
        formats: classification.formats,
      };

      const previous = results.get(hit.key);
      // A second copy only wins if it is genuinely better than the one already found.
      if (!previous || betterStatus(previous.status, detail.status) !== previous.status) {
        results.set(hit.key, detail);
      }
    }
  }

  return { results, errors, locations: roots };
}

/**
 * Flags the Roon-tagged wishlist entries that are already owned in full lossless.
 *
 * A tagged album cannot simply be deleted the way a scanned one can: Roon is the master
 * for these entries, so the next sync would just put it straight back. Instead the entry
 * stays, marked `ownedLossless`, and the UI lists it separately as "already owned" with
 * the advice to drop the tag in Roon. See issue #32.
 *
 * @returns {Promise<{owned: Object[], cleared: Object[], checked: number, errors: number, locations: string[]}>}
 */
async function markOwnedTaggedAlbums(locations, wishlistModule) {
  const items = wishlistModule.getAll().filter((item) => item.source === "roon-tag");
  if (!items.length) {
    return { owned: [], cleared: [], checked: 0, errors: 0, locations: normalizeLocations(locations) };
  }

  const { results, errors, locations: roots } = await classifyWantedAlbums(locations, items);

  // Having nowhere to look is not the same as owning nothing. Concluding "not owned"
  // from an empty scan would clear every flag and put albums the user already has back
  // on the shopping list, silently. Refuse instead, and let the caller report it.
  if (!roots.length) {
    throw new Error("No storage location to check against, so ownership could not be determined.");
  }

  const owned = [];
  const cleared = [];

  for (const item of items) {
    const detail = {
      status: "not-found",
      foundAt: null,
      location: null,
      losslessTracks: 0,
      totalTracks: 0,
      formats: [],
      ...(results.get(albumKey(item.artist, item.title)) || {}),
    };
    const isOwned = detail.status === "owned-lossless";
    const wasOwned = item.ownedLossless === true;

    if (isOwned) owned.push({ ...item, ...detail });
    else if (wasOwned) cleared.push({ ...item, ...detail });

    if (isOwned !== wasOwned) {
      try {
        wishlistModule.upsert({ artist: item.artist, title: item.title, ownedLossless: isOwned });
      } catch (err) {
        console.warn(`Could not flag ${item.artist} — ${item.title} as owned: ${err.message}`);
      }
    }

    persistLastCheck(wishlistModule, item, {
      status: detail.status,
      reason: detail.status === "owned-lossless"
        ? "Complete lossless copy already in the library"
        : KEEP_REASONS[detail.status] || KEEP_REASONS["not-found"],
      details: detail,
    });
  }

  return { owned, cleared, checked: items.length, errors, locations: roots };
}

module.exports = {
  LOSSLESS_EXTENSIONS,
  LOSSY_EXTENSIONS,
  checkAndClean,
  classifyAlbumFolder,
  classifyWantedAlbums,
  isLosslessExtension,
  markOwnedTaggedAlbums,
  mergeAlbumsAcrossLocations,
  normalizeLocations,
  scanLibraries,
  scanLibrary,
  scanLowQualityAlbums,
};
