"use strict";

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");

const DATA_DIR = process.env.ROON_WISHLIST_DATA_DIR
  ? path.resolve(process.env.ROON_WISHLIST_DATA_DIR)
  : path.join(__dirname, "..", "data");
const IGNORE_FILE = path.join(DATA_DIR, "ignored-low-quality.json");

let cachedItems = null;
let cachedMtimeMs = 0;

function albumKey(artist, title) {
  return `${String(artist || "").toLowerCase().trim()}||${String(title || "").toLowerCase().trim()}`;
}

function ensureDataDirSync() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function normalizeEntry(entry) {
  return {
    artist: String(entry.artist || "").trim(),
    title: String(entry.title || "").trim(),
    ignoredAt: String(entry.ignoredAt || new Date().toISOString()),
  };
}

function sortEntries(entries) {
  return [...entries].sort((left, right) => {
    const byArtist = left.artist.localeCompare(right.artist, undefined, { sensitivity: "base" });
    if (byArtist !== 0) return byArtist;
    return left.title.localeCompare(right.title, undefined, { sensitivity: "base" });
  });
}

function readIgnoreList() {
  ensureDataDirSync();
  if (!fs.existsSync(IGNORE_FILE)) return [];

  const stat = fs.statSync(IGNORE_FILE);
  if (cachedItems && stat.mtimeMs === cachedMtimeMs) {
    return cachedItems;
  }

  const raw = fs.readFileSync(IGNORE_FILE, "utf8");
  const parsed = JSON.parse(raw);
  cachedItems = Array.isArray(parsed) ? parsed.map(normalizeEntry) : [];
  cachedMtimeMs = stat.mtimeMs;
  return cachedItems;
}

async function writeIgnoreList(entries) {
  ensureDataDirSync();
  const normalized = sortEntries(entries.map(normalizeEntry));
  const tmpPath = `${IGNORE_FILE}.tmp`;
  await fsp.writeFile(tmpPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  await fsp.rename(tmpPath, IGNORE_FILE);
  const stat = await fsp.stat(IGNORE_FILE);
  cachedItems = normalized;
  cachedMtimeMs = stat.mtimeMs;
}

function has(artist, title) {
  const key = albumKey(artist, title);
  return readIgnoreList().some((entry) => albumKey(entry.artist, entry.title) === key);
}

async function add(entry) {
  const next = normalizeEntry(entry);
  if (!next.artist || !next.title) return false;

  const current = readIgnoreList();
  if (current.some((item) => albumKey(item.artist, item.title) === albumKey(next.artist, next.title))) {
    return false;
  }

  await writeIgnoreList([...current, next]);
  return true;
}

module.exports = {
  add,
  has,
  getAll: readIgnoreList,
};
