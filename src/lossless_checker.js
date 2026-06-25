"use strict";

const fsp = require("fs/promises");
const path = require("path");

const FLAC_EXTENSIONS = new Set([".flac"]);
const NON_FLAC_AUDIO_EXTENSIONS = new Set([
  ".wav",
  ".aiff",
  ".ape",
  ".wv",
  ".alac",
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
const AUDIO_EXTENSIONS = new Set([...FLAC_EXTENSIONS, ...NON_FLAC_AUDIO_EXTENSIONS]);

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
      isFlac: FLAC_EXTENSIONS.has(ext),
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
      flacFiles: 0,
      nonFlacFiles: 0,
      errors,
    };
  }

  const flacFiles = audioFiles.filter((file) => file.isFlac).length;
  const nonFlacFiles = totalAudioFiles - flacFiles;
  return {
    status: nonFlacFiles === 0 ? "owned-all-flac" : "owned-partial-or-low-quality",
    totalAudioFiles,
    flacFiles,
    nonFlacFiles,
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
      rawArtist: folder.artist,
      rawAlbum: folder.album,
      status: classification.status,
      totalAudioFiles: classification.totalAudioFiles,
      flacFiles: classification.flacFiles,
      nonFlacFiles: classification.nonFlacFiles,
    });
  }

  return { albums, errors };
}

/**
 * Checks all wishlist albums against the library.
 * Removes any album from the wishlist only when the matching local album is fully FLAC.
 * Returns array of removed albums.
 */
async function checkAndClean(libraryPath, wishlistModule) {
  const wishlistItems = wishlistModule.getAll();
  if (!wishlistItems.length) return [];

  const { albums: localAlbums } = await scanLibrary(libraryPath);
  const ownedAllFlacAlbums = localAlbums.filter((album) => album.status === "owned-all-flac");
  const removed = [];

  for (const item of wishlistItems) {
    const match = ownedAllFlacAlbums.find(
      (local) => namesMatchExactly(local.artist, item.artist) && namesMatchExactly(local.album, item.title),
    );
    if (!match) continue;

    wishlistModule.remove(item);
    removed.push({
      ...item,
      foundAt: match.fullPath,
      qualityStatus: match.status,
      flacTracks: match.flacFiles,
      totalTracks: match.totalAudioFiles,
    });
  }

  return removed;
}

async function scanLowQualityAlbums(libraryPath, wishlistModule, ignoreModule) {
  const { albums: localAlbums, errors } = await scanLibrary(libraryPath);
  const existingKeys = new Set(
    wishlistModule.getAll().map((item) => albumKey(item.artist, item.title)),
  );
  const addedAlbums = [];
  const alreadyPresentAlbums = [];
  const ignoredAlbums = [];
  let skippedAllFlac = 0;
  let skippedNoAudio = 0;

  for (const local of localAlbums) {
    if (local.status === "owned-all-flac") {
      skippedAllFlac += 1;
      continue;
    }
    if (local.status !== "owned-partial-or-low-quality") {
      skippedNoAudio += 1;
      continue;
    }

    const nextAlbum = { artist: local.artist, title: local.album };
    const result = {
      artist: nextAlbum.artist,
      title: nextAlbum.title,
      foundAt: local.fullPath,
      flacTracks: local.flacFiles,
      totalTracks: local.totalAudioFiles,
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
      detectedBy: "low-quality-scan",
      qualityFlacTracks: local.flacFiles,
      qualityTotalTracks: local.totalAudioFiles,
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
    skippedAllFlac,
    skippedNoAudio,
    errors,
    addedAlbums,
    alreadyPresentAlbums,
    ignoredAlbums,
  };
}

module.exports = {
  checkAndClean,
  classifyAlbumFolder,
  scanLibrary,
  scanLowQualityAlbums,
};
