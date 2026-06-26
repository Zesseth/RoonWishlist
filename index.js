"use strict";

const RoonApi = require("node-roon-api");
const RoonApiBrowse = require("node-roon-api-browse");
const RoonApiSettings = require("node-roon-api-settings");
const RoonApiStatus = require("node-roon-api-status");
const wishlist = require("./src/wishlist");
const { searchAll } = require("./src/search");
const lossless = require("./src/lossless_checker");
const lowQualityIgnore = require("./src/ignored_low_quality");
const { ROON_WISHLIST_TAG, SyncError, syncTaggedAlbums, rebuildTaggedAlbums } = require("./src/roon_tag_sync");
const { getStorageLocations } = require("./src/roon_storage");

let roon, mysettings, svc_status;
let pairedCore = null;
// Guards against two library scans running at once (Roon settings action + HTTP API).
let scanInProgress = false;
let scanActivity = null;
let syncInProgress = false;
let lastLowQualityScan = null;

const roonApp = new RoonApi({
  extension_id: "com.zesseth.roon-wishlist",
  display_name: "Wishlist",
  display_version: "0.1.0",
  publisher: "Zesseth",
  email: "",
  website: "https://github.com/Zesseth/RoonWishlist",

  core_paired(core) {
    pairedCore = core;
    console.log("Paired with Roon core:", core.display_name);
    svc_status.set_status("Paired", false);
  },

  core_unpaired(core) {
    pairedCore = null;
    console.log("Unpaired from Roon core:", core.display_name);
    svc_status.set_status("Not paired", false);
  },
});

mysettings = roonApp.load_config("settings") || {
  music_library_path: "",
};

function renderWishlist(items) {
  if (!items.length) return "Wishlist is empty.";
  return items.map((a, i) => `${i + 1}. ${a.artist} — ${a.title}`).join("\n");
}

// Builds the native Roon settings layout. Roon renders this UI itself, so we get a
// menu without writing any custom graphics. Actions are performed when the user
// presses Save (the standard Roon idiom — the basic layout has no button widget).
function make_layout(settings) {
  const l = {
    values: settings,
    layout: [],
    has_error: false,
  };

  const action = settings.action || "none";

  l.layout.push({
    type: "group",
    title: "Current wishlist",
    items: [{ type: "label", title: renderWishlist(wishlist.getAll()) }],
  });

  const actionItems = [
    {
      type: "dropdown",
      title: "Action",
      subtitle: "Pick an action, fill the fields below if shown, then press Save.",
      values: [
        { title: "— none —", value: "none" },
        { title: "Add album to wishlist", value: "add" },
        { title: "Remove album from wishlist", value: "remove" },
        { title: "Refresh & clean (scan library)", value: "clean" },
        { title: "Scan low-quality albums into wishlist", value: "low_quality" },
      ],
      setting: "action",
    },
  ];
  if (action === "add" || action === "remove") {
    actionItems.push({ type: "string", title: "Artist", setting: "artist" });
    actionItems.push({ type: "string", title: "Album title", setting: "title" });
  }
  l.layout.push({ type: "group", title: "Actions", items: actionItems });

  l.layout.push({
    type: "string",
    title: "Music library path (FLAC detection)",
    subtitle: "Local path where albums are scanned. Fully FLAC albums are cleaned from the wishlist; partial/non-FLAC albums can be added to it.",
    setting: "music_library_path",
  });

  return l;
}

async function performAction(values) {
  const action = values.action || "none";
  const artist = (values.artist || "").trim();
  const title = (values.title || "").trim();

  if (action === "add") {
    return wishlist.add({ artist, title })
      ? `Added: ${artist} — ${title}`
      : "Album already on wishlist";
  }
  if (action === "remove") {
    return wishlist.remove({ artist, title })
      ? `Removed: ${artist} — ${title}`
      : "Album not found on wishlist";
  }
  if (action === "clean") {
    const removed = await runLosslessClean();
    return `Refresh & clean done: removed ${removed.length} album(s) that are already fully FLAC`;
  }
  if (action === "low_quality") {
    const result = await runLowQualityScan();
    return `Low-quality scan done: added ${result.added}, already on wishlist ${result.alreadyPresent}, ignored ${result.ignored}`;
  }
  return "Settings saved";
}

