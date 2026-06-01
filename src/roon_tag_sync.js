"use strict";

const crypto = require("crypto");

const ROON_WISHLIST_TAG = "Wishlist";
const LIBRARY_TITLES = ["library", "kirjasto"];
const TAGS_TITLES = ["tags", "tagit"];
const ALBUMS_TITLES = ["albums", "albumit"];

class SyncError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.name = "SyncError";
    this.statusCode = statusCode || 500;
  }
}

function normalizeTitle(value) {
  return String(value || "").trim().toLowerCase();
}

function titleInSet(value, aliases) {
  const title = normalizeTitle(value);
  return aliases.some((alias) => normalizeTitle(alias) === title);
}

const NON_ALBUM_ACTION_TITLES = new Set([
  "play tag",
  "shuffle tag",
  "queue tag",
  "start radio",
  "play now",
]);

function findByAliases(items, aliases) {
  return (items || []).find((item) => titleInSet(item.title, aliases));
}

function findExactTitle(items, title) {
  const wanted = normalizeTitle(title);
  return (items || []).find((item) => normalizeTitle(item.title) === wanted);
}

function browseAsync(browseService, opts) {
  return new Promise((resolve, reject) => {
    browseService.browse(opts, (err, body) => {
      if (err) reject(new SyncError(`Roon browse failed: ${err}`, 502));
      else resolve(body || {});
    });
  });
}

function loadAsync(browseService, opts) {
  return new Promise((resolve, reject) => {
    browseService.load(opts, (err, body) => {
      if (err) reject(new SyncError(`Roon browse load failed: ${err}`, 502));
      else resolve(body || {});
    });
  });
}

async function loadAllItems(browseService, hierarchy, sessionKey, level) {
  const items = [];
  let offset = 0;
  let total = Number.POSITIVE_INFINITY;
  while (offset < total) {
    const body = await loadAsync(browseService, {
      hierarchy,
      multi_session_key: sessionKey,
      level,
      offset,
      count: 100,
    });
    const batch = Array.isArray(body.items) ? body.items : [];
    items.push(...batch);
    const count = body.list && typeof body.list.count === "number" ? body.list.count : null;
    const totalCount = body.list && typeof body.list.total_count === "number" ? body.list.total_count : null;
    total = count != null ? count : (totalCount != null ? totalCount : items.length);
    if (!batch.length) break;
    offset += batch.length;
  }
  return items;
}

async function openLevel(browseService, { hierarchy, sessionKey, itemKey, input, popAll }) {
  const browseOpts = {
    hierarchy,
    multi_session_key: sessionKey,
  };
  if (itemKey) browseOpts.item_key = itemKey;
  if (typeof input === "string") browseOpts.input = input;
  if (popAll) browseOpts.pop_all = true;

  const body = await browseAsync(browseService, browseOpts);
  if (body.action === "message") {
    throw new SyncError(body.message || "Roon browse returned an error.", body.is_error === false ? 400 : 502);
  }
  if (body.action !== "list") {
    throw new SyncError(`Unexpected Roon browse action: ${body.action || "none"}`, 502);
  }

  const level = body.list && Number.isInteger(body.list.level) ? body.list.level : undefined;
  const items = await loadAllItems(browseService, hierarchy, sessionKey, level);
  return { hierarchy, items, list: body.list || null };
}

function looksLikeAlbumItems(items) {
  const actionable = (items || []).filter((item) => item && item.item_key && item.hint !== "header");
  if (!actionable.length) return false;
  const albumLike = actionable.filter(isLikelyAlbumItem);
  return albumLike.length >= Math.max(1, Math.ceil(actionable.length / 2));
}

async function openTagViaBrowseTree(browseService, tagName, sessionKey) {
  const root = await openLevel(browseService, { hierarchy: "browse", sessionKey, popAll: true });
  const libraryItem = findByAliases(root.items, LIBRARY_TITLES);
  if (!libraryItem || !libraryItem.item_key) return null;

  const library = await openLevel(browseService, {
    hierarchy: "browse",
    sessionKey,
    itemKey: libraryItem.item_key,
  });
  const tagsItem = findByAliases(library.items, TAGS_TITLES);
  if (!tagsItem || !tagsItem.item_key) return null;

  const tags = await openLevel(browseService, {
    hierarchy: "browse",
    sessionKey,
    itemKey: tagsItem.item_key,
  });
  const tagItem = findExactTitle(tags.items, tagName);
  if (!tagItem || !tagItem.item_key) return null;

  return openLevel(browseService, {
    hierarchy: "browse",
    sessionKey,
    itemKey: tagItem.item_key,
  });
}

