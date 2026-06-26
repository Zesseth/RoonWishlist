"use strict";

/**
 * Roon storage locations utilities.
 * Fetches configured music storage paths from Roon's settings via the Browse API.
 * Roon allows multiple storage locations (e.g., multiple NAS shares or local paths).
 */

const NON_ALBUM_ACTION_TITLES = new Set([
  "play tag",
  "shuffle tag",
  "queue tag",
  "start radio",
  "play now",
]);

/**
 * Find an item by title from a list, matching against multiple possible titles.
 * Case-insensitive comparison.
 */
function findByTitle(items, possibleTitles) {
  const normalizedTitles = possibleTitles.map(t => t.toLowerCase().trim());
  return (items || []).find(item => 
    item && item.title && normalizedTitles.includes(item.title.toLowerCase().trim())
  );
}

/**
 * Open a specific item in the Roon browse hierarchy.
 */
async function openBrowseItem(browseService, itemKey) {
  return new Promise((resolve, reject) => {
    browseService.load({
      hierarchy: "browse",
      item_key: itemKey,
    }, (err, body) => {
      if (err) reject(new Error(`Roon browse failed: ${err}`));
      else resolve(body || {});
    });
  });
}

/**
 * Recursively find all storage location paths from Roon's Settings > Storage.
 * Returns an array of path strings.
 *
 * Roon's browse hierarchy for storage locations:
 * Browse -> Settings -> Storage -> [Storage Location 1, Storage Location 2, ...]
 * Each storage location item has a title that is the filesystem path.
 */
async function getRoonStorageLocations(browseService) {
  const locations = [];

  if (!browseService) {
    console.log("Roon browse service not available, cannot fetch storage locations");
    return locations;
  }

  try {
    // 1. Open root browse level
    const root = await new Promise((resolve, reject) => {
      browseService.browse({ hierarchy: "browse", pop_all: true }, (err, body) => {
        if (err) reject(new Error(`Roon browse root failed: ${err}`));
        else resolve(body || {});
      });
    });

    // 2. Find Settings item (may be localized: "Settings", "Asetukset", etc.)
    const settingsTitles = ["Settings", "Asetukset", "Parametres", "Einstellungen", "Impostazioni", "Configuracion"];
    const settingsItem = findByTitle(root.items, settingsTitles);
    if (!settingsItem?.item_key) {
      console.log("Could not find Settings in Roon browse hierarchy");
      return locations;
    }

    // 3. Open Settings and find Storage
    const settingsLevel = await openBrowseItem(browseService, settingsItem.item_key);
    const storageTitles = ["Storage", "Tallennuspaikat", "Stockage", "Speicherorte", "Archiviazione", "Almacenamiento"];
    const storageItem = findByTitle(settingsLevel.items, storageTitles);
    if (!storageItem?.item_key) {
      console.log("Could not find Storage in Roon Settings");
      return locations;
    }

    // 4. Open Storage level - this contains the actual storage location items
    const storageLevel = await openBrowseItem(browseService, storageItem.item_key);

    // 5. Extract storage paths from items
    // Each item at this level should represent a storage location with its path as title
    for (const item of storageLevel.items || []) {
      if (!item || !item.title || NON_ALBUM_ACTION_TITLES.has(item.title)) continue;
      
      // Storage location items typically have the path as title
      // Filter out any non-path items (headers, actions, etc.)
      const path = item.title.trim();
      
      // Basic validation: a valid storage path should look like a filesystem path
      // and not be empty or just a single word
      if (path && path.length > 1 && (path.includes("/") || path.includes("\\") || path.match(/^[a-zA-Z]:/))) {
        locations.push(path);
      }
    }

    console.log(`Found ${locations.length} storage location(s) from Roon:`, locations);
  } catch (e) {
    console.error("Error fetching Roon storage locations:", e.message);
  }

  return locations;
}

/**
 * Get storage locations with a fallback to manual library path.
 * If Roon browse service is available, fetch from Roon.
 * Otherwise, use the manually configured music_library_path.
 */
async function getStorageLocations(browseService, manualPath) {
  // Try to get from Roon first
  const roonLocations = await getRoonStorageLocations(browseService);
  
  // If we got locations from Roon, use them
  if (roonLocations.length > 0) {
    return roonLocations;
  }

  // Fallback to manual path if available
  if (manualPath && manualPath.trim()) {
    console.log("Using manual library path as fallback:", manualPath);
    return [manualPath.trim()];
  }

  console.log("No storage locations available - neither from Roon nor manual path");
  return [];
}

module.exports = {
  getRoonStorageLocations,
  getStorageLocations,
};
