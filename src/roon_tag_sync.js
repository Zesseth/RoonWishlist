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
  // Roon 2.71 offers these bare titles next to a tag's albums.
  "shuffle",
  "play",
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

async function openLevel(browseService, { hierarchy, sessionKey, itemKey, input, popAll, allowEmpty }) {
  const browseOpts = {
    hierarchy,
    multi_session_key: sessionKey,
  };
  if (itemKey) browseOpts.item_key = itemKey;
  if (typeof input === "string") browseOpts.input = input;
  if (popAll) browseOpts.pop_all = true;

  const body = await browseAsync(browseService, browseOpts);
  if (body.action === "message") {
    // Roon answers an empty tag with a message rather than an empty list. The caller
    // already knows the tag exists, so "nothing to show" is a result, not a failure.
    if (allowEmpty) return { hierarchy, items: [], list: null };
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
    allowEmpty: true,
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
      allowEmpty: true,
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
    allowEmpty: true,
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

/**
 * Look up the albums carrying the Roon tag.
 *
 * Returns `tagFound: false` rather than throwing when the tag is not in Roon's browse
 * tree. Roon hides a tag once its last album is untagged, so "tag missing" and "tag
 * empty" are the same observation, and the sensible reading of both is "zero albums
 * carry this tag". Callers that intend to mirror Roon need that to be an ordinary
 * result, not an error. A missing browse service still throws: that means we could not
 * look at all, which must never be mistaken for an empty tag.
 */
async function listTaggedAlbumsDetailed(browseService, tagName) {
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
    return { albums: [], tagFound: false };
  }

  // A tag that still exists but holds nothing opens as an empty level. That is not a
  // failure to read the tag - it is the answer, and it is the whole point of the
  // "I untagged everything" case, so it must not be reported as an error.
  const actionable = (tagLevel.items || []).filter(
    (item) => item && item.item_key && item.hint !== "header" && !isTagAction(item),
  );
  if (!actionable.length) {
    return { albums: [], tagFound: true };
  }

  const albumLevel = await openAlbumLevelFromTag(browseService, tagLevel, sessionKey);
  return { albums: mapAlbumItems(albumLevel.items), tagFound: true };
}

/** "Play Tag", "Shuffle Tag" and friends are offered even when the tag holds nothing. */
function isTagAction(item) {
  return NON_ALBUM_ACTION_TITLES.has(normalizeTitle(item && item.title));
}

async function listTaggedAlbums(browseService, tagName) {
  const { albums, tagFound } = await listTaggedAlbumsDetailed(browseService, tagName);
  if (!tagFound) {
    throw new SyncError(`Could not find the Roon tag "${tagName}".`, 404);
  }
  return albums;
}

/**
 * @param {Function} [options.shouldFindLinks] Asked before each store lookup. Albums the
 *   user already owns in lossless need no buy links, so scraping stores for them would
 *   be work done to answer a question nobody asked.
 */
async function buildTaggedWishlist({ browseService, searchAll, tagName, onProgress, shouldFindLinks }) {
  const wantedTag = String(tagName || ROON_WISHLIST_TAG).trim() || ROON_WISHLIST_TAG;
  const { albums, tagFound } = await listTaggedAlbumsDetailed(browseService, wantedTag);

  let withLinks = 0;
  let withoutLinks = 0;
  let lookupErrors = 0;
  let skippedLinks = 0;
  const wishlistAlbums = [];

  for (let i = 0; i < albums.length; i += 1) {
    const album = albums[i];
    if (typeof onProgress === "function") {
      await onProgress({ current: i + 1, total: albums.length, album, tagName: wantedTag });
    }

    let next = { artist: album.artist, title: album.title, source: "roon-tag" };
    const wantLinks =
      typeof shouldFindLinks === "function" ? shouldFindLinks(album) !== false : true;
    if (!wantLinks) {
      skippedLinks += 1;
    } else {
      try {
        const buyLinks = await searchAll(album.artist, album.title);
        next.buyLinks = buyLinks;
        if (buyLinks.length) withLinks += 1;
        else withoutLinks += 1;
      } catch {
        lookupErrors += 1;
      }
    }

    wishlistAlbums.push(next);
  }

  return {
    tagName: wantedTag,
    tagFound,
    totalTaggedAlbums: albums.length,
    wishlistAlbums,
    withLinks,
    withoutLinks,
    lookupErrors,
    skippedLinks,
  };
}

/**
 * Mirror the Roon tag into the wishlist.
 *
 * Roon is the master for anything that came from the tag: untagging an album in Roon
 * has to remove it here too, otherwise the wishlist only ever grows and quietly drifts
 * out of step with the tag it claims to mirror.
 *
 * Entries the user added by hand are left alone. They were never derived from the tag,
 * so the tag has no authority to delete them.
 */
async function syncTaggedAlbums({ browseService, wishlist, searchAll, tagName, onProgress, shouldFindLinks }) {
  const prepared = await buildTaggedWishlist({ browseService, searchAll, tagName, onProgress, shouldFindLinks });

  let added = 0;
  let updated = 0;
  let unchanged = 0;

  for (const album of prepared.wishlistAlbums) {
    const result = wishlist.upsert(album);
    if (result === "added") added += 1;
    else if (result === "updated") updated += 1;
    else unchanged += 1;
  }

  const tagged = new Set(prepared.wishlistAlbums.map((a) => albumKey(a)));
  const removed = [];
  for (const entry of wishlist.getAll()) {
    if (entry.source !== "roon-tag") continue;
    if (tagged.has(albumKey(entry))) continue;
    if (wishlist.remove(entry)) removed.push({ artist: entry.artist, title: entry.title });
  }

  return {
    tagName: prepared.tagName,
    tagFound: prepared.tagFound,
    totalTaggedAlbums: prepared.totalTaggedAlbums,
    added,
    updated,
    unchanged,
    removed: removed.length,
    removedAlbums: removed,
    withLinks: prepared.withLinks,
    withoutLinks: prepared.withoutLinks,
    lookupErrors: prepared.lookupErrors,
    skippedLinks: prepared.skippedLinks,
  };
}

function albumKey(album) {
  return `${String(album && album.artist ? album.artist : "").trim().toLowerCase()}||${String(
    album && album.title ? album.title : "",
  ).trim().toLowerCase()}`;
}

async function rebuildTaggedAlbums({ browseService, wishlist, searchAll, tagName, onProgress, shouldFindLinks }) {
  const prepared = await buildTaggedWishlist({ browseService, searchAll, tagName, onProgress, shouldFindLinks });
  const previousWishlistCount = wishlist.getAll().length;
  const rebuilt = wishlist.replaceAll(prepared.wishlistAlbums);

  return {
    tagName: prepared.tagName,
    tagFound: prepared.tagFound,
    totalTaggedAlbums: prepared.totalTaggedAlbums,
    rebuilt,
    previousWishlistCount,
    cleared: previousWishlistCount,
    withLinks: prepared.withLinks,
    withoutLinks: prepared.withoutLinks,
    lookupErrors: prepared.lookupErrors,
  };
}

// Titles Roon would use if it offered tag editing on an album. Kept as a set so the
// probe below reports a match rather than guessing from a substring.
const TAG_EDIT_TITLES = new Set([
  "tags", "tagit", "edit tags", "add to tag", "remove from tag", "remove from tags",
]);

/**
 * Asks Roon, read-only, whether an album offers any tag-editing action.
 *
 * `ROON_API_LIMITATIONS.md` records that the Browse API exposes no tag writes, so the
 * extension cannot untag an album on the user's behalf. That claim was made from
 * reading the SDK rather than from asking a real core, and it decides a feature the
 * user asked for, so this measures it instead: it navigates into the first tagged
 * album and reports every action Roon offers there. Navigation only - no item that
 * could change anything is ever invoked. See issue #32.
 */
async function probeTagWriteSupport(browseService, tagName) {
  if (!browseService) {
    throw new SyncError("Roon browse access is not available yet.", 503);
  }

  const wantedTag = String(tagName || ROON_WISHLIST_TAG).trim() || ROON_WISHLIST_TAG;
  const sessionKey = `wishlist-tag-probe:${crypto.randomUUID()}`;
  const tagLevel =
    await openTagViaBrowseTree(browseService, wantedTag, sessionKey) ||
    await openTagViaSearch(browseService, wantedTag, sessionKey);

  if (!tagLevel) {
    return { tagFound: false, supported: false, reason: `The tag "${wantedTag}" is not in Roon.`, offered: [] };
  }

  const actionable = (tagLevel.items || []).filter(
    (item) => item && item.item_key && item.hint !== "header" && !isTagAction(item),
  );
  if (!actionable.length) {
    return {
      tagFound: true,
      supported: false,
      reason: "The tag holds no albums, so there was nothing to inspect.",
      offered: [],
    };
  }

  const albumLevel = await openAlbumLevelFromTag(browseService, tagLevel, sessionKey);
  // "Play Tag" and friends sit alongside the albums. Opening one of those and finding
  // no tag editing would prove nothing, so they are skipped: the probe must land on a
  // real album or say it could not.
  const isCandidate = (item) => item && item.item_key && item.hint !== "header" && !isTagAction(item);
  const albumItems = (albumLevel.items || []).filter(isCandidate);
  // Roon marks playable rows as actions and browsable ones as lists, so prefer a list
  // row; a bare title match is only the fallback for versions that set no hint.
  const album = albumItems.find((item) => item.hint && item.hint !== "action") || albumItems[0];
  if (!album) {
    return { tagFound: true, supported: false, reason: "No album could be opened from the tag.", offered: [] };
  }

  const detail = await openLevel(browseService, {
    hierarchy: "browse",
    sessionKey,
    itemKey: album.item_key,
    allowEmpty: true,
  });

  const offered = (detail.items || []).map((item) => ({ title: item.title, hint: item.hint || null }));
  const matched = offered.find((entry) => TAG_EDIT_TITLES.has(normalizeTitle(entry.title))) || null;

  return {
    tagFound: true,
    album: album.title || null,
    supported: Boolean(matched),
    matched,
    offered,
    reason: matched
      ? `Roon offers "${matched.title}" on an album, so tag editing may be possible.`
      : "Roon offered no tag-editing action on the album, so tags cannot be changed over the Browse API.",
  };
}

module.exports = {
  ROON_WISHLIST_TAG,
  SyncError,
  listTaggedAlbums,
  listTaggedAlbumsDetailed,
  probeTagWriteSupport,
  syncTaggedAlbums,
  rebuildTaggedAlbums,
};
