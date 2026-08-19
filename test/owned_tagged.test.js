"use strict";

const assert = require("node:assert");
const { describe, it, before, after } = require("node:test");

const fs = require("fs");
const os = require("os");
const path = require("path");

const lossless = require("../src/lossless_checker");

let root;

function makeAlbum(location, artist, album, files) {
  const dir = path.join(root, location, artist, album);
  fs.mkdirSync(dir, { recursive: true });
  for (const file of files) fs.writeFileSync(path.join(dir, file), "");
  return dir;
}

function makeWishlistStub(items) {
  const state = items.map((item) => ({ ...item }));
  const find = (target) =>
    state.findIndex(
      (item) =>
        item.artist.toLowerCase() === String(target.artist || "").toLowerCase() &&
        item.title.toLowerCase() === String(target.title || "").toLowerCase(),
    );
  return {
    getAll: () => state.map((item) => ({ ...item })),
    remove(target) {
      const index = find(target);
      if (index === -1) return false;
      state.splice(index, 1);
      return true;
    },
    upsert(album) {
      const index = find(album);
      if (index === -1) state.push({ ...album });
      else state[index] = { ...state[index], ...album };
      return true;
    },
    _state: state,
  };
}

describe("already-owned Roon-tagged albums (#32)", () => {
  before(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "owned-tagged-"));
    // Owned outright: every track lossless.
    makeAlbum("lib", "Katatonia", "The World We Left Behind", ["01.flac", "02.flac"]);
    // Owned, but only as MP3 — still worth buying.
    makeAlbum("lib", "Opeth", "Blackwater Park", ["01.mp3", "02.mp3"]);
    // Owned, but only partly lossless.
    makeAlbum("lib", "Tool", "Lateralus", ["01.flac", "02.mp3"]);
    // The real layout on the user's server: the album folder repeats the artist name.
    makeAlbum("lib", "Nachtmystium", "Nachtmystium - The World We Left Behind", [
      "01 - Nachtmystium - Intrusion.flac",
      "02 - Nachtmystium - Fireheart.flac",
      "folder.jpg",
    ]);
  });

  after(() => fs.rmSync(root, { recursive: true, force: true }));

  const lib = () => path.join(root, "lib");

  describe("classifyWantedAlbums()", () => {
    it("only opens the folders that are actually wanted", async () => {
      const { results } = await lossless.classifyWantedAlbums(lib(), [
        { artist: "Katatonia", title: "The World We Left Behind" },
      ]);
      assert.strictEqual(results.size, 1);
      assert.strictEqual([...results.values()][0].status, "owned-lossless");
    });

    it("reports nothing for an album that is not in the library", async () => {
      const { results } = await lossless.classifyWantedAlbums(lib(), [
        { artist: "Nobody", title: "Nothing" },
      ]);
      assert.strictEqual(results.size, 0);
    });

    it("returns an empty result rather than scanning when nothing is wanted", async () => {
      const { results, errors } = await lossless.classifyWantedAlbums(lib(), []);
      assert.strictEqual(results.size, 0);
      assert.strictEqual(errors, 0);
    });
  });

  describe("markOwnedTaggedAlbums()", () => {
    it("flags a tagged album that is already owned in full lossless", async () => {
      const wishlist = makeWishlistStub([
        { artist: "Katatonia", title: "The World We Left Behind", source: "roon-tag" },
      ]);
      const result = await lossless.markOwnedTaggedAlbums(lib(), wishlist);

      assert.strictEqual(result.owned.length, 1);
      assert.strictEqual(wishlist._state[0].ownedLossless, true);
    });

    it("leaves a tagged album alone when only a lossy copy exists", async () => {
      const wishlist = makeWishlistStub([
        { artist: "Opeth", title: "Blackwater Park", source: "roon-tag" },
      ]);
      const result = await lossless.markOwnedTaggedAlbums(lib(), wishlist);

      assert.strictEqual(result.owned.length, 0);
      assert.notStrictEqual(wishlist._state[0].ownedLossless, true);
    });

    it("does not treat a partly lossless album as owned", async () => {
      const wishlist = makeWishlistStub([
        { artist: "Tool", title: "Lateralus", source: "roon-tag" },
      ]);
      const result = await lossless.markOwnedTaggedAlbums(lib(), wishlist);
      assert.strictEqual(result.owned.length, 0);
    });

    it("clears a stale flag once the lossless copy is gone", async () => {
      const wishlist = makeWishlistStub([
        { artist: "Nobody", title: "Nothing", source: "roon-tag", ownedLossless: true },
      ]);
      const result = await lossless.markOwnedTaggedAlbums(lib(), wishlist);

      assert.strictEqual(result.cleared.length, 1);
      assert.strictEqual(wishlist._state[0].ownedLossless, false);
    });

    it("ignores entries that did not come from the Roon tag", async () => {
      const wishlist = makeWishlistStub([
        { artist: "Katatonia", title: "The World We Left Behind", source: "low-quality" },
      ]);
      const result = await lossless.markOwnedTaggedAlbums(lib(), wishlist);

      assert.strictEqual(result.checked, 0);
      assert.strictEqual(wishlist._state[0].ownedLossless, undefined);
    });

    it("refuses to conclude anything when there is nowhere to look", async () => {
      const wishlist = makeWishlistStub([
        { artist: "Katatonia", title: "The World We Left Behind", source: "roon-tag", ownedLossless: true },
      ]);
      // This is the shape a caller passing the wrong thing produces: no usable root.
      await assert.rejects(() => lossless.markOwnedTaggedAlbums([], wishlist), /ownership could not be determined/i);
      // The flag must survive: an empty scan is not evidence the album is gone.
      assert.strictEqual(wishlist._state[0].ownedLossless, true);
    });

    it("does not silently treat a blank location as an empty library", async () => {
      const wishlist = makeWishlistStub([
        { artist: "Katatonia", title: "The World We Left Behind", source: "roon-tag" },
      ]);
      await assert.rejects(() => lossless.markOwnedTaggedAlbums(["", "  "], wishlist), /ownership could not be determined/i);
      assert.strictEqual(wishlist._state[0].ownedLossless, undefined);
    });

    it("finds an album whose folder is named \"Artist - Album\"", async () => {
      const wishlist = makeWishlistStub([
        { artist: "Nachtmystium", title: "The World We Left Behind", source: "roon-tag" },
      ]);
      const result = await lossless.markOwnedTaggedAlbums(lib(), wishlist);

      assert.strictEqual(result.owned.length, 1);
      assert.strictEqual(wishlist._state[0].ownedLossless, true);
    });

    it("never deletes the entry — Roon stays the master", async () => {
      const wishlist = makeWishlistStub([
        { artist: "Katatonia", title: "The World We Left Behind", source: "roon-tag" },
      ]);
      await lossless.markOwnedTaggedAlbums(lib(), wishlist);
      assert.strictEqual(wishlist._state.length, 1);
    });
  });

  describe("checkAndClean() with tagged entries", () => {
    it("flags rather than removes an owned tagged album", async () => {
      const wishlist = makeWishlistStub([
        { artist: "Katatonia", title: "The World We Left Behind", source: "roon-tag" },
      ]);
      const result = await lossless.checkAndClean(lib(), wishlist);

      assert.strictEqual(result.removed.length, 0);
      assert.strictEqual(result.alreadyOwned.length, 1);
      assert.strictEqual(wishlist._state.length, 1);
      assert.strictEqual(wishlist._state[0].ownedLossless, true);
    });

    it("still removes an owned album that came from the low-quality scan", async () => {
      const wishlist = makeWishlistStub([
        { artist: "Katatonia", title: "The World We Left Behind", source: "low-quality" },
      ]);
      const result = await lossless.checkAndClean(lib(), wishlist);

      assert.strictEqual(result.removed.length, 1);
      assert.strictEqual(result.alreadyOwned.length, 0);
      assert.strictEqual(wishlist._state.length, 0);
    });

    it("clears a stale owned flag when the album is no longer fully lossless", async () => {
      const wishlist = makeWishlistStub([
        { artist: "Tool", title: "Lateralus", source: "roon-tag", ownedLossless: true },
      ]);
      await lossless.checkAndClean(lib(), wishlist);
      assert.strictEqual(wishlist._state[0].ownedLossless, false);
    });
  });
});
