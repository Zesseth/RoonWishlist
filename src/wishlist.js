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
  list.push({ ...album, addedAt: new Date().toISOString() });
  save(list);
  return true;
}

function remove(album) {
  const list = load();
  const key = albumKey(album);
  const filtered = list.filter((a) => albumKey(a) !== key);
  if (filtered.length === list.length) return false;
  save(filtered);
  return true;
}

function getAll() {
  // Return a copy so callers can't mutate the cached array in place.
  return load().slice();
}

function albumKey(album) {
  return `${(album.artist || "").toLowerCase().trim()}||${(album.title || "").toLowerCase().trim()}`;
}

module.exports = { add, remove, getAll };