async function openTagViaSearch(browseService, tagName, sessionKey) {
  const searchRoot = await openLevel(browseService, {
    hierarchy: "search",
    sessionKey,
    popAll: true,
    input: tagName,
  });

  let tagItem = findExactTitle(searchRoot.items, tagName);
  if (tagItem && tagItem.item_key) {
    return openLevel(browseService, {
      hierarchy: "search",
      sessionKey,
      itemKey: tagItem.item_key,
    });
  }

  const tagCategory = findByAliases(searchRoot.items, TAGS_TITLES);
  if (!tagCategory || !tagCategory.item_key) return null;

  const tags = await openLevel(browseService, {
    hierarchy: "search",
    sessionKey,
    itemKey: tagCategory.item_key,
  });
  tagItem = findExactTitle(tags.items, tagName);
  if (!tagItem || !tagItem.item_key) return null;

  return openLevel(browseService, {
    hierarchy: "search",
    sessionKey,
    itemKey: tagItem.item_key,
  });
}

async function openAlbumLevelFromTag(browseService, tagLevel, sessionKey) {
  const directAlbums = findByAliases(tagLevel.items, ALBUMS_TITLES);
  if (directAlbums && directAlbums.item_key) {
    return openLevel(browseService, {
      hierarchy: tagLevel.hierarchy,
      sessionKey,
      itemKey: directAlbums.item_key,
    });
  }

  if (looksLikeAlbumItems(tagLevel.items)) return tagLevel;

  for (const item of tagLevel.items || []) {
    if (!item || !item.item_key || item.hint === "header") continue;
    try {
      const child = await openLevel(browseService, {
        hierarchy: tagLevel.hierarchy,
        sessionKey,
        itemKey: item.item_key,
      });
      if (titleInSet(item.title, ALBUMS_TITLES) || looksLikeAlbumItems(child.items)) {
        return child;
      }
    } catch {
      // Ignore non-list actions such as "Play Tag" and keep searching.
    }
  }

  throw new SyncError(
    "The Roon tag was found, but its album list could not be opened. If your Roon UI language is not English or Finnish yet, switch it temporarily to English and try again.",
    422
  );
}

function mapAlbumItems(items) {
  const seen = new Set();
  const albums = [];
  for (const item of items || []) {
    if (!isLikelyAlbumItem(item)) continue;
    const title = String(item.title || "").trim();
    if (!title) continue;
    const artist = normalizeAlbumArtist(item.subtitle);
    if (!artist) continue;
    const key = `${normalizeTitle(artist)}||${normalizeTitle(title)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    albums.push({ artist, title });
  }
  return albums;
}

function isLikelyAlbumItem(item) {
  if (!item || !item.item_key || item.hint === "header") return false;
  const title = String(item.title || "").trim();
  const subtitle = String(item.subtitle || "").trim();
  if (!title || !subtitle) return false;
  return !NON_ALBUM_ACTION_TITLES.has(normalizeTitle(title));
}

function normalizeAlbumArtist(subtitle) {
  const text = String(subtitle || "").trim();
  if (!text) return "";
  const match = text.match(/^(?:album|ep|single|compilation|live album|soundtrack)\s+by\s+(.+)$/i);
  return match ? String(match[1] || "").trim() : text;
}

async function listTaggedAlbums(browseService, tagName) {
  if (!browseService) {
    throw new SyncError(
      "Roon browse access is not available yet. Re-open the Wishlist extension in Roon after upgrading, then try again.",
      503
    );
  }

  const sessionKey = `wishlist-tag-sync:${crypto.randomUUID()}`;
  const tagLevel =
    await openTagViaBrowseTree(browseService, tagName, sessionKey) ||
    await openTagViaSearch(browseService, tagName, sessionKey);

  if (!tagLevel) {
    throw new SyncError(`Could not find the Roon tag "${tagName}".`, 404);
  }

  const albumLevel = await openAlbumLevelFromTag(browseService, tagLevel, sessionKey);
  return mapAlbumItems(albumLevel.items);
}

async function syncTaggedAlbums({ browseService, wishlist, searchAll, tagName, onProgress }) {
  const wantedTag = String(tagName || ROON_WISHLIST_TAG).trim() || ROON_WISHLIST_TAG;
  const albums = await listTaggedAlbums(browseService, wantedTag);

  let added = 0;
  let updated = 0;
  let unchanged = 0;
  let withLinks = 0;
  let withoutLinks = 0;
  let lookupErrors = 0;

  for (let i = 0; i < albums.length; i += 1) {
    const album = albums[i];
    if (typeof onProgress === "function") {
      await onProgress({ current: i + 1, total: albums.length, album, tagName: wantedTag });
    }

    let next = { artist: album.artist, title: album.title };
    try {
      const buyLinks = await searchAll(album.artist, album.title);
      next.buyLinks = buyLinks;
      if (buyLinks.length) withLinks += 1;
      else withoutLinks += 1;
    } catch {
      lookupErrors += 1;
    }

    const result = wishlist.upsert(next);
    if (result === "added") added += 1;
    else if (result === "updated") updated += 1;
    else unchanged += 1;
  }

  return {
    tagName: wantedTag,
    totalTaggedAlbums: albums.length,
    added,
    updated,
    unchanged,
    withLinks,
    withoutLinks,
    lookupErrors,
  };
}

module.exports = {
  ROON_WISHLIST_TAG,
  SyncError,
  listTaggedAlbums,
  syncTaggedAlbums,
};
