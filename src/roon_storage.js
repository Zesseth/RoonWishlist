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
 * Reads music storage locations from Roon settings via the Browse API.
 *
 * Returns the locations **and** a diagnostic describing how the lookup went. Without
 * the diagnostic a failure is invisible: the caller silently falls back to the manual
 * path, and the user cannot tell "Roon does not expose this" apart from "the lookup
 * broke" or "Roon has no storage configured". Those need different fixes, so the
 * difference has to reach the UI rather than only a log line.
 *
 * @param {Object} browseService - Roon Browse service
 * @returns {Promise<{locations: Array, diagnostic: Object}>}
 */
async function getStorageLocationsDetailed(browseService) {
  if (!browseService) {
    return {
      locations: [],
      diagnostic: {
        outcome: "no-browse",
        detail:
          "Roon browse access is not available. Re-open the Wishlist extension in Roon, then try again.",
      },
    };
  }

  try {
    const sessionKey = `wishlist-storage:${Date.now()}`;

    const root = await openLevel(browseService, {
      hierarchy: "settings",
      sessionKey,
      popAll: true,
    });

    const rootTitles = root.items.map((item) => (item && item.title) || "").filter(Boolean);

    // Which entry holds storage varies by Roon version, so match on the title.
    const storageItem = root.items.find(
      (item) =>
        item &&
        item.item_key &&
        typeof item.title === "string" &&
        (item.title.toLowerCase().includes("storage") || item.title.toLowerCase().includes("library")),
    );

    if (!storageItem || !storageItem.item_key) {
      return {
        locations: [],
        diagnostic: {
          outcome: "not-exposed",
          detail:
            "Roon's browsable settings contain no Storage or Library entry, so storage folders cannot be read from Roon on this version. The music library path is used instead.",
          settingsEntries: rootTitles,
        },
      };
    }

    const storageLevel = await openLevel(browseService, {
      hierarchy: "settings",
      sessionKey,
      itemKey: storageItem.item_key,
    });

    const candidates = storageLevel.items.filter(
      (item) => item && item.item_key && item.hint !== "header",
    );

    const locations = candidates.map((item) => ({
      title: item.title,
      subtitle: item.subtitle || "",
      // Roon puts the path in the subtitle on some versions and the title on others.
      path: item.subtitle || item.title,
    }));

    return {
      locations,
      diagnostic: {
        outcome: locations.length ? "ok" : "empty",
        detail: locations.length
          ? `Roon reported ${locations.length} storage entr${locations.length === 1 ? "y" : "ies"} under "${storageItem.title}".`
          : `Roon exposed "${storageItem.title}" but it listed no storage entries.`,
        settingsEntry: storageItem.title,
      },
    };
  } catch (err) {
    return {
      locations: [],
      diagnostic: {
        outcome: "error",
        detail: `Reading storage locations from Roon failed: ${err.message}. The music library path is used instead.`,
      },
    };
  }
}

/**
 * Read music storage locations from Roon settings via Browse API
 * @param {Object} browseService - Roon Browse service
 * @returns {Promise<Array>} Array of storage location objects with path and title
 */
async function getStorageLocations(browseService) {
  const { locations } = await getStorageLocationsDetailed(browseService);
  return locations;
}

module.exports = {
  StorageError,
  getStorageLocations,
  getStorageLocationsDetailed,
};
