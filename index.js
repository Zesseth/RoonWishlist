"use strict";

const RoonApi = require("node-roon-api");
const RoonApiSettings = require("node-roon-api-settings");
const RoonApiStatus = require("node-roon-api-status");
const wishlist = require("./src/wishlist");
const { searchAll } = require("./src/search");
const lossless = require("./src/lossless_checker");

let roon, mysettings, svc_status;
let pairedCore = null;

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
    title: "Music library path (lossless detection)",
    subtitle: "Local path where lossless files are stored. Used to auto-remove albums from the wishlist.",
    setting: "music_library_path",
  });

  return l;
}

function performAction(values) {
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
    if (!mysettings.music_library_path) return "Set the music library path first";
    const removed = lossless.checkAndClean(mysettings.music_library_path, wishlist);
    return `Refresh & clean done: removed ${removed.length} album(s) found locally`;
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

      let statusMsg;
      try {
        statusMsg = performAction(settings.values);
      } catch (e) {
        statusMsg = "Action failed: " + e.message;
      }

      // Push a refreshed layout with the updated wishlist and cleared transient fields.
      const cleared = Object.assign({}, mysettings, { action: "none", artist: "", title: "" });
      svc_settings.update_settings(make_layout(cleared));
      svc_status.set_status(statusMsg, false);
    }
  },
});

svc_status = new RoonApiStatus(roonApp);

roonApp.init_services({
  provided_services: [svc_settings, svc_status],
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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost`);

  // Serve the web UI (GET, non-API paths) before defaulting to JSON responses.
  const apiPaths = ["/wishlist", "/wishlist/add", "/wishlist/remove", "/search", "/check-lossless", "/settings", "/status"];
  if (req.method === "GET" && !apiPaths.includes(url.pathname)) {
    serveStatic(res, url.pathname);
    return;
  }

  res.setHeader("Content-Type", "application/json");

  if (req.method === "GET" && url.pathname === "/wishlist") {
    res.end(JSON.stringify(wishlist.getAll(), null, 2));
    return;
  }

  if (req.method === "POST" && url.pathname === "/wishlist/add") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const album = JSON.parse(body);
        const added = wishlist.add(album);
        res.end(JSON.stringify({ added }));
      } catch {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: "Invalid JSON" }));
      }
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/wishlist/remove") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const album = JSON.parse(body);
        const removed = wishlist.remove(album);
        res.end(JSON.stringify({ removed }));
      } catch {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: "Invalid JSON" }));
      }
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

  // Auto-check: remove from wishlist if lossless found in library
  if (req.method === "POST" && url.pathname === "/check-lossless") {
    const libraryPath = mysettings.music_library_path;
    if (!libraryPath) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: "Music library path is not set. Set it in the Library section first." }));
      return;
    }
    const removed = lossless.checkAndClean(libraryPath, wishlist);
    res.end(JSON.stringify({ removedFromWishlist: removed }));
    return;
  }

  // Connection + summary status for the web UI header.
  if (req.method === "GET" && url.pathname === "/status") {
    res.end(JSON.stringify({
      paired: !!pairedCore,
      core: pairedCore ? pairedCore.display_name : null,
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
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const data = JSON.parse(body);
        const p = typeof data.music_library_path === "string" ? data.music_library_path.trim() : "";
        mysettings = Object.assign({}, mysettings, { music_library_path: p });
        roonApp.save_config("settings", mysettings);
        const cleared = Object.assign({}, mysettings, { action: "none", artist: "", title: "" });
        try { svc_settings.update_settings(make_layout(cleared)); } catch {}
        res.end(JSON.stringify({ music_library_path: mysettings.music_library_path }));
      } catch {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: "Invalid JSON" }));
      }
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
