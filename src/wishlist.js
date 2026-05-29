"use strict";

const fs = require("fs");
const path = require("path");

// Data dir is configurable so it can live outside the install dir on a server
// (e.g. ROON_WISHLIST_DATA_DIR=/var/lib/roon-wishlist).
const DATA_DIR = process.env.ROON_WISHLIST_DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "wishlist.json");

function load() {
  if (!fs.existsSync(DATA_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    return [];
  }
}

function save(list) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(list, null, 2), "utf8");
}

function add(album) {
  const list = load();
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
  return load();
}

function albumKey(album) {
  return `${(album.artist || "").toLowerCase().trim()}||${(album.title || "").toLowerCase().trim()}`;
}

module.exports = { add, remove, getAll };
