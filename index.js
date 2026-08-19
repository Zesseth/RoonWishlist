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
const { reconcileOnStartup, trackSyncHealth } = require("./src/roon_reconciliation");
const { getStorageLocationsDetailed } = require("./src/roon_storage");
const scanLocations = require("./src/scan_locations");

let roon, mysettings, svc_status;
let pairedCore = null;
// Guards against two library scans running at once (Roon settings action + HTTP API).
let scanInProgress = false;
let scanActivity = null;
let syncInProgress = false;
let reconciliationInProgress = false;
let lastLowQualityScan = null;
let lastReconciliation = null;
let roonStorageLocations = [];
// Why the last Roon storage lookup produced what it did. Kept so the UI can explain a
// fallback instead of just showing an empty list.
let roonStorageDiagnostic = {
  outcome: "not-checked",
  detail: "Roon has not been asked for storage locations yet.",
};
// Last resolved view of where scans will run, cached so the settings screen can show
// it without re-querying Roon on every render.
let resolvedScanLocations = { locations: [], active: [], excluded: [], usedFallback: false };

// Roon identifies an extension by `extension_id`. Two processes sharing one id fight
// over the pairing, so a test build must announce itself as a different extension.
// Both default to the production values, so a normal install is unaffected.
const EXTENSION_ID = process.env.ROON_WISHLIST_EXTENSION_ID || "com.zesseth.roon-wishlist";
const DISPLAY_NAME = process.env.ROON_WISHLIST_DISPLAY_NAME || "Wishlist";

const roonApp = new RoonApi({
  extension_id: EXTENSION_ID,
  display_name: DISPLAY_NAME,
  display_version: "0.1.0",
  publisher: "Zesseth",
  email: "",
  website: "https://github.com/Zesseth/RoonWishlist",

  core_paired(core) {
    pairedCore = core;
    console.log("Paired with Roon core:", core.display_name);
    svc_status.set_status("Paired", false);
    
    // Trigger reconciliation on pairing (async, don't wait)
    triggerReconciliation().catch((err) => {
      console.warn("Reconciliation after pairing failed:", err.message);
    });

    // Roon can only tell us about storage locations once paired.
    resolveActiveScanLocations().catch((err) => {
      console.warn("Could not resolve scan locations after pairing:", err.message);
    });
  },

  core_unpaired(core) {
    pairedCore = null;
    console.log("Unpaired from Roon core:", core.display_name);
    svc_status.set_status("Not paired", false);
  },
});

mysettings = roonApp.load_config("settings") || {
  music_library_path: "",
  excluded_storage_locations: [],
};
if (!Array.isArray(mysettings.excluded_storage_locations)) {
  mysettings.excluded_storage_locations = [];
}

function renderWishlist(items) {
  if (!items.length) return "Wishlist is empty.";
  return items.map((a, i) => `${i + 1}. ${a.artist} — ${a.title}${renderCheckStatus(a.lastCheck)}`).join("\n");
}

const CHECK_STATUS_LABELS = {
  "owned-lossy": "in library, lossy — still wanted",
  "owned-mixed": "in library, only partly lossless — still wanted",
  "not-audio": "folder found but no audio files",
  "not-found": "not in library",
};

/**
 * Roon's settings UI has no table widget, so the per-album status is appended to the
 * text label instead. `owned-lossless` never appears here: those entries are removed.
 */
function renderCheckStatus(lastCheck) {
  if (!lastCheck || !lastCheck.status) return "";
  const label = CHECK_STATUS_LABELS[lastCheck.status];
  if (!label) return "";
  if (lastCheck.status === "owned-mixed" && lastCheck.totalTracks) {
    return `\n     ↳ ${label} (${lastCheck.losslessTracks}/${lastCheck.totalTracks} tracks lossless)`;
  }
  return `\n     ↳ ${label}`;
}

