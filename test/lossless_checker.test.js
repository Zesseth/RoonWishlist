"use strict";

const assert = require("node:assert");
const { describe, it, before, after } = require("node:test");

const fs = require("fs");
const os = require("os");
const path = require("path");

const lossless = require("../src/lossless_checker");

let root;

/**
 * Builds an album folder as `<root>/<location>/<artist>/<album>` containing one empty
 * file per supplied name. Only the extensions matter — the checker classifies on file
 * extension, never on file contents.
 */
function makeAlbum(location, artist, album, files) {
  const dir = path.join(root, location, artist, album);
  fs.mkdirSync(dir, { recursive: true });
  for (const file of files) {
    fs.writeFileSync(path.join(dir, file), "");
  }
  return dir;
}

function locationPath(name) {
  return path.join(root, name);
}

/** Minimal stand-in for the wishlist module: enough surface for the checker. */
function makeWishlistStub(items) {
  const state = items.map((item) => ({ ...item }));
  return {
    getAll: () => state.map((item) => ({ ...item })),
    remove(target) {
      const index = state.findIndex(
        (item) =>
          item.artist.toLowerCase() === target.artist.toLowerCase() &&
          item.title.toLowerCase() === target.title.toLowerCase(),
      );
      if (index === -1) return false;
      state.splice(index, 1);
      return true;
    },
    upsert(album) {
      const index = state.findIndex(
        (item) =>
          item.artist.toLowerCase() === album.artist.toLowerCase() &&
          item.title.toLowerCase() === album.title.toLowerCase(),
      );
      if (index === -1) state.push({ ...album });
      else state[index] = { ...state[index], ...album };
      return true;
    },
    _state: state,
  };
}

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "roon-wishlist-lossless-"));

  // Location A
  makeAlbum("libA", "Opeth", "Blackwater Park", ["01.flac", "02.flac"]);
  makeAlbum("libA", "Portishead", "Dummy", ["01.mp3", "02.mp3"]);
  makeAlbum("libA", "Tool", "Lateralus", ["01.flac", "02.mp3"]);
  makeAlbum("libA", "Boards of Canada", "Geogaddi", ["cover.jpg", "notes.txt"]);
  makeAlbum("libA", "Miles Davis", "Kind of Blue", ["01.wav", "02.aiff"]);

  // Location B — holds a lossless copy of an album that is lossy in location A.
  makeAlbum("libB", "Portishead", "Dummy", ["01.flac", "02.flac"]);
  makeAlbum("libB", "Autechre", "Tri Repetae", ["01.mp3"]);
});

