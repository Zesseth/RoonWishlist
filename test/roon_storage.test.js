"use strict";

const assert = require("node:assert");
const { describe, it } = require("node:test");

const { getStorageLocationsDetailed } = require("../src/roon_storage");

/**
 * A minimal stand-in for node-roon-api-browse. `levels` maps an item_key (or the
 * literal "root") to the items that level should return, so a test can describe a
 * Roon settings tree without a Roon core.
 */
function fakeBrowse(levels, { browseError, loadError } = {}) {
  let currentLevel = null;

  return {
    browse(opts, cb) {
      if (browseError) return cb(browseError);
      currentLevel = opts.item_key || "root";
      if (!levels[currentLevel]) return cb(null, { action: "message", message: "Nothing here" });
      cb(null, { action: "list", list: { level: 0, count: levels[currentLevel].length } });
    },
    load(opts, cb) {
      if (loadError) return cb(loadError);
      const items = levels[currentLevel] || [];
      cb(null, { items, list: { count: items.length } });
    },
  };
}

describe("getStorageLocationsDetailed()", () => {
  it("reports not-paired when there is no browse service", async () => {
    const { locations, diagnostic } = await getStorageLocationsDetailed(null);
    assert.deepStrictEqual(locations, []);
    assert.strictEqual(diagnostic.outcome, "no-browse");
  });

  it("reads storage entries and reports how many it found", async () => {
    const browse = fakeBrowse({
      root: [{ item_key: "s1", title: "Storage" }],
      s1: [
        { item_key: "l1", title: "Main library", subtitle: "/music" },
        { item_key: "l2", title: "Archive", subtitle: "/mnt/archive" },
      ],
    });

    const { locations, diagnostic } = await getStorageLocationsDetailed(browse);
    assert.deepStrictEqual(locations.map((l) => l.path), ["/music", "/mnt/archive"]);
    assert.strictEqual(diagnostic.outcome, "ok");
    assert.match(diagnostic.detail, /2 storage entries/);
  });

  it("falls back to the title when Roon puts the path there instead of the subtitle", async () => {
    const browse = fakeBrowse({
      root: [{ item_key: "s1", title: "Library" }],
      s1: [{ item_key: "l1", title: "/music" }],
    });

    const { locations } = await getStorageLocationsDetailed(browse);
    assert.deepStrictEqual(locations.map((l) => l.path), ["/music"]);
  });

  it("skips header rows, which are labels rather than storage entries", async () => {
    const browse = fakeBrowse({
      root: [{ item_key: "s1", title: "Storage" }],
      s1: [
        { item_key: "h", title: "Folders", hint: "header" },
        { item_key: "l1", title: "Main", subtitle: "/music" },
      ],
    });

    const { locations } = await getStorageLocationsDetailed(browse);
    assert.strictEqual(locations.length, 1);
  });

  it("distinguishes 'Roon does not expose storage' from a failure", async () => {
    const browse = fakeBrowse({
      root: [
        { item_key: "a", title: "Audio" },
        { item_key: "b", title: "Setup" },
      ],
    });

    const { locations, diagnostic } = await getStorageLocationsDetailed(browse);
    assert.deepStrictEqual(locations, []);
    assert.strictEqual(diagnostic.outcome, "not-exposed");
    // The entries Roon *did* offer are reported, so the cause is diagnosable
    // without access to the service log.
    assert.deepStrictEqual(diagnostic.settingsEntries, ["Audio", "Setup"]);
  });

  it("distinguishes an exposed but empty storage list from one that was never found", async () => {
    const browse = fakeBrowse({
      root: [{ item_key: "s1", title: "Storage" }],
      s1: [],
    });

    const { locations, diagnostic } = await getStorageLocationsDetailed(browse);
    assert.deepStrictEqual(locations, []);
    assert.strictEqual(diagnostic.outcome, "empty");
  });

  it("reports a browse failure instead of silently looking like an empty library", async () => {
    const browse = fakeBrowse({}, { browseError: "connection lost" });

    const { locations, diagnostic } = await getStorageLocationsDetailed(browse);
    assert.deepStrictEqual(locations, []);
    assert.strictEqual(diagnostic.outcome, "error");
    assert.match(diagnostic.detail, /connection lost/);
  });

  it("never throws, because the caller must still be able to fall back", async () => {
    const browse = fakeBrowse({ root: [{ item_key: "s1", title: "Storage" }] }, { loadError: "boom" });
    const { locations, diagnostic } = await getStorageLocationsDetailed(browse);
    assert.deepStrictEqual(locations, []);
    assert.strictEqual(diagnostic.outcome, "error");
  });
});