// Read-only summary of where scans will look. Roon has no table widget, so this is
// rendered as a plain multi-line label.
function renderScanLocations() {
  const { locations, active } = resolvedScanLocations;
  if (!locations.length) {
    return (
      "No storage location detected yet.\n" +
      `Roon: ${roonStorageDiagnostic.detail}\n` +
      "Set the music library path below to tell the extension where to look."
    );
  }

  const lines = locations.map((entry) => {
    const origin = entry.sources.includes("roon")
      ? (entry.sources.includes("manual") ? "from Roon + manual" : "from Roon")
      : "manual";
    const state = entry.excluded ? "EXCLUDED" : "scanned";
    return `• ${entry.path}  [${state}, ${origin}]`;
  });

  lines.push("", `${active.length} of ${locations.length} location(s) will be scanned.`);
  if (!roonStorageLocations.length) {
    lines.push("", `Roon: ${roonStorageDiagnostic.detail}`);
  }
  return lines.join("\n");
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
        { title: "Refresh storage locations from Roon", value: "refresh_locations" },
      ],
      setting: "action",
    },
  ];
  if (action === "add" || action === "remove") {
    actionItems.push({ type: "string", title: "Artist", setting: "artist" });
    actionItems.push({ type: "string", title: "Album title", setting: "title" });
  }
  l.layout.push({ type: "group", title: "Actions", items: actionItems });

  // --- Storage locations (issue #15) ---
  const includedLocations = resolvedScanLocations.locations.filter((entry) => !entry.excluded);
  const excludedLocations = resolvedScanLocations.locations.filter((entry) => entry.excluded);

  const storageItems = [{ type: "label", title: renderScanLocations() }];

  if (includedLocations.length) {
    storageItems.push({
      type: "dropdown",
      title: "Exclude a location from scans",
      subtitle: "Pick a folder to stop scanning, then press Save.",
      values: [
        { title: "— none —", value: "" },
        ...includedLocations.map((entry) => ({ title: entry.path, value: entry.path })),
      ],
      setting: "exclude_location",
    });
  }

  if (excludedLocations.length) {
    storageItems.push({
      type: "dropdown",
      title: "Re-include an excluded location",
      subtitle: "Pick a folder to start scanning again, then press Save.",
      values: [
        { title: "— none —", value: "" },
        ...excludedLocations.map((entry) => ({ title: entry.path, value: entry.path })),
      ],
      setting: "include_location",
    });
  }

  storageItems.push({
    type: "string",
    title: "Music library path (override / fallback)",
    subtitle:
      "Used when Roon does not report a storage location, and always scanned in addition to the ones it does report. Separate several folders with a semicolon. Leave empty to rely on Roon alone.",
    setting: "music_library_path",
  });

  l.layout.push({ type: "group", title: "Music storage locations", items: storageItems });

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
    return summarizeCleanResult(await runLosslessClean());
  }
  if (action === "low_quality") {
    const result = await runLowQualityScan();
    return `Low-quality scan done: added ${result.added}, already on wishlist ${result.alreadyPresent}, ignored ${result.ignored}`;
  }
  if (action === "refresh_locations") {
    const resolved = await resolveActiveScanLocations();
    if (!resolved.locations.length) {
      return "No storage location reported by Roon. Set the music library path instead.";
    }
    return `Storage locations refreshed: ${resolved.active.length} of ${resolved.locations.length} will be scanned`;
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
      // Persist only durable config; action/artist/title and the location pickers are
      // transient and get cleared after the save completes.
      let excluded = mysettings.excluded_storage_locations || [];
      const toExclude = (settings.values.exclude_location || "").trim();
      const toInclude = (settings.values.include_location || "").trim();
      if (toExclude) excluded = scanLocations.toggleExclusion(excluded, toExclude, true);
      if (toInclude) excluded = scanLocations.toggleExclusion(excluded, toInclude, false);

      mysettings = Object.assign({}, mysettings, {
        music_library_path: settings.values.music_library_path || "",
        excluded_storage_locations: excluded,
      });
      roonApp.save_config("settings", mysettings);

      // Recompute from the cached Roon list so the layout pushed below already
      // reflects the exclusion the user just made.
      resolveActiveScanLocations({ refresh: false }).catch(() => {});

      // A library scan can take a while; show immediate feedback and run it without
      // blocking this callback. Errors are reported via status, not send_complete
      // (which has already been called above).
      if (action === "clean") svc_status.set_status("Scanning library for fully lossless albums...", false);
      if (action === "low_quality") svc_status.set_status("Scanning library for low-quality albums...", false);

      Promise.resolve()
        .then(() => performAction(settings.values))
        .then((statusMsg) => {
          // Push a refreshed layout with the updated wishlist and cleared transient fields.
          const cleared = Object.assign({}, mysettings, {
            action: "none",
            artist: "",
            title: "",
            exclude_location: "",
            include_location: "",
          });
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

roonApp.init_services({
  provided_services: [svc_settings, svc_status],
  optional_services: [RoonApiBrowse],
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

async function triggerReconciliation() {
  if (reconciliationInProgress) {
    return { status: "already_running" };
  }

  reconciliationInProgress = true;
  try {
    const browseService = getBrowseService();
    const result = await reconcileOnStartup({
      browseService,
      wishlist,
      searchAll,
      tagName: ROON_WISHLIST_TAG,
    });
    lastReconciliation = {
      timestamp: new Date().toISOString(),
      result,
    };
    console.log("Reconciliation completed:", result);
    return result;
  } finally {
    reconciliationInProgress = false;
  }
}

async function getStorageLocationsFromRoon() {
  const browseService = getBrowseService();
  if (!browseService) {
    roonStorageDiagnostic = {
      outcome: "not-paired",
      detail: "Not paired with Roon, so its storage locations cannot be read yet.",
    };
    return [];
  }

  const { locations, diagnostic } = await getStorageLocationsDetailed(browseService);
  roonStorageLocations = locations;
  roonStorageDiagnostic = diagnostic;
  return locations;
}

/**
 * Works out where the next scan will actually look: Roon's storage locations, minus
 * anything the user excluded, with the manual path as an override/fallback. Refreshing
 * from Roon is best-effort — if Roon is unreachable we still fall back to the last
 * known list and the typed path rather than failing the scan outright.
 */
async function resolveActiveScanLocations({ refresh = true } = {}) {
  if (refresh) {
    await getStorageLocationsFromRoon();
  }

  resolvedScanLocations = scanLocations.resolveScanLocations({
    roonLocations: roonStorageLocations,
    manualPath: mysettings.music_library_path,
    excluded: mysettings.excluded_storage_locations,
  });

  return resolvedScanLocations;
}

/**
 * Same as above, but additionally drops anything unreadable and refuses to continue if
 * that leaves nothing. Silently scanning zero folders would look like "you own no
 * albums", which for the clean action means wrongly keeping the whole wishlist.
 */
async function getScanRoots() {
  const resolved = await resolveActiveScanLocations();
  if (!resolved.active.length) {
    throw makeHttpError(
      400,
      resolved.locations.length
        ? "Every storage location is excluded. Re-enable one in Settings, or set a music library path."
        : "No music storage location is available. Roon did not report one — set a music library path in Settings.",
    );
  }

  const { usable, unreadable } = await scanLocations.validateLocations(resolved.active);
  if (!usable.length) {
    const detail = unreadable.map((entry) => `${entry.path} (${entry.reason})`).join(", ");
    throw makeHttpError(400, `No readable storage location: ${detail}`);
  }

  return { roots: usable, unreadable, resolved };
}

function describeScanScope(roots, unreadable) {
  const parts = [`${roots.length} location(s)`];
  if (unreadable && unreadable.length) parts.push(`${unreadable.length} unreadable`);
  return parts.join(", ");
}

function makeHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function runLibraryScanAction(task, { startStatus, successStatus, action }) {
  if (scanInProgress) {
    throw makeHttpError(409, "A library scan is already running");
  }

  const { roots, unreadable } = await getScanRoots();

  scanInProgress = true;
  scanActivity = task;
  svc_status.set_status(`${startStatus} (${describeScanScope(roots, unreadable)})`, false);
  try {
    const result = await action(roots);
    if (unreadable.length) result.unreadableLocations = unreadable;
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

/** Turns a clean result into a one-line summary that says what was kept and why. */
function summarizeCleanResult(result) {
  const keptByReason = new Map();
  for (const entry of result.kept) {
    keptByReason.set(entry.status, (keptByReason.get(entry.status) || 0) + 1);
  }

  const parts = [`removed ${result.removed.length} fully lossless album(s)`];
  const lossy = keptByReason.get("owned-lossy") || 0;
  const mixed = keptByReason.get("owned-mixed") || 0;
  const notFound = keptByReason.get("not-found") || 0;
  if (lossy) parts.push(`${lossy} kept (lossy only)`);
  if (mixed) parts.push(`${mixed} kept (only partly lossless)`);
  if (notFound) parts.push(`${notFound} not in library`);

  return `Refresh & clean done: ${parts.join(", ")}`;
}

async function runLosslessClean() {
  return runLibraryScanAction("clean", {
    startStatus: "Scanning library for fully lossless albums...",
    successStatus: summarizeCleanResult,
    action(roots) {
      return lossless.checkAndClean(roots, wishlist);
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
    action(roots) {
      return lossless.scanLowQualityAlbums(roots, wishlist, lowQualityIgnore);
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
    // GET /storage-locations was previously missing here, so it fell through to the
    // static file handler and always answered 404.
    "/storage-locations",
    "/storage-locations/exclude",
    "/reconcile",
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
      
      // Second: remove albums that exist as a complete lossless copy
      const cleanResult = await runLosslessClean();

      // Third: scan for new low-quality albums. The clean step already proved at least
      // one storage location is readable, so this no longer depends on a typed path.
      let lowQualityResult = null;
      try {
        lowQualityResult = await runLowQualityScan();
      } catch (e) {
        if (e.statusCode !== 400) throw e;
      }

      res.end(JSON.stringify({
        clearedLowQuality,
        removedFromWishlist: cleanResult.removed,
        keptOnWishlist: cleanResult.kept,
        scanLocations: cleanResult.locations,
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
      reconciliationInProgress,
      scanInProgress,
      scanActivity,
      lastReconciliation,
      lastLowQualityScan,
      libraryPath: mysettings.music_library_path || "",
      storageLocations: roonStorageLocations,
      storageDiagnostic: roonStorageDiagnostic,
      scanLocations: resolvedScanLocations.locations,
      activeScanLocations: resolvedScanLocations.active,
      excludedScanLocations: resolvedScanLocations.excluded,
      count: wishlist.getAll().length,
      version: "0.1.0",
      extensionId: EXTENSION_ID,
      displayName: DISPLAY_NAME,
    }));
    return;
  }

  // Trigger reconciliation manually
  if (req.method === "POST" && url.pathname === "/reconcile") {
    if (reconciliationInProgress) {
      res.statusCode = 409;
      res.end(JSON.stringify({ error: "Reconciliation already in progress" }));
      return;
    }
    triggerReconciliation()
      .then((result) => {
        res.statusCode = 200;
        res.end(JSON.stringify({ success: true, result }));
      })
      .catch((err) => {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: err.message }));
      });
    return;
  }

  // Get storage locations from Roon, together with how they resolve into scan roots.
  if (req.method === "GET" && url.pathname === "/storage-locations") {
    resolveActiveScanLocations()
      .then((resolved) => scanLocations
        .validateLocations(resolved.active)
        .then(({ unreadable }) => {
          res.end(JSON.stringify({
            locations: roonStorageLocations,
            diagnostic: roonStorageDiagnostic,
            resolved: resolved.locations,
            active: resolved.active,
            excluded: resolved.excluded,
            usedFallback: resolved.usedFallback,
            unreadable,
          }, null, 2));
        }))
      .catch((err) => {
        res.statusCode = 502;
        res.end(JSON.stringify({ error: err.message }));
      });
    return;
  }

  // Exclude or re-include a storage location from the web UI.
  if (req.method === "POST" && url.pathname === "/storage-locations/exclude") {
    readJsonBody(req, res, (data) => {
      const target = typeof data.path === "string" ? data.path.trim() : "";
      if (!target) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: "A 'path' is required." }));
        return;
      }
      const shouldExclude = data.excluded !== false;
      mysettings = Object.assign({}, mysettings, {
        excluded_storage_locations: scanLocations.toggleExclusion(
          mysettings.excluded_storage_locations,
          target,
          shouldExclude,
        ),
      });
      roonApp.save_config("settings", mysettings);

      resolveActiveScanLocations({ refresh: false })
        .then((resolved) => {
          try { svc_settings.update_settings(make_layout(mysettings)); } catch {}
          res.end(JSON.stringify({
            excluded: mysettings.excluded_storage_locations,
            active: resolved.active,
            resolved: resolved.locations,
          }, null, 2));
        })
        .catch((err) => {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: err.message }));
        });
    });
    return;
  }

  // Read the durable settings.
  if (req.method === "GET" && url.pathname === "/settings") {
    res.end(JSON.stringify({
      music_library_path: mysettings.music_library_path || "",
      excluded_storage_locations: mysettings.excluded_storage_locations || [],
    }));
    return;
  }

  // Update the music library path from the web UI and persist it (same store the
  // Roon settings screen uses), then push a refreshed layout if that screen is open.
  if (req.method === "POST" && url.pathname === "/settings") {
    readJsonBody(req, res, (data) => {
      const p = typeof data.music_library_path === "string" ? data.music_library_path.trim() : "";
      mysettings = Object.assign({}, mysettings, { music_library_path: p });
      roonApp.save_config("settings", mysettings);
      resolveActiveScanLocations({ refresh: false }).catch(() => {});
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
  // Seed the location view from saved settings so the settings screen is populated
  // before Roon pairs. Refreshing from Roon happens on pairing.
  resolveActiveScanLocations({ refresh: false }).catch(() => {});
});
