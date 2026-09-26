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
