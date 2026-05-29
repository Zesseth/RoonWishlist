"use strict";

const fs = require("fs");
const path = require("path");

const LOSSLESS_EXTENSIONS = new Set([".flac", ".wav", ".aiff", ".ape", ".wv", ".alac"]);

function getArtistAlbumFolders(libraryPath) {
  const found = [];
  try {
    const artists = fs.readdirSync(libraryPath, { withFileTypes: true });
    for (const artist of artists) {
      if (!artist.isDirectory()) continue;
      const artistPath = path.join(libraryPath, artist.name);
      const albums = fs.readdirSync(artistPath, { withFileTypes: true });
      for (const album of albums) {
        if (!album.isDirectory()) continue;
        found.push({ artist: artist.name, album: album.name, fullPath: path.join(artistPath, album.name) });
      }
    }
  } catch {
    // Library path not accessible
  }
  return found;
}

function hasLosslessFiles(folderPath) {
  try {
    const files = fs.readdirSync(folderPath);
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
function checkAndClean(libraryPath, wishlistModule) {
  const wishlistItems = wishlistModule.getAll();
  if (!wishlistItems.length) return [];

  const localAlbums = getArtistAlbumFolders(libraryPath);
  const removed = [];

  for (const item of wishlistItems) {
    const match = localAlbums.find(
      (local) =>
        normalize(local.artist).includes(normalize(item.artist)) &&
        normalize(local.album).includes(normalize(item.title)) &&
        hasLosslessFiles(local.fullPath)
    );
    if (match) {
      wishlistModule.remove(item);
      removed.push({ ...item, foundAt: match.fullPath });
    }
  }

  return removed;
}

module.exports = { checkAndClean };
