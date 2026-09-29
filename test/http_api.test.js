"use strict";

/**
 * Integration tests for the HTTP API (issue #39 scope: the storage-location
 * endpoints), against the real server process.
 *
 * The app is started once with a temporary working directory (node-roon-api
 * keeps its config.json in the cwd), a temporary data dir (wishlist + log file)
 * and a dedicated port, so the tests never touch the real install, its data, or
 * the running service. No Roon core is required: the HTTP server starts
 * independently of pairing, and nothing here depends on browse access.
 */

const assert = require("node:assert");
const { after, before, describe, it } = require("node:test");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const REPO_ROOT = path.join(__dirname, "..");
const HTTP_PORT = Number(process.env.ROON_WISHLIST_TEST_PORT || 3991);
const BASE = `http://127.0.0.1:${HTTP_PORT}`;
const STARTUP_TIMEOUT_MS = 20000;

let child = null;
let workDir = "";

function startServer() {
  const env = {
    ...process.env,
    ROON_WISHLIST_HTTP_PORT: String(HTTP_PORT),
    ROON_WISHLIST_HTTP_HOST: "127.0.0.1",
    ROON_WISHLIST_DATA_DIR: path.join(workDir, "data"),
    // Distinct identity so the test instance can never collide with a real
    // install's pairing or config.
    ROON_WISHLIST_EXTENSION_ID: "com.zesseth.roon-wishlist-http-test",
    ROON_WISHLIST_DISPLAY_NAME: "Wishlist HTTP test",
  };
  child = spawn(process.execPath, [path.join(REPO_ROOT, "index.js")], {
    cwd: workDir,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function waitForServer() {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  for (;;) {
    try {
      const resp = await fetch(`${BASE}/status`);
      if (resp.ok) return;
    } catch {
      // Not up yet.
    }
    if (Date.now() > deadline) {
      throw new Error(`Test server did not start within ${STARTUP_TIMEOUT_MS} ms.`);
    }
    if (child && child.exitCode !== null) {
      throw new Error(`Test server exited early with code ${child.exitCode}.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

async function api(method, pathname, body) {
  const resp = await fetch(`${BASE}${pathname}`, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await resp.json();
  return { status: resp.status, data };
}

async function resolvedPaths() {
  const { data } = await api("GET", "/storage-locations");
  return (data.resolved || []).map((entry) => entry.path);
}

before(async () => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "roon-wishlist-http-test-"));
  startServer();
  await waitForServer();
});

after(async () => {
  if (child) {
    child.kill("SIGTERM");
    await new Promise((resolve) => {
      if (child.exitCode !== null) return resolve();
      child.on("exit", resolve);
      setTimeout(resolve, 3000);
    });
    child = null;
  }
  if (workDir) {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

describe("HTTP API: storage locations", () => {
  it("adds a folder without replacing anything", async () => {
    const first = await api("POST", "/storage-locations/add", { path: "/music-test" });
    assert.strictEqual(first.status, 200);
    assert.strictEqual(first.data.added, 1);

    const second = await api("POST", "/storage-locations/add", { path: "/second-test" });
    assert.strictEqual(second.status, 200);
    assert.strictEqual(second.data.added, 1);

    const paths = await resolvedPaths();
    assert.ok(paths.includes("/music-test"));
    assert.ok(paths.includes("/second-test"));
  });

  it("reports zero added for a folder that is already configured", async () => {
    const { status, data } = await api("POST", "/storage-locations/add", { path: "/music-test" });
    assert.strictEqual(status, 200);
    assert.strictEqual(data.added, 0);
  });

  it("adds a semicolon-separated paste as several folders", async () => {
    const { status, data } = await api("POST", "/storage-locations/add", { path: "/bulk-a; /bulk-b" });
    assert.strictEqual(status, 200);
    assert.strictEqual(data.added, 2);

    const paths = await resolvedPaths();
    assert.ok(paths.includes("/bulk-a"));
    assert.ok(paths.includes("/bulk-b"));
  });

  it("rejects an empty path", async () => {
    const { status } = await api("POST", "/storage-locations/add", { path: "" });
    assert.strictEqual(status, 400);
  });

  it("does not split a comma inside a folder name", async () => {
    const target = "/music/Crosby, Stills & Nash";
    const { status, data } = await api("POST", "/storage-locations/add", { path: target });
    assert.strictEqual(status, 200);
    assert.strictEqual(data.added, 1);

    const paths = await resolvedPaths();
    assert.ok(paths.includes(target));
  });

  it("removes one folder at a time and keeps the rest", async () => {
    const { status } = await api("POST", "/storage-locations/remove", { path: "/bulk-b" });
    assert.strictEqual(status, 200);

    const paths = await resolvedPaths();
    assert.ok(!paths.includes("/bulk-b"));
    assert.ok(paths.includes("/bulk-a"));
    assert.ok(paths.includes("/music-test"));
  });

  it("keeps POST /settings as the replace-all escape hatch", async () => {
    // The native Roon settings field and anything automating /settings still
    // sets the whole list in one value (issue #39: keep backward compatibility).
    const { status } = await api("POST", "/settings", { music_library_path: "/only-test" });
    assert.strictEqual(status, 200);

    const paths = await resolvedPaths();
    assert.deepStrictEqual(paths, ["/only-test"]);
  });
});

/**
 * Issue #47, live-server coverage: low-quality Ignore is a persistent decision
 * (manual scans must respect it), and the Danger Zone clear & rebuild is the
 * only operation that resets it. Everything below runs against the real server
 * process with a real (tiny) music library, so the persistence and reset claims
 * cover the actual HTTP surface the web UI uses.
 */
describe("HTTP API: low-quality ignore and Danger Zone reset", () => {
  const libraryDir = path.join(workDir, "library");
  const artist = "Low Qual Band";
  const album = "Bits And Pieces";

  before(async () => {
    // A real, readable music library with one low-quality album: the scan needs
    // a genuine location, unlike the fake paths the storage-location tests use.
    const albumDir = path.join(libraryDir, artist, album);
    fs.mkdirSync(albumDir, { recursive: true });
    fs.writeFileSync(path.join(albumDir, "01.mp3"), "");
    fs.writeFileSync(path.join(albumDir, "02.mp3"), "");

    const { status } = await api("POST", "/storage-locations/add", { path: libraryDir });
    assert.strictEqual(status, 200);
  });

  it("finds the low-quality album with a manual scan", async () => {
    const { status, data } = await api("POST", "/scan-low-quality");
    assert.strictEqual(status, 200);
    assert.strictEqual(data.added, 1);

    const list = await api("GET", "/wishlist/low-quality");
    const found = list.data.filter(
      (item) => item.artist === artist && item.title === album,
    );
    assert.strictEqual(found.length, 1);
  });

  it("Ignore hides the album immediately and persists to the ignore file", async () => {
    const { status, data } = await api("POST", "/ignore-low-quality", { artist, title: album });
    assert.strictEqual(status, 200);
    assert.strictEqual(data.ignored, true);
    assert.strictEqual(data.removedFromWishlist, true);

    const list = await api("GET", "/wishlist/low-quality");
    assert.strictEqual(list.data.length, 0);

    const ignoreFile = path.join(workDir, "data", "ignored-low-quality.json");
    const raw = JSON.parse(fs.readFileSync(ignoreFile, "utf8"));
    assert.strictEqual(raw.length, 1);
    assert.strictEqual(raw[0].artist, artist);
    assert.strictEqual(raw[0].title, album);
  });

  it("a manual scan respects the ignore list and does not clear it", async () => {
    const { status, data } = await api("POST", "/scan-low-quality");
    assert.strictEqual(status, 200);
    assert.strictEqual(data.added, 0);
    assert.strictEqual(data.ignored, 1);

    const ignoreFile = path.join(workDir, "data", "ignored-low-quality.json");
    const raw = JSON.parse(fs.readFileSync(ignoreFile, "utf8"));
    assert.strictEqual(raw.length, 1);

    const list = await api("GET", "/wishlist/low-quality");
    assert.strictEqual(list.data.length, 0);
  });

  it("Danger Zone clear & rebuild resets the ignore list and re-adds the album", async () => {
    const { status, data } = await api("POST", "/check-lossless");
    assert.strictEqual(status, 200);

    // The reset must be reported so the UI can say what was reversed.
    assert.strictEqual(data.ignoredCleared.length, 1);
    assert.strictEqual(data.ignoredCleared[0].artist, artist);
    assert.strictEqual(data.ignoredCleared[0].title, album);

    // Nothing was left to clear from the wishlist (Ignore had already removed the
    // album), but the rescan re-added it because the ignore decision was reset.
    assert.strictEqual(data.clearedLowQuality.length, 0);
    assert.strictEqual(data.lowQualityScan.added, 1);

    const ignoreFile = path.join(workDir, "data", "ignored-low-quality.json");
    const raw = JSON.parse(fs.readFileSync(ignoreFile, "utf8"));
    assert.deepStrictEqual(raw, []);

    const list = await api("GET", "/wishlist/low-quality");
    assert.strictEqual(list.data.length, 1);
    assert.strictEqual(list.data[0].artist, artist);
  });

  it("the next manual scan does not re-ignore the album after the reset", async () => {
    const { status, data } = await api("POST", "/scan-low-quality");
    assert.strictEqual(status, 200);
    assert.strictEqual(data.added, 0);
    assert.strictEqual(data.alreadyPresent, 1);
    assert.strictEqual(data.ignored, 0);
  });

  it("Ignore does not remove a tag-sourced album from the wishlist", async () => {
    // Roon is the master for tagged albums (issue #47): Ignore must not remove
    // or modify a Roon Wishlist tag, so a tag-sourced entry stays on the
    // wishlist. Seeded straight into wishlist.json (the app reads it through an
    // mtime-keyed cache, so an external write is picked up) because no HTTP
    // endpoint can create a roon-tag entry without a paired core. The brief wait
    // first guarantees the write lands in a later millisecond than the server's
    // last save, so the cache cannot miss it on mtime resolution.
    const wishlistFile = path.join(workDir, "data", "wishlist.json");
    await new Promise((resolve) => setTimeout(resolve, 10));
    const current = JSON.parse(fs.readFileSync(wishlistFile, "utf8"));
    current.push({
      artist: "Tagged Band",
      title: "Tagged Album",
      source: "roon-tag",
      buyLinks: [],
      addedAt: new Date().toISOString(),
    });
    fs.writeFileSync(wishlistFile, JSON.stringify(current, null, 2));

    const { status, data } = await api("POST", "/ignore-low-quality", {
      artist: "Tagged Band",
      title: "Tagged Album",
    });
    assert.strictEqual(status, 200);
    // The ignore decision itself is recorded…
    assert.strictEqual(data.ignored, true);
    // …but the tag-sourced entry stays on the wishlist.
    assert.strictEqual(data.removedFromWishlist, false);

    const roonTag = await api("GET", "/wishlist/roon-tag");
    assert.strictEqual(
      roonTag.data.filter((item) => item.artist === "Tagged Band" && item.title === "Tagged Album").length,
      1,
    );
  });
});