after(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("lossless format detection", () => {
  it("treats every lossless container as lossless, not just FLAC", () => {
    for (const ext of [".flac", ".wav", ".aiff", ".aif", ".ape", ".wv", ".alac", ".dsf", ".dff"]) {
      assert.strictEqual(lossless.isLosslessExtension(ext), true, `${ext} should be lossless`);
    }
  });

  it("treats compressed formats as lossy", () => {
    for (const ext of [".mp3", ".aac", ".ogg", ".opus", ".wma"]) {
      assert.strictEqual(lossless.isLosslessExtension(ext), false, `${ext} should be lossy`);
    }
  });

  it("treats .m4a as lossy because the extension cannot distinguish ALAC from AAC", () => {
    // Deliberately conservative: the safe error is keeping an album on the wishlist.
    assert.strictEqual(lossless.isLosslessExtension(".m4a"), false);
  });

  it("is case insensitive", () => {
    assert.strictEqual(lossless.isLosslessExtension(".FLAC"), true);
  });
});

describe("classifyAlbumFolder()", () => {
  it("classifies an all-lossless album as owned-lossless", async () => {
    const result = await lossless.classifyAlbumFolder(
      path.join(locationPath("libA"), "Opeth", "Blackwater Park"),
    );
    assert.strictEqual(result.status, "owned-lossless");
    assert.strictEqual(result.losslessFiles, 2);
    assert.strictEqual(result.lossyFiles, 0);
  });

  it("classifies an album of non-FLAC lossless files as owned-lossless", async () => {
    const result = await lossless.classifyAlbumFolder(
      path.join(locationPath("libA"), "Miles Davis", "Kind of Blue"),
    );
    assert.strictEqual(result.status, "owned-lossless");
    assert.strictEqual(result.lossyFiles, 0);
  });

  it("classifies an all-lossy album as owned-lossy", async () => {
    const result = await lossless.classifyAlbumFolder(
      path.join(locationPath("libA"), "Portishead", "Dummy"),
    );
    assert.strictEqual(result.status, "owned-lossy");
    assert.strictEqual(result.losslessFiles, 0);
  });

  it("classifies a part-lossless album as owned-mixed rather than owned", async () => {
    const result = await lossless.classifyAlbumFolder(
      path.join(locationPath("libA"), "Tool", "Lateralus"),
    );
    assert.strictEqual(result.status, "owned-mixed");
    assert.strictEqual(result.losslessFiles, 1);
    assert.strictEqual(result.lossyFiles, 1);
  });

  it("classifies a folder with no audio as not-audio", async () => {
    const result = await lossless.classifyAlbumFolder(
      path.join(locationPath("libA"), "Boards of Canada", "Geogaddi"),
    );
    assert.strictEqual(result.status, "not-audio");
    assert.strictEqual(result.totalAudioFiles, 0);
  });

  it("reports the distinct formats it found", async () => {
    const result = await lossless.classifyAlbumFolder(
      path.join(locationPath("libA"), "Tool", "Lateralus"),
    );
    assert.deepStrictEqual(result.formats, [".flac", ".mp3"]);
  });
});

describe("normalizeLocations()", () => {
  it("accepts a bare string", () => {
    assert.deepStrictEqual(lossless.normalizeLocations("/music"), ["/music"]);
  });

  it("accepts Roon-style objects", () => {
    assert.deepStrictEqual(lossless.normalizeLocations([{ path: "/music" }]), ["/music"]);
  });

  it("drops blanks and duplicate paths", () => {
    assert.deepStrictEqual(
      lossless.normalizeLocations(["/music", "", "  ", "/music/", "/other"]),
      ["/music", "/other"],
    );
  });
});

describe("scanLibraries()", () => {
  it("scans every location and reports per-location counts", async () => {
    const result = await lossless.scanLibraries([locationPath("libA"), locationPath("libB")]);
    assert.strictEqual(result.locations.length, 2);
    assert.strictEqual(result.perLocation.length, 2);
    assert.strictEqual(result.perLocation[0].albums, 5);
    assert.strictEqual(result.perLocation[1].albums, 2);
  });

  it("tags each album with the location it came from", async () => {
    const result = await lossless.scanLibraries([locationPath("libB")]);
    assert.ok(result.albums.every((album) => album.location === locationPath("libB")));
  });

  it("survives a location that does not exist", async () => {
    const result = await lossless.scanLibraries([
      locationPath("libA"),
      path.join(root, "does-not-exist"),
    ]);
    assert.ok(result.errors > 0);
    assert.strictEqual(result.perLocation.length, 2);
  });
});

describe("mergeAlbumsAcrossLocations()", () => {
  it("keeps the best quality copy when an album exists in two locations", async () => {
    const { albums } = await lossless.scanLibraries([locationPath("libA"), locationPath("libB")]);
    const merged = lossless.mergeAlbumsAcrossLocations(albums);
    const dummy = merged.find((album) => album.artist === "Portishead");

    assert.strictEqual(dummy.status, "owned-lossless");
    assert.strictEqual(dummy.copies.length, 2);
  });

  it("collapses duplicates so each album appears once", async () => {
    const { albums } = await lossless.scanLibraries([locationPath("libA"), locationPath("libB")]);
    const merged = lossless.mergeAlbumsAcrossLocations(albums);
    const titles = merged.map((album) => `${album.artist}|${album.album}`);

    assert.strictEqual(new Set(titles).size, titles.length);
  });
});

describe("checkAndClean()", () => {
  it("removes an album only when a complete lossless copy exists", async () => {
    const stub = makeWishlistStub([{ artist: "Opeth", title: "Blackwater Park" }]);
    const result = await lossless.checkAndClean(locationPath("libA"), stub);

    assert.strictEqual(result.removed.length, 1);
    assert.strictEqual(result.kept.length, 0);
    assert.strictEqual(stub._state.length, 0);
  });

  it("keeps an album that exists only in a lossy format", async () => {
    const stub = makeWishlistStub([{ artist: "Portishead", title: "Dummy" }]);
    const result = await lossless.checkAndClean(locationPath("libA"), stub);

    assert.strictEqual(result.removed.length, 0);
    assert.strictEqual(result.kept[0].status, "owned-lossy");
    assert.strictEqual(stub._state.length, 1);
  });

  it("keeps a part-lossless album instead of silently removing it", async () => {
    const stub = makeWishlistStub([{ artist: "Tool", title: "Lateralus" }]);
    const result = await lossless.checkAndClean(locationPath("libA"), stub);

    assert.strictEqual(result.removed.length, 0);
    assert.strictEqual(result.kept[0].status, "owned-mixed");
  });

  it("reports albums that are not in the library at all", async () => {
    const stub = makeWishlistStub([{ artist: "Nobody", title: "Nothing" }]);
    const result = await lossless.checkAndClean(locationPath("libA"), stub);

    assert.strictEqual(result.kept[0].status, "not-found");
    assert.match(result.kept[0].reason, /Not found/i);
  });

  it("explains why every kept album was kept", async () => {
    const stub = makeWishlistStub([
      { artist: "Portishead", title: "Dummy" },
      { artist: "Tool", title: "Lateralus" },
      { artist: "Nobody", title: "Nothing" },
    ]);
    const result = await lossless.checkAndClean(locationPath("libA"), stub);

    assert.strictEqual(result.kept.length, 3);
    assert.ok(result.kept.every((entry) => typeof entry.reason === "string" && entry.reason.length));
  });

  it("removes an album when a lossless copy exists in any location", async () => {
    // Lossy in libA, lossless in libB: owning it properly anywhere means owning it.
    const stub = makeWishlistStub([{ artist: "Portishead", title: "Dummy" }]);
    const result = await lossless.checkAndClean(
      [locationPath("libA"), locationPath("libB")],
      stub,
    );

    assert.strictEqual(result.removed.length, 1);
    assert.strictEqual(stub._state.length, 0);
  });

  it("does nothing when the wishlist is empty", async () => {
    const stub = makeWishlistStub([]);
    const result = await lossless.checkAndClean(locationPath("libA"), stub);

    assert.deepStrictEqual(result.removed, []);
    assert.deepStrictEqual(result.kept, []);
  });

  it("records the check outcome on the kept wishlist entry", async () => {
    // The status has to survive a restart: Roon's settings screen can only render
    // text it is given, so the entry itself must carry its last known state.
    const stub = makeWishlistStub([{ artist: "Tool", title: "Lateralus" }]);
    await lossless.checkAndClean(locationPath("libA"), stub);

    const entry = stub._state[0];
    assert.strictEqual(entry.lastCheck.status, "owned-mixed");
    assert.strictEqual(entry.lastCheck.losslessTracks, 1);
    assert.strictEqual(entry.lastCheck.totalTracks, 2);
    assert.ok(entry.lastCheck.reason.length);
    assert.ok(!Number.isNaN(Date.parse(entry.lastCheck.checkedAt)));
  });

  it("records a not-found outcome too", async () => {
    const stub = makeWishlistStub([{ artist: "Nobody", title: "Nothing" }]);
    await lossless.checkAndClean(locationPath("libA"), stub);

    assert.strictEqual(stub._state[0].lastCheck.status, "not-found");
    assert.strictEqual(stub._state[0].lastCheck.foundAt, null);
  });

  it("does not rewrite the entry when the outcome is unchanged", async () => {
    // Avoid a wishlist.json write per album on every scheduled scan.
    const stub = makeWishlistStub([{ artist: "Portishead", title: "Dummy" }]);
    await lossless.checkAndClean(locationPath("libA"), stub);

    let writes = 0;
    const inner = stub.upsert;
    stub.upsert = (album) => {
      writes += 1;
      return inner(album);
    };
    await lossless.checkAndClean(locationPath("libA"), stub);

    assert.strictEqual(writes, 0);
  });

  it("survives a wishlist module that cannot persist status", async () => {
    const stub = makeWishlistStub([{ artist: "Portishead", title: "Dummy" }]);
    delete stub.upsert;
    const result = await lossless.checkAndClean(locationPath("libA"), stub);

    assert.strictEqual(result.kept.length, 1);
  });
});

describe("scanLowQualityAlbums()", () => {
  it("adds lossy and mixed albums but not lossless ones", async () => {
    const stub = makeWishlistStub([]);
    const result = await lossless.scanLowQualityAlbums(locationPath("libA"), stub, null);
    const added = result.addedAlbums.map((album) => album.artist).sort();

    assert.deepStrictEqual(added, ["Portishead", "Tool"]);
    assert.strictEqual(result.skippedLossless, 2);
  });

  it("does not add an album that is lossless in another location", async () => {
    const stub = makeWishlistStub([]);
    const result = await lossless.scanLowQualityAlbums(
      [locationPath("libA"), locationPath("libB")],
      stub,
      null,
    );
    const added = result.addedAlbums.map((album) => album.artist).sort();

    assert.ok(!added.includes("Portishead"), "Portishead is lossless in libB");
    assert.deepStrictEqual(added, ["Autechre", "Tool"]);
  });

  it("respects the ignore list", async () => {
    const stub = makeWishlistStub([]);
    const ignore = {
      has: (artist) => artist === "Portishead",
    };
    const result = await lossless.scanLowQualityAlbums(locationPath("libA"), stub, ignore);

    assert.strictEqual(result.ignored, 1);
    assert.ok(!result.addedAlbums.some((album) => album.artist === "Portishead"));
  });

  it("records the album quality on the wishlist entry", async () => {
    const stub = makeWishlistStub([]);
    await lossless.scanLowQualityAlbums(locationPath("libA"), stub, null);
    const tool = stub._state.find((item) => item.artist === "Tool");

    assert.strictEqual(tool.qualityStatus, "owned-mixed");
    assert.strictEqual(tool.qualityTotalTracks, 2);
    assert.strictEqual(tool.qualityLosslessTracks, 1);
  });
});
