"use strict";

/**
 * Unit tests for the persistent low-quality ignore list (issue #47).
 *
 * The ignore list must survive a restart (it is a plain JSON file next to
 * wishlist.json) and the Danger Zone rebuild must be able to reset it — that
 * reset is the only operation allowed to reverse an Ignore decision.
 *
 * A "restart" is simulated by dropping the module from the require cache and
 * requiring it again: the module keeps an mtime-keyed cache in module scope,
 * so a fresh require is exactly what a new process starts with.
 */

const assert = require("node:assert");
const { after, before, describe, it } = require("node:test");

const fs = require("fs");
const os = require("os");
const path = require("path");

const MODULE_PATH = path.join(__dirname, "..", "src", "ignored_low_quality.js");

let dataDir = "";
let ignoreFile = "";

function freshModule() {
  delete require.cache[require.resolve(MODULE_PATH)];
  // The data dir is resolved once at module load, so the env var must be in
  // place before the require — same as the real process.
  process.env.ROON_WISHLIST_DATA_DIR = dataDir;
  return require(MODULE_PATH);
}

before(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "roon-wishlist-ignore-test-"));
  ignoreFile = path.join(dataDir, "ignored-low-quality.json");
});

after(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe("ignored low-quality list", () => {
  it("starts empty and persists an add to the data file", async () => {
    const ignore = freshModule();
    assert.deepStrictEqual(ignore.getAll(), []);

    const added = await ignore.add({ artist: "Nachtmystium", title: "Silencing Machine" });
    assert.strictEqual(added, true);
    assert.strictEqual(ignore.has("Nachtmystium", "Silencing Machine"), true);
    assert.strictEqual(ignore.has("nachtmystium", "  silencing machine "), true);

    const raw = JSON.parse(fs.readFileSync(ignoreFile, "utf8"));
    assert.strictEqual(raw.length, 1);
    assert.strictEqual(raw[0].artist, "Nachtmystium");
    assert.strictEqual(raw[0].title, "Silencing Machine");
  });

  it("is still there after a restart (fresh module, same data dir)", async () => {
    const ignore = freshModule();
    assert.strictEqual(ignore.has("Nachtmystium", "Silencing Machine"), true);
    assert.strictEqual(ignore.getAll().length, 1);
  });

  it("rejects a duplicate add and an entry without artist or title", async () => {
    const ignore = freshModule();
    assert.strictEqual(await ignore.add({ artist: "Nachtmystium", title: "Silencing Machine" }), false);
    assert.strictEqual(await ignore.add({ artist: "", title: "No Artist" }), false);
    assert.strictEqual(ignore.getAll().length, 1);
  });

  it("clear() resets the list, reports what was removed, and the reset persists", async () => {
    const ignore = freshModule();
    await ignore.add({ artist: "Aeon", title: "Aeons Black" });

    const cleared = await ignore.clear();
    assert.strictEqual(cleared.length, 2);
    assert.deepStrictEqual(
      cleared.map((entry) => entry.title).sort(),
      ["Aeons Black", "Silencing Machine"],
    );
    assert.deepStrictEqual(ignore.getAll(), []);
    assert.strictEqual(ignore.has("Nachtmystium", "Silencing Machine"), false);

    // The reset must hit the file, not just the in-memory cache: a restart
    // must not bring the entries back.
    const afterRestart = freshModule();
    assert.deepStrictEqual(afterRestart.getAll(), []);

    const raw = JSON.parse(fs.readFileSync(ignoreFile, "utf8"));
    assert.deepStrictEqual(raw, []);
  });

  it("clear() on an empty list is a no-op that reports nothing removed", async () => {
    const ignore = freshModule();
    assert.deepStrictEqual(await ignore.clear(), []);
  });
});
