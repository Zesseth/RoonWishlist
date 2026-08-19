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
    // How much was looked at is reported, so the cause is diagnosable without
    // access to the service log — but never *what* it was called.
    assert.strictEqual(diagnostic.settingsEntryCount, 2);
    assert.strictEqual(diagnostic.settingsEntries, undefined);
    assert.doesNotMatch(diagnostic.detail, /Audio|Setup/);
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

describe("getStorageLocationsDetailed() — searching one level down", () => {
  function fakeBrowse(levels) {
    let currentLevel = null;
    return {
      browse(opts, cb) {
        currentLevel = opts.item_key || "root";
        if (!levels[currentLevel]) return cb(null, { action: "message", message: "Nothing here" });
        cb(null, { action: "list", list: { level: 0, count: levels[currentLevel].length } });
      },
      load(opts, cb) {
        const items = levels[currentLevel] || [];
        cb(null, { items, list: { count: items.length } });
      },
    };
  }

  it("finds storage nested under another settings entry", async () => {
    const browse = fakeBrowse({
      root: [{ item_key: "gen", title: "General" }],
      gen: [{ item_key: "st", title: "Storage" }],
      st: [{ item_key: "l1", title: "Main library", subtitle: "/music" }],
    });

    const { locations, diagnostic } = await getStorageLocationsDetailed(browse);
    assert.strictEqual(diagnostic.outcome, "ok");
    assert.strictEqual(locations.length, 1);
    assert.strictEqual(locations[0].path, "/music");
  });

  it("says exactly what Roon offered when storage is nowhere to be found", async () => {
    const browse = fakeBrowse({
      root: [{ item_key: "p", title: "Profile" }, { item_key: "d", title: "Display Settings" }],
      p: [{ item_key: "p1", title: "Jesse" }],
      d: [{ item_key: "d1", title: "Theme" }],
    });

    const { locations, diagnostic } = await getStorageLocationsDetailed(browse);
    assert.deepStrictEqual(locations, []);
    assert.strictEqual(diagnostic.outcome, "not-exposed");
    // The user must be able to read the evidence, but the evidence must not name
    // them: Roon's settings titles include the profile name, so the diagnostic
    // counts what it saw instead of quoting it.
    assert.strictEqual(diagnostic.settingsEntryCount, 2);
    assert.strictEqual(diagnostic.nestedEntryCount, 2);
    assert.doesNotMatch(diagnostic.detail, /Jesse|Profile|Theme|Display Settings/);
    assert.strictEqual(diagnostic.settingsTree, undefined);
  });

  it("records an entry it could not open instead of failing the whole lookup", async () => {
    const browse = fakeBrowse({
      root: [{ item_key: "p", title: "Profile" }],
      // "p" has no level defined, so opening it answers with a message.
    });

    const { diagnostic } = await getStorageLocationsDetailed(browse);
    assert.strictEqual(diagnostic.outcome, "not-exposed");
    // The lookup survives an entry it cannot open, and still says nothing about
    // what that entry was called.
    assert.strictEqual(diagnostic.settingsEntryCount, 1);
    assert.doesNotMatch(diagnostic.detail, /Profile/);
  });
});