const svc_settings = new RoonApiSettings(roonApp, {
  get_settings(cb) {
    cb(make_layout(mysettings));
  },
  save_settings(req, isdryrun, settings) {
    const l = make_layout(settings.values);
    const action = settings.values.action || "none";

    // Validate only on a real save so dynamically revealed fields don't error mid-edit.
    if (!isdryrun && (action === "add" || action === "remove")) {
      const artist = (settings.values.artist || "").trim();
      const title = (settings.values.title || "").trim();
      if (!artist || !title) l.has_error = true;
    }

    req.send_complete(l.has_error ? "NotValid" : "Success", { settings: l });

    if (!isdryrun && !l.has_error) {
      // Persist only durable config; action/artist/title are transient.
      mysettings = Object.assign({}, mysettings, {
        music_library_path: settings.values.music_library_path || "",
      });
      roonApp.save_config("settings", mysettings);

      // A library scan can take a while; show immediate feedback and run it without
      // blocking this callback. Errors are reported via status, not send_complete
      // (which has already been called above).
      if (action === "clean") svc_status.set_status("Scanning library for all-FLAC albums...", false);
      if (action === "low_quality") svc_status.set_status("Scanning library for low-quality albums...", false);

      Promise.resolve()
        .then(() => performAction(settings.values))
        .then((statusMsg) => {
          // Push a refreshed layout with the updated wishlist and cleared transient fields.
          const cleared = Object.assign({}, mysettings, { action: "none", artist: "", title: "" });
          svc_settings.update_settings(make_layout(cleared));
          svc_status.set_status(statusMsg, false);
        })
        .catch((e) => {
          svc_status.set_status("Action failed: " + e.message, false);
        });
    }
  },
});

svc_status = new RoonApiStatus(roonApp);

// Service ID for Roon browse actions - must be globally unique, not user-specific
const ROON_BROWSE_SERVICE_ID = "com.roonwishlist.browse";

// Create a custom Browse service that extends RoonApiBrowse to add our actions
const svc_browse = new RoonApiBrowse(roonApp);

// Add custom action: Add current album to wishlist directly from Roon UI
svc_browse.add_action({
  name: "Add to wishlist",
  // Show this action when user is viewing an album in Browse
  when: { hierarchy: "browse", level: "album" },
  action: function(params, callback) {
    const artist = params.artist || "";
    const title = params.title || "";
    
    if (!artist || !title) {
      callback({ success: false, message: "No album information available" });
      return;
    }
    
    try {
      const trimmedArtist = artist.trim();
      const trimmedTitle = title.trim();
      
      if (wishlist.add({ artist: trimmedArtist, title: trimmedTitle, source: "roon-browse" })) {
        console.log(`Added album to wishlist from Roon: ${trimmedArtist} — ${trimmedTitle}`);
        svc_status.set_status(`Added to wishlist: ${trimmedArtist} — ${trimmedTitle}`, false);
        callback({ success: true, message: "Added to wishlist" });
      } else {
        callback({ success: false, message: "Already on wishlist" });
      }
    } catch (e) {
      console.error("Error adding album from Roon:", e.message);
      callback({ success: false, message: "Error adding to wishlist" });
    }
  },
});

roonApp.init_services({
  provided_services: [svc_settings, svc_status, svc_browse],
  optional_services: [],
});

svc_status.set_status("Initializing…", false);

roonApp.start_discovery();

// --- Simple HTTP control API for wishlist management ---
// Roon extensions don't have direct UI for custom actions beyond settings,
// so we expose a lightweight local HTTP API on port 3141 for CLI/browser use.

const http = require("http");
const fs = require("fs");
const path = require("path");

