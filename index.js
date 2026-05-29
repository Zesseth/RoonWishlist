"use strict";

const RoonApi = require("node-roon-api");
const RoonApiSettings = require("node-roon-api-settings");
const RoonApiStatus = require("node-roon-api-status");
const wishlist = require("./src/wishlist");
const { searchAll } = require("./src/search");

let roon, mysettings, svc_status;

const roonApp = new RoonApi({
  extension_id: "com.zesseth.roon-wishlist",
  display_name: "Wishlist",
  display_version: "0.1.0",
  publisher: "Zesseth",
  email: "",
  website: "https://github.com/Zesseth/RoonWishlist",

  core_paired(core) {
    console.log("Paired with Roon core:", core.display_name);
    svc_status.set_status("Paired", false);
  },

  core_unpaired(core) {
    console.log("Unpaired from Roon core:", core.display_name);
    svc_status.set_status("Not paired", false);
  },
});

mysettings = roonApp.load_config("settings") || {
  music_library_path: "",
};

function make_layout(settings) {
  const l = {
    values: settings,
    layout: [],
    has_error: false,
  };

  l.layout.push({
    type: "string",
    title: "Music library path (lossless detection)",
    subtitle: "Local path where lossless files are stored. Used to auto-remove albums from wishlist.",
    setting: "music_library_path",
  });

  return l;
}

const svc_settings = new RoonApiSettings(roonApp, {
  get_settings(cb) {
    cb(make_layout(mysettings));
  },
  save_settings(req, isdryrun, settings) {
    const l = make_layout(settings.values);
    req.send_complete(l.has_error ? "NotValid" : "Success", { settings: l });
    if (!isdryrun && !l.has_error) {
      mysettings = l.values;
      roonApp.save_config("settings", mysettings);
      svc_status.set_status("Settings saved", false);
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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost`);
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
    const { checkAndClean } = require("./src/lossless_checker");
    const libraryPath = mysettings.music_library_path;
    if (!libraryPath) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: "music_library_path not configured in Roon settings" }));
      return;
    }
    const removed = checkAndClean(libraryPath, wishlist);
    res.end(JSON.stringify({ removedFromWishlist: removed }));
    return;
  }

  res.statusCode = 404;
  res.end(JSON.stringify({ error: "Not found" }));
});

server.listen(3141, "127.0.0.1", () => {
  console.log("Wishlist HTTP API listening on http://127.0.0.1:3141");
  svc_status.set_status("Running — API on port 3141", false);
});
