"use strict";

const fs = require("fs");
const path = require("path");

// Data dir is configurable so it can live outside the install dir on a server
// (e.g. ROON_WISHLIST_DATA_DIR=/var/lib/roon-wishlist).
const DATA_DIR = process.env.ROON_WISHLIST_DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "wishlist.json");

// In-memory cache keyed on the file's mtime, so repeated reads (every getAll/status
// call) don't re-parse the JSON unless the file actually changed. This keeps the hot
// path syscall-light without risking staleness if the file is edited externally.
let cache = null;
let cacheMtimeMs = -1;

function load() {
  let stat;
  try {
    stat = fs.statSync(DATA_FILE);
  } catch {
    // File doesn't exist yet (or is unreadable): empty wishlist.
    cache = [];
    cacheMtimeMs = -1;
    return cache;
  }
  if (cache && stat.mtimeMs === cacheMtimeMs) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    if (!Array.isArray(cache)) cache = [];
  } catch {
    cache = [];
  }
  cacheMtimeMs = stat.mtimeMs;
  return cache;
}

// Atomic write: write to a temp file and rename over the target so a crash mid-write
// can never leave a truncated/corrupt wishlist.json. Updates the cache in lock-step.
function save(list) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  const tmp = `${DATA_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2), "utf8");
  fs.renameSync(tmp, DATA_FILE);
  cache = list;
  try {
    cacheMtimeMs = fs.statSync(DATA_FILE).mtimeMs;
  } catch {
    cacheMtimeMs = -1;
  }
}

function add(album) {
  const list = load().slice();
  const key = albumKey(album);
  if (list.find((a) => albumKey(a) === key)) return false;
  list.push(normalizeAlbum(album));
  save(list);
  return true;
}

function upsert(album) {
  const list = load().slice();
  const key = albumKey(album);
  const idx = list.findIndex((a) => albumKey(a) === key);
  if (idx === -1) {
    list.push(normalizeAlbum(album));
    save(list);
    return "added";
  }

  const next = normalizeAlbum(album, list[idx]);
  if (sameAlbum(list[idx], next)) return "unchanged";
  list[idx] = next;
  save(list);
  return "updated";
}

function remove(album) {
  const list = load();
  const key = albumKey(album);
  const filtered = list.filter((a) => albumKey(a) !== key);
  if (filtered.length === list.length) return false;
  save(filtered);
  return true;
}

function replaceAll(albums) {
  const seen = new Set();
  const next = [];
  for (const album of albums || []) {
    const normalized = normalizeAlbum(album);
    if (!normalized.artist || !normalized.title) continue;
    const key = albumKey(normalized);
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(normalized);
  }
  save(next);
  return next.length;
}

function getAll() {
  // Return a copy so callers can't mutate the cached array in place.
  return load().slice();
}

function albumKey(album) {
  return `${(album.artist || "").toLowerCase().trim()}||${(album.title || "").toLowerCase().trim()}`;
}

function normalizeAlbum(album, existing) {
  const next = {
    ...(existing || {}),
    ...(album || {}),
    artist: String(album && album.artist ? album.artist : (existing && existing.artist) || "").trim(),
    title: String(album && album.title ? album.title : (existing && existing.title) || "").trim(),
  };
  const buyLinks = normalizeBuyLinks(album && album.buyLinks);
  if (buyLinks) next.buyLinks = buyLinks;
  else if (album && Object.prototype.hasOwnProperty.call(album, "buyLinks")) next.buyLinks = [];
  else if (existing && Array.isArray(existing.buyLinks)) next.buyLinks = normalizeBuyLinks(existing.buyLinks);
  if (existing && existing.addedAt) next.addedAt = existing.addedAt;
  else next.addedAt = album && album.addedAt ? album.addedAt : new Date().toISOString();
  // Preserve source if existing, otherwise default to "manual" for backward compatibility
  if (existing && existing.source) {
    next.source = existing.source;
  } else if (album && album.source) {
    next.source = album.source;
  } else if (!next.source) {
    next.source = "manual";
  }
  return next;
}

function normalizeBuyLinks(links) {
  if (!Array.isArray(links)) return undefined;
  return links
    .map((link) => ({
      store: String(link && link.store ? link.store : "").trim(),
      title: String(link && link.title ? link.title : "").trim(),
      artist: String(link && link.artist ? link.artist : "").trim(),
      url: String(link && link.url ? link.url : "").trim(),
    }))
    .filter((link) => link.store && link.url);
}

function sameAlbum(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

module.exports = { add, upsert, remove, replaceAll, getAll };
