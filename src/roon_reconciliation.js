"use strict";

/**
 * Roon Tag Sync Reconciliation
 * Ensures wishlist stays in sync with Roon tags on startup and periodically
 */

class ReconciliationError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.name = "ReconciliationError";
    this.statusCode = statusCode || 500;
  }
}

/**
 * Reconcile wishlist with Roon tags on startup
 * If Roon-tagged albums exist, sync them into the wishlist
 * @param {Object} browseService - Roon Browse service (optional)
 * @param {Object} wishlist - Wishlist module
 * @param {Function} searchAll - Search function for buy links
 * @param {Function} onProgress - Progress callback (optional)
 * @returns {Promise<Object>} Reconciliation summary
 */
async function reconcileOnStartup({ browseService, wishlist, searchAll, tagName, onProgress }) {
  if (!browseService) {
    // No browse access yet, skip reconciliation
    return {
      status: "skipped",
      reason: "Browse service not available",
      details: "Reconciliation will run when Roon pairing is established",
    };
  }

  try {
    // Try to get Roon-tagged albums
    const roonTagSync = require("./roon_tag_sync");
    const taggedAlbums = await roonTagSync.listTaggedAlbums(browseService, tagName);

    if (!taggedAlbums || taggedAlbums.length === 0) {
      return {
        status: "completed",
        reconciled: 0,
        reason: "No Roon-tagged albums found",
      };
    }

    // Check for discrepancies
    const currentWishlist = wishlist.getAll();
    const wishlistMap = new Map(
      currentWishlist.map((a) => [normalizeKey(a.artist, a.title), a])
    );

    const roonMap = new Map(taggedAlbums.map((a) => [normalizeKey(a.artist, a.title), a]));

    // Find albums in Roon tags but not in wishlist
    const toAdd = [];
    for (const [key, roonAlbum] of roonMap) {
      if (!wishlistMap.has(key)) {
        toAdd.push(roonAlbum);
      }
    }

    // Add missing albums
    let added = 0;
    for (const album of toAdd) {
      try {
        let item = { artist: album.artist, title: album.title, source: "roon-tag" };
        // Try to get buy links
        try {
          const buyLinks = await searchAll(album.artist, album.title);
          if (buyLinks && buyLinks.length) {
            item.buyLinks = buyLinks;
          }
        } catch {
          // Ignore search errors during reconciliation
        }
        if (wishlist.add(item)) {
          added++;
        }
      } catch {
        // Ignore individual add errors
      }
    }

    return {
      status: "completed",
      reconciled: added,
      tagName,
      totalRoonTagged: taggedAlbums.length,
      currentWishlist: currentWishlist.length,
      newlyAdded: added,
    };
  } catch (err) {
    console.warn("Reconciliation error:", err.message);
    return {
      status: "error",
      reason: err.message,
      details: "Reconciliation will retry on next startup or manual sync",
    };
  }
}

/**
 * Track sync reconciliation - ensures tags and wishlist stay aligned
 * Called periodically or on significant events
 * @param {Object} params - Configuration object
 * @returns {Promise<Object>} Sync status
 */
async function trackSyncHealth({ browseService, wishlist, tagName }) {
  if (!browseService) {
    return { healthy: true, reason: "No browse service yet" };
  }

  try {
    const roonTagSync = require("./roon_tag_sync");
    const roonAlbums = await roonTagSync.listTaggedAlbums(browseService, tagName);
    const wishlistAlbums = wishlist.getAll();

    const roonMap = new Map(
      roonAlbums.map((a) => [normalizeKey(a.artist, a.title), a])
    );
    const wishlistMap = new Map(
      wishlistAlbums
        .filter((a) => a.source === "roon-tag")
        .map((a) => [normalizeKey(a.artist, a.title), a])
    );

    // Albums in Roon but not in wishlist
    const missing = [];
    for (const key of roonMap.keys()) {
      if (!wishlistMap.has(key)) {
        missing.push(roonMap.get(key));
      }
    }

    // Albums in wishlist but not in Roon (manually added, or removed from Roon)
    const orphaned = [];
    for (const key of wishlistMap.keys()) {
      if (!roonMap.has(key)) {
        orphaned.push(wishlistMap.get(key));
      }
    }

    return {
      healthy: missing.length === 0 && orphaned.length === 0,
      roonTagged: roonMap.size,
      wishlistFromTag: wishlistMap.size,
      missingInWishlist: missing.length,
      orphanedInWishlist: orphaned.length,
      missing,
      orphaned,
    };
  } catch (err) {
    console.warn("Could not check sync health:", err.message);
    return {
      healthy: null, // Unknown
      reason: err.message,
    };
  }
}

function normalizeKey(artist, title) {
  return `${String(artist || "").trim().toLowerCase()}|${String(title || "").trim().toLowerCase()}`;
}

module.exports = {
  ReconciliationError,
  reconcileOnStartup,
  trackSyncHealth,
};
