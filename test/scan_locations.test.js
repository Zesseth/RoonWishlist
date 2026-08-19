"use strict";

const assert = require("node:assert");
const { describe, it, before, after } = require("node:test");

const fs = require("fs");
const os = require("os");
const path = require("path");

const scanLocations = require("../src/scan_locations");

let root;

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "roon-wishlist-locations-"));
  fs.mkdirSync(path.join(root, "music"), { recursive: true });
  fs.writeFileSync(path.join(root, "not-a-directory"), "");
});

after(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("looksLikeFilesystemPath()", () => {
  it("accepts POSIX absolute paths", () => {
    assert.strictEqual(scanLocations.looksLikeFilesystemPath("/mnt/music"), true);
  });

  it("accepts Windows drive paths and UNC shares", () => {
    assert.strictEqual(scanLocations.looksLikeFilesystemPath("D:\\Music"), true);
    assert.strictEqual(scanLocations.looksLikeFilesystemPath("\\\\nas\\music"), true);
  });

  it("rejects display-only labels Roon may return", () => {
    // Roon renders some storage entries purely as names, with no usable path.
    assert.strictEqual(scanLocations.looksLikeFilesystemPath("My NAS (SMB)"), false);
    assert.strictEqual(scanLocations.looksLikeFilesystemPath(""), false);
    assert.strictEqual(scanLocations.looksLikeFilesystemPath(null), false);
  });
});

describe("extractRoonPaths()", () => {
  it("reads the path from the subtitle when Roon puts it there", () => {
    const result = scanLocations.extractRoonPaths([{ title: "Main", subtitle: "/mnt/music" }]);
    assert.deepStrictEqual(result, [{ path: "/mnt/music", title: "Main" }]);
  });

  it("falls back to the title when that is the path", () => {
    const result = scanLocations.extractRoonPaths([{ title: "/mnt/music" }]);
    assert.strictEqual(result[0].path, "/mnt/music");
  });

  it("skips entries with no usable path", () => {
    const result = scanLocations.extractRoonPaths([
      { title: "My NAS (SMB)" },
      { title: "Main", subtitle: "/mnt/music" },
    ]);
    assert.strictEqual(result.length, 1);
  });

  it("returns an empty list for junk input", () => {
    assert.deepStrictEqual(scanLocations.extractRoonPaths(null), []);
    assert.deepStrictEqual(scanLocations.extractRoonPaths([null, undefined]), []);
  });
});

describe("splitManualPaths()", () => {
  it("returns an empty list for blank input", () => {
    assert.deepStrictEqual(scanLocations.splitManualPaths(""), []);
    assert.deepStrictEqual(scanLocations.splitManualPaths(undefined), []);
  });

  it("returns a single path unchanged", () => {
    assert.deepStrictEqual(scanLocations.splitManualPaths("/mnt/music"), ["/mnt/music"]);
  });

  it("splits on semicolons and newlines and trims each entry", () => {
    assert.deepStrictEqual(
      scanLocations.splitManualPaths(" /mnt/a ; /mnt/b \n/mnt/c "),
      ["/mnt/a", "/mnt/b", "/mnt/c"]
    );
  });

  it("keeps commas, because a directory name may legally contain one", () => {
    assert.deepStrictEqual(
      scanLocations.splitManualPaths("/music/Crosby, Stills & Nash"),
      ["/music/Crosby, Stills & Nash"]
    );
  });

  it("drops empty segments from stray separators", () => {
    assert.deepStrictEqual(scanLocations.splitManualPaths(";;/mnt/a;;"), ["/mnt/a"]);
  });
});

describe("resolveScanLocations()", () => {
  it("uses the Roon locations when available", () => {
    const result = scanLocations.resolveScanLocations({
      roonLocations: [{ title: "Main", subtitle: "/mnt/music" }],
    });
    assert.deepStrictEqual(result.active, ["/mnt/music"]);
    assert.strictEqual(result.usedFallback, false);
  });

  it("falls back to the manual path when Roon reports nothing usable", () => {
    const result = scanLocations.resolveScanLocations({
      roonLocations: [{ title: "My NAS (SMB)" }],
      manualPath: "/mnt/manual",
    });
    assert.deepStrictEqual(result.active, ["/mnt/manual"]);
    assert.strictEqual(result.usedFallback, true);
  });

  it("scans the manual path in addition to the Roon ones", () => {
    const result = scanLocations.resolveScanLocations({
      roonLocations: [{ title: "Main", subtitle: "/mnt/music" }],
      manualPath: "/mnt/extra",
    });
    assert.deepStrictEqual(result.active, ["/mnt/music", "/mnt/extra"]);
  });

  it("resolves several manual paths so multi-location works without Roon", () => {
    const result = scanLocations.resolveScanLocations({
      manualPath: "/mnt/a; /mnt/b",
    });
    assert.deepStrictEqual(result.active, ["/mnt/a", "/mnt/b"]);
    assert.strictEqual(result.usedFallback, true);
  });

  it("can exclude one of several manual paths", () => {
    const result = scanLocations.resolveScanLocations({
      manualPath: "/mnt/a;/mnt/b",
      excluded: ["/mnt/a"],
    });
    assert.deepStrictEqual(result.active, ["/mnt/b"]);
    assert.deepStrictEqual(result.excluded, ["/mnt/a"]);
  });

  it("does not scan the same folder twice when Roon and the manual path agree", () => {    const result = scanLocations.resolveScanLocations({
      roonLocations: [{ title: "Main", subtitle: "/mnt/music" }],
      manualPath: "/mnt/music/",
    });
    assert.strictEqual(result.active.length, 1);
    assert.deepStrictEqual(result.locations[0].sources, ["roon", "manual"]);
  });

  it("honours the exclusion list", () => {
    const result = scanLocations.resolveScanLocations({
      roonLocations: [
        { title: "Main", subtitle: "/mnt/music" },
        { title: "Spare", subtitle: "/mnt/spare" },
      ],
      excluded: ["/mnt/spare"],
    });
    assert.deepStrictEqual(result.active, ["/mnt/music"]);
    assert.deepStrictEqual(result.excluded, ["/mnt/spare"]);
  });

  it("matches exclusions regardless of a trailing slash", () => {
    const result = scanLocations.resolveScanLocations({
      roonLocations: [{ title: "Spare", subtitle: "/mnt/spare" }],
      excluded: ["/mnt/spare/"],
    });
    assert.deepStrictEqual(result.active, []);
  });

  it("returns nothing when there is no input at all", () => {
    const result = scanLocations.resolveScanLocations({});
    assert.deepStrictEqual(result.active, []);
    assert.deepStrictEqual(result.locations, []);
  });
});

describe("toggleExclusion()", () => {
  it("adds a path to the exclusion list", () => {
    assert.deepStrictEqual(scanLocations.toggleExclusion([], "/mnt/spare", true), ["/mnt/spare"]);
  });

  it("removes a path from the exclusion list", () => {
    assert.deepStrictEqual(scanLocations.toggleExclusion(["/mnt/spare"], "/mnt/spare", false), []);
  });

  it("does not add the same path twice", () => {
    const once = scanLocations.toggleExclusion(["/mnt/spare"], "/mnt/spare/", true);
    assert.strictEqual(once.length, 1);
  });

  it("ignores a blank path", () => {
    assert.deepStrictEqual(scanLocations.toggleExclusion(["/mnt/spare"], "  ", true), ["/mnt/spare"]);
  });
});

describe("validateLocations()", () => {
  it("accepts a readable directory", async () => {
    const result = await scanLocations.validateLocations([path.join(root, "music")]);
    assert.deepStrictEqual(result.usable, [path.join(root, "music")]);
    assert.deepStrictEqual(result.unreadable, []);
  });

  it("reports a missing directory rather than treating it as empty", async () => {
    // Critical: an unmounted share must not look like "you own no albums".
    const result = await scanLocations.validateLocations([path.join(root, "missing")]);
    assert.strictEqual(result.usable.length, 0);
    assert.strictEqual(result.unreadable[0].reason, "Does not exist");
  });

  it("rejects a path that is a file", async () => {
    const result = await scanLocations.validateLocations([path.join(root, "not-a-directory")]);
    assert.strictEqual(result.unreadable[0].reason, "Not a directory");
  });

  it("separates usable from unreadable locations", async () => {
    const result = await scanLocations.validateLocations([
      path.join(root, "music"),
      path.join(root, "missing"),
    ]);
    assert.strictEqual(result.usable.length, 1);
    assert.strictEqual(result.unreadable.length, 1);
  });
});
