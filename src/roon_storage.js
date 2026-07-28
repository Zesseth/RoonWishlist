"use strict";

/**
 * Roon Storage Location Reader
 * Reads music storage locations from Roon Settings via Browse API
 */

class StorageError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.name = "StorageError";
    this.statusCode = statusCode || 500;
  }
}

async function browseAsync(browseService, opts) {
  return new Promise((resolve, reject) => {
    browseService.browse(opts, (err, body) => {
      if (err) reject(new StorageError(`Roon browse failed: ${err}`, 502));
      else resolve(body || {});
    });
  });
}

async function loadAsync(browseService, opts) {
  return new Promise((resolve, reject) => {
    browseService.load(opts, (err, body) => {
      if (err) reject(new StorageError(`Roon browse load failed: ${err}`, 502));
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
    throw new StorageError(body.message || "Roon browse returned an error.", body.is_error === false ? 400 : 502);
  }
  if (body.action !== "list") {
    throw new StorageError(`Unexpected Roon browse action: ${body.action || "none"}`, 502);
  }

  const level = body.list && Number.isInteger(body.list.level) ? body.list.level : undefined;
  const items = await loadAllItems(browseService, hierarchy, sessionKey, level);
  return { hierarchy, items, list: body.list || null };
}

/**
 * Read music storage locations from Roon settings via Browse API
 * @param {Object} browseService - Roon Browse service
 * @returns {Promise<Array>} Array of storage location objects with path and title
 */
async function getStorageLocations(browseService) {
  if (!browseService) {
    throw new StorageError(
      "Roon browse access is not available. Re-open the Wishlist extension in Roon, then try again.",
      503
    );
  }

  try {
    const sessionKey = `wishlist-storage:${Date.now()}`;

    // Navigate to Settings in browse
    const root = await openLevel(browseService, {
      hierarchy: "settings",
      sessionKey,
      popAll: true,
    });

    // Look for a storage/library section (this varies by Roon version)
    // Try to find Storage or Library Settings
    const storageItem = root.items.find(
      (item) =>
        item &&
        item.item_key &&
        (item.title.toLowerCase().includes("storage") || item.title.toLowerCase().includes("library"))
    );

    if (!storageItem || !storageItem.item_key) {
      // Roon may not expose storage via Browse API settings
      return [];
    }

    const storageLevel = await openLevel(browseService, {
      hierarchy: "settings",
      sessionKey,
      itemKey: storageItem.item_key,
    });

    // Parse storage locations from the level items
    // Each storage location typically has a path as subtitle or in the title
    const locations = storageLevel.items
      .filter((item) => item && item.item_key && item.hint !== "header")
      .map((item) => ({
        title: item.title,
        subtitle: item.subtitle || "",
        path: item.subtitle || item.title, // Storage path is typically in subtitle
      }));

    return locations;
  } catch (err) {
    // If storage reading fails, return empty array (fallback to manual path)
    console.warn("Could not read storage locations from Roon:", err.message);
    return [];
  }
}

module.exports = {
  StorageError,
  getStorageLocations,
};