// Static web UI lives in ./public. This is the extension's full-featured surface:
// Roon's public API does not allow extensions to add items to the Browse menu, so
// the web UI (served here) is where users manage the wishlist with a real interface.
const PUBLIC_DIR = path.join(__dirname, "public");
const STATIC_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function serveStatic(res, pathname) {
  const rel = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  // Resolve within PUBLIC_DIR and reject any path traversal.
  const filePath = path.join(PUBLIC_DIR, rel);
  if (!filePath.startsWith(PUBLIC_DIR + path.sep) && filePath !== path.join(PUBLIC_DIR, "index.html")) {
    res.statusCode = 403;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Forbidden" }));
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.statusCode = 404;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Not found" }));
      return;
    }
    res.setHeader("Content-Type", STATIC_TYPES[path.extname(filePath)] || "application/octet-stream");
    res.end(data);
  });
}

// Read a JSON request body with a hard size cap so a malformed/hostile client can't
// make the process buffer unbounded data. Calls onJson(parsed) on success.
const MAX_BODY_BYTES = 64 * 1024;
function readJsonBody(req, res, onJson) {
  let body = "";
  let aborted = false;
  req.on("data", (c) => {
    if (aborted) return;
    body += c;
    if (body.length > MAX_BODY_BYTES) {
      aborted = true;
      res.statusCode = 413;
      res.end(JSON.stringify({ error: "Payload too large" }));
      req.destroy();
    }
  });
  req.on("end", () => {
    if (aborted) return;
    try {
      onJson(JSON.parse(body));
    } catch {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: "Invalid JSON" }));
    }
  });
}

function getBrowseService() {
  return pairedCore && pairedCore.services ? pairedCore.services.RoonApiBrowse : null;
}

/**
 * Get all storage locations to scan.
 * Tries to fetch from Roon first, falls back to manual library path.
 */
async function getAllStorageLocations() {
  const browseService = getBrowseService();
  const manualPath = (mysettings.music_library_path || "").trim();
  
  // If we have browse service, try to get storage locations from Roon
  if (browseService) {
    const roonLocations = await getStorageLocations(browseService, manualPath);
    if (roonLocations.length > 0) {
      return roonLocations;
    }
  }
  
  // Fallback to manual path
  if (manualPath) {
    return [manualPath];
  }
  
  return [];
}

function makeHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function runLibraryScanAction(task, { startStatus, successStatus, action, actionMultiple }) {
  const storageLocations = await getAllStorageLocations();
  if (!storageLocations || storageLocations.length === 0) {
    throw makeHttpError(400, "No storage locations available. Set music library path in Settings or pair with Roon.");
  }
  if (scanInProgress) {
    throw makeHttpError(409, "A library scan is already running");
  }

  scanInProgress = true;
  scanActivity = task;
  svc_status.set_status(startStatus, false);
  try {
    // Use multi-location version if available, otherwise fall back to single
    const result = actionMultiple 
      ? await actionMultiple(storageLocations)
      : await action(storageLocations[0]);
    try { svc_settings.update_settings(make_layout(mysettings)); } catch {}
    svc_status.set_status(successStatus(result), false);
    return result;
  } catch (e) {
    svc_status.set_status(`Library scan failed: ${e.message}`, false);
    throw e;
  } finally {
    scanInProgress = false;
    scanActivity = null;
  }
}

async function runLosslessClean() {
  return runLibraryScanAction("clean", {
    startStatus: "Scanning library for all-FLAC albums...",
    successStatus(removed) {
      return `Refresh & clean done: removed ${removed.length} album(s) that are already fully FLAC`;
    },
    actionMultiple(storageLocations) {
      return lossless.checkAndCleanMultiple(storageLocations, wishlist);
    },
    // Fallback for single location (should not be used with new code)
    action(libraryPath) {
      return lossless.checkAndClean(libraryPath, wishlist);
    },
  });
}

