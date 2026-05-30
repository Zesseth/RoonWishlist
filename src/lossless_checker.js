"use strict";

const fsp = require("fs/promises");
const path = require("path");

const LOSSLESS_EXTENSIONS = new Set([".flac", ".wav", ".aiff", ".ape", ".wv", ".alac"]);

// Sequential, low-concurrency traversal on purpose: this runs on the same box as the
// Roon music server, so we favour being a quiet disk neighbour over raw scan speed.
async function getArtistAlbumFolders(libraryPath) {
  const found = [];
  let artists;
  try {
    artists = await fsp.readdir(libraryPath, { withFileTypes: true });
  } catch {
    return found; // Library path not accessible
  }
  for (const artist of artists) {
    if (!artist.isDirectory()) continue;
    const artistPath = path.join(libraryPath, artist.name);
    let albums;
    try {
      albums = await fsp.readdir(artistPath, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const album of albums) {
      if (!album.isDirectory()) continue;
      found.push({ artist: artist.name, album: album.name, fullPath: path.join(artistPath, album.name) });
    }
  }
  return found;
}

async function hasLosslessFiles(folderPath) {
  try {
    const files = await fsp.readdir(folderPath);
    return files.some((f) => LOSSLESS_EXTENSIONS.has(path.extname(f).toLowerCase()));
  } catch {
    return false;
  }
}

function normalize(str) {
  return (str || "").toLowerCase().trim();
}

/**
 * Checks all wishlist albums against the library.
 * Removes any album from the wishlist that has lossless files locally.
 * Returns array of removed albums.
 */
async function checkAndClean(libraryPath, wishlistModule) {
  const wishlistItems = wishlistModule.getAll();
  if (!wishlistItems.length) return [];

  const localAlbums = await getArtistAlbumFolders(libraryPath);
  const removed = [];

  for (const item of wishlistItems) {
    let match = null;
    for (const local of localAlbums) {
      if (
        normalize(local.artist).includes(normalize(item.artist)) &&
        normalize(local.album).includes(normalize(item.title)) &&
        (await hasLosslessFiles(local.fullPath))
      ) {
        match = local;
        break;
      }
    }
    if (match) {
      wishlistModule.remove(item);
      removed.push({ ...item, foundAt: match.fullPath });
    }
  }

  return removed;
}

module.exports = { checkAndClean };