async function runLowQualityScan() {
  const startedAt = new Date().toISOString();
  const result = await runLibraryScanAction("low-quality", {
    startStatus: "Scanning library for low-quality albums...",
    successStatus(summary) {
      return `Low-quality scan done: added ${summary.added}, already on wishlist ${summary.alreadyPresent}, ignored ${summary.ignored}`;
    },
    actionMultiple(storageLocations) {
      return lossless.scanLowQualityAlbumsMultiple(storageLocations, wishlist, lowQualityIgnore);
    },
    // Fallback for single location (should not be used with new code)
    action(libraryPath) {
      return lossless.scanLowQualityAlbums(libraryPath, wishlist, lowQualityIgnore);
    },
  });

  lastLowQualityScan = {
    ...result,
    startedAt,
    finishedAt: new Date().toISOString(),
  };
  return lastLowQualityScan;
}

async function runRoonTagAction(res, { verb, successStatus, action }) {
  if (!pairedCore) {
    res.statusCode = 503;
    res.end(JSON.stringify({ error: "Roon is not paired yet." }));
    return;
  }
  if (syncInProgress) {
    res.statusCode = 409;
    res.end(JSON.stringify({ error: "A Roon tag sync is already running" }));
    return;
  }

  const browseService = getBrowseService();
  syncInProgress = true;
  svc_status.set_status(`${verb} Roon tag "${ROON_WISHLIST_TAG}"…`, false);
  try {
    const result = await action({
      browseService,
      onProgress({ current, total, album }) {
        svc_status.set_status(
          `${verb} Roon tag "${ROON_WISHLIST_TAG}"… ${current}/${total} (${album.artist || "Unknown artist"} — ${album.title})`,
          false
        );
      },
    });
    try { svc_settings.update_settings(make_layout(mysettings)); } catch {}
    svc_status.set_status(successStatus(result), false);
    res.end(JSON.stringify(result, null, 2));
  } catch (e) {
    const statusCode = e instanceof SyncError && e.statusCode ? e.statusCode : 500;
    svc_status.set_status(`Roon tag action failed: ${e.message}`, false);
    res.statusCode = statusCode;
    res.end(JSON.stringify({ error: e.message }));
  } finally {
    syncInProgress = false;
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost`);

  // Serve the web UI (GET, non-API paths) before defaulting to JSON responses.
  const apiPaths = [
    "/wishlist",
    "/wishlist/roon-tag",
    "/wishlist/low-quality",
    "/wishlist/add",
    "/wishlist/remove",
    "/search",
    "/check-lossless",
    "/scan-low-quality",
    "/ignore-low-quality",
    "/sync-roon-tag",
    "/rebuild-from-roon-tag",
    "/settings",
    "/status",
  ];
  if (req.method === "GET" && !apiPaths.includes(url.pathname)) {
    serveStatic(res, url.pathname);
    return;
  }

  res.setHeader("Content-Type", "application/json");

  if (req.method === "GET" && url.pathname === "/wishlist") {
    res.end(JSON.stringify(wishlist.getAll(), null, 2));
    return;
  }

  if (req.method === "GET" && url.pathname === "/wishlist/roon-tag") {
    const all = wishlist.getAll();
    // Include items with source "roon-tag" or legacy items without a source (manual additions)
    const roonTagAlbums = all.filter((a) => a.source === "roon-tag" || !a.source);
    res.end(JSON.stringify(roonTagAlbums, null, 2));
    return;
  }

  if (req.method === "GET" && url.pathname === "/wishlist/low-quality") {
    const all = wishlist.getAll();
    // Include items with source "low-quality" or legacy low-quality items with quality metadata
    const lowQualityAlbums = all.filter((a) => 
      a.source === "low-quality" || 
      (a.qualityFlacTracks !== undefined && a.qualityTotalTracks !== undefined)
    );
    res.end(JSON.stringify(lowQualityAlbums, null, 2));
    return;
  }

  if (req.method === "POST" && url.pathname === "/wishlist/add") {
    readJsonBody(req, res, (album) => {
      const added = wishlist.add(album);
      res.end(JSON.stringify({ added }));
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/wishlist/remove") {
    readJsonBody(req, res, (album) => {
      const removed = wishlist.remove(album);
      res.end(JSON.stringify({ removed }));
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/search") {
    const artist = url.searchParams.get("artist") || "";
    const title = url.searchParams.get("title") || "";
    if (!artist && !title) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: "artist and/or title required" }));
      return;
    }
    const results = await searchAll(artist, title);
    res.end(JSON.stringify(results, null, 2));
    return;
  }

  // Clear & rebuild: remove low-quality albums, clean FLAC matches, then rescan for low-quality
  if (req.method === "POST" && url.pathname === "/check-lossless") {
    try {
      // First: clear existing low-quality albums
      const allItems = wishlist.getAll();
      const lowQualityItems = allItems.filter(a => a.source === "low-quality");
      const clearedLowQuality = [];
      for (const item of lowQualityItems) {
        if (wishlist.remove(item)) {
          clearedLowQuality.push(item);
        }
      }
      
      // Second: remove FLAC albums from wishlist
      const removed = await runLosslessClean();
      
      // Third: scan for new low-quality albums
      let lowQualityResult = null;
      if (mysettings.music_library_path && mysettings.music_library_path.trim()) {
        lowQualityResult = await runLowQualityScan();
      }
      
      res.end(JSON.stringify({ 
        clearedLowQuality,
        removedFromWishlist: removed,
        lowQualityScan: lowQualityResult
      }));
    } catch (e) {
      res.statusCode = e.statusCode || 500;
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/scan-low-quality") {
    try {
      const result = await runLowQualityScan();
      res.end(JSON.stringify(result, null, 2));
    } catch (e) {
      res.statusCode = e.statusCode || 500;
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/ignore-low-quality") {
    readJsonBody(req, res, (album) => {
      Promise.resolve()
        .then(async () => {
          const artist = typeof album.artist === "string" ? album.artist.trim() : "";
          const title = typeof album.title === "string" ? album.title.trim() : "";
          if (!artist || !title) {
            throw makeHttpError(400, "artist and title are required");
          }

          const ignored = await lowQualityIgnore.add({ artist, title });
          const removedFromWishlist = wishlist.remove({ artist, title });
          if (lastLowQualityScan) {
            const matchesAlbum = (item) => item && item.artist === artist && item.title === title;
            const removedFromAdded = Array.isArray(lastLowQualityScan.addedAlbums)
              ? lastLowQualityScan.addedAlbums.filter(matchesAlbum).length
              : 0;
            const removedFromAlreadyPresent = Array.isArray(lastLowQualityScan.alreadyPresentAlbums)
              ? lastLowQualityScan.alreadyPresentAlbums.filter(matchesAlbum).length
              : 0;
            const ignoredAlbums = Array.isArray(lastLowQualityScan.ignoredAlbums)
              ? lastLowQualityScan.ignoredAlbums.filter((item) => !matchesAlbum(item))
              : [];
            ignoredAlbums.push({ artist, title });
            lastLowQualityScan = Object.assign({}, lastLowQualityScan, {
              added: Math.max(0, (lastLowQualityScan.added || 0) - removedFromAdded),
              alreadyPresent: Math.max(0, (lastLowQualityScan.alreadyPresent || 0) - removedFromAlreadyPresent),
              ignored: (lastLowQualityScan.ignored || 0) + removedFromAdded + removedFromAlreadyPresent,
              addedAlbums: Array.isArray(lastLowQualityScan.addedAlbums)
                ? lastLowQualityScan.addedAlbums.filter((item) => !matchesAlbum(item))
                : [],
              alreadyPresentAlbums: Array.isArray(lastLowQualityScan.alreadyPresentAlbums)
                ? lastLowQualityScan.alreadyPresentAlbums.filter((item) => !matchesAlbum(item))
                : [],
              ignoredAlbums,
            });
          }
          try { svc_settings.update_settings(make_layout(mysettings)); } catch {}
          svc_status.set_status(`Ignored low-quality album: ${artist} — ${title}`, false);
          return { ignored, removedFromWishlist };
        })
        .then((payload) => {
          res.end(JSON.stringify(payload));
        })
        .catch((e) => {
          res.statusCode = e.statusCode || 500;
          res.end(JSON.stringify({ error: e.message }));
        });
    });
    return;
  }

  if (url.pathname === "/sync-roon-tag") {
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }
    await runRoonTagAction(res, {
      verb: "Syncing",
      successStatus(result) {
        return `Roon tag sync done: added ${result.added}, updated ${result.updated}, links ${result.withLinks}/${result.totalTaggedAlbums}`;
      },
      action({ browseService, onProgress }) {
        return syncTaggedAlbums({
          browseService,
          wishlist,
          searchAll,
          tagName: ROON_WISHLIST_TAG,
          onProgress,
        });
      },
    });
    return;
  }

  if (url.pathname === "/rebuild-from-roon-tag") {
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }
    await runRoonTagAction(res, {
      verb: "Rebuilding from",
      successStatus(result) {
        return `Roon tag rebuild done: replaced ${result.previousWishlistCount} with ${result.rebuilt}, links ${result.withLinks}/${result.totalTaggedAlbums}`;
      },
      action({ browseService, onProgress }) {
        return rebuildTaggedAlbums({
          browseService,
          wishlist,
          searchAll,
          tagName: ROON_WISHLIST_TAG,
          onProgress,
        });
      },
    });
    return;
  }

  // Connection + summary status for the web UI header.
  if (req.method === "GET" && url.pathname === "/status") {
    res.end(JSON.stringify({
      paired: !!pairedCore,
      core: pairedCore ? pairedCore.display_name : null,
      browseAvailable: !!getBrowseService(),
      roonTagName: ROON_WISHLIST_TAG,
      syncInProgress,
      scanInProgress,
      scanActivity,
      lastLowQualityScan,
      libraryPath: mysettings.music_library_path || "",
      count: wishlist.getAll().length,
      version: "0.1.0",
    }));
    return;
  }

  // Read the durable settings (currently just the music library path).
  if (req.method === "GET" && url.pathname === "/settings") {
    res.end(JSON.stringify({ music_library_path: mysettings.music_library_path || "" }));
    return;
  }

  // Update the music library path from the web UI and persist it (same store the
  // Roon settings screen uses), then push a refreshed layout if that screen is open.
  if (req.method === "POST" && url.pathname === "/settings") {
    readJsonBody(req, res, (data) => {
      const p = typeof data.music_library_path === "string" ? data.music_library_path.trim() : "";
      mysettings = Object.assign({}, mysettings, { music_library_path: p });
      roonApp.save_config("settings", mysettings);
      const cleared = Object.assign({}, mysettings, { action: "none", artist: "", title: "" });
      try { svc_settings.update_settings(make_layout(cleared)); } catch {}
      res.end(JSON.stringify({ music_library_path: mysettings.music_library_path }));
    });
    return;
  }

  res.statusCode = 404;
  res.end(JSON.stringify({ error: "Not found" }));
});

// HTTP bind is configurable for running on a server. Defaults to localhost-only for
// safety; set ROON_WISHLIST_HTTP_HOST=0.0.0.0 to expose it on the LAN (see README).
const HTTP_PORT = parseInt(process.env.ROON_WISHLIST_HTTP_PORT || "3141", 10);
const HTTP_HOST = process.env.ROON_WISHLIST_HTTP_HOST || "127.0.0.1";

server.listen(HTTP_PORT, HTTP_HOST, () => {
  console.log(`Wishlist web UI + API listening on http://${HTTP_HOST}:${HTTP_PORT}`);
  svc_status.set_status(`Running — web UI on http://${HTTP_HOST}:${HTTP_PORT}`, false);
});
