"use strict";

const assert = require("node:assert");
const { describe, it } = require("node:test");

const tagSync = require("../src/roon_tag_sync");
const reconciliation = require("../src/roon_reconciliation");

/**
 * A minimal stand-in for node-roon-api-browse. `levels` maps an item_key (or the
 * literal "root") to the items that level should return, so a test can describe the
 * Library -> Tags -> <tag> -> Albums path without a Roon core.
 */
function fakeBrowse(levels) {
  let currentLevel = null;

  return {
    browse(opts, cb) {
      currentLevel = opts.item_key || "root";
      const items = levels[currentLevel];
      if (!items) return cb(null, { action: "message", message: "Nothing here", is_error: true });
      cb(null, { action: "list", list: { level: 0, count: items.length } });
    },
    load(opts, cb) {
      const items = levels[currentLevel] || [];
      cb(null, { items, list: { count: items.length } });
    },
  };
}

/** Browse tree containing a "Wishlist" tag holding the given albums. */
function browseWithTag(albums, tagTitle = "Wishlist") {
  return fakeBrowse({
    root: [{ item_key: "lib", title: "Library" }],
    lib: [{ item_key: "tags", title: "Tags" }],
    tags: [{ item_key: "tag", title: tagTitle }],
    tag: [{ item_key: "albums", title: "Albums" }],
    albums: albums.map((a, i) => ({
      item_key: `a${i}`,
      title: a.title,
      subtitle: a.artist,
      hint: "list",
    })),
  });
}

/** Browse tree where the Tags level exists but holds no "Wishlist" tag. */
function browseWithoutTag() {
  return fakeBrowse({
    root: [{ item_key: "lib", title: "Library" }],
    lib: [{ item_key: "tags", title: "Tags" }],
    tags: [{ item_key: "other", title: "Something else" }],
  });
}

function makeWishlist(items) {
  const state = items.map((item) => ({ ...item }));
  const key = (a) => `${(a.artist || "").toLowerCase()}||${(a.title || "").toLowerCase()}`;
  return {
    getAll: () => state.map((item) => ({ ...item })),
    upsert(album) {
      const i = state.findIndex((item) => key(item) === key(album));
      if (i === -1) {
        state.push({ ...album });
        return "added";
      }
      state[i] = { ...state[i], ...album };
      return "updated";
    },
    add(album) {
      if (state.some((item) => key(item) === key(album))) return false;
      state.push({ ...album });
      return true;
    },
    remove(album) {
      const i = state.findIndex((item) => key(item) === key(album));
      if (i === -1) return false;
      state.splice(i, 1);
      return true;
    },
    replaceAll(albums) {
      state.length = 0;
      for (const a of albums) state.push({ ...a });
      return state.length;
    },
    _state: state,
  };
}

const noLinks = async () => [];

describe("listTaggedAlbumsDetailed()", () => {
  it("reads the albums carrying the tag", async () => {
    const browse = browseWithTag([{ artist: "Opeth", title: "Blackwater Park" }]);
    const { albums, tagFound } = await tagSync.listTaggedAlbumsDetailed(browse, "Wishlist");

    assert.strictEqual(tagFound, true);
    assert.deepStrictEqual(albums, [{ artist: "Opeth", title: "Blackwater Park" }]);
  });

  it("reports a missing tag as an empty result rather than throwing", async () => {
    // Roon hides a tag once its last album is untagged, so "missing" and "empty" are
    // the same observation and both mean "no album carries this tag".
    const { albums, tagFound } = await tagSync.listTaggedAlbumsDetailed(browseWithoutTag(), "Wishlist");

    assert.strictEqual(tagFound, false);
    assert.deepStrictEqual(albums, []);
  });

  it("reads a tag that still exists but holds nothing as empty", async () => {
    // Untagging every album leaves the tag in place but with no albums under it. This
    // used to throw "the album list could not be opened" - the one case where the
    // wishlist most needs clearing was the case that failed.
    const browse = fakeBrowse({
      root: [{ item_key: "lib", title: "Library" }],
      lib: [{ item_key: "tags", title: "Tags" }],
      tags: [{ item_key: "tag", title: "Wishlist" }],
      tag: [],
    });

    const { albums, tagFound } = await tagSync.listTaggedAlbumsDetailed(browse, "Wishlist");
    assert.strictEqual(tagFound, true);
    assert.deepStrictEqual(albums, []);
  });

  it("treats an empty tag offering only Play/Shuffle actions as empty", async () => {
    // Roon still offers the tag's actions when it holds no albums.
    const browse = fakeBrowse({
      root: [{ item_key: "lib", title: "Library" }],
      lib: [{ item_key: "tags", title: "Tags" }],
      tags: [{ item_key: "tag", title: "Wishlist" }],
      tag: [
        { item_key: "p", title: "Play Tag" },
        { item_key: "s", title: "Shuffle Tag" },
      ],
    });

    const { albums, tagFound } = await tagSync.listTaggedAlbumsDetailed(browse, "Wishlist");
    assert.strictEqual(tagFound, true);
    assert.deepStrictEqual(albums, []);
  });

  it("treats a Roon 'nothing to show' message on the tag as empty", async () => {
    // Roon answers an empty tag with a message rather than an empty list.
    const browse = fakeBrowse({
      root: [{ item_key: "lib", title: "Library" }],
      lib: [{ item_key: "tags", title: "Tags" }],
      tags: [{ item_key: "tag", title: "Wishlist" }],
      // "tag" is absent from levels, so the stub replies with a message action.
    });

    const { albums, tagFound } = await tagSync.listTaggedAlbumsDetailed(browse, "Wishlist");
    assert.strictEqual(tagFound, true);
    assert.deepStrictEqual(albums, []);
  });

  it("still throws when there is no browse service at all", async () => {
    // Not being able to look must never be mistaken for an empty tag.
    await assert.rejects(() => tagSync.listTaggedAlbumsDetailed(null, "Wishlist"), /browse access/i);
  });

  it("keeps the throwing listTaggedAlbums() for callers that want the error", async () => {
    await assert.rejects(() => tagSync.listTaggedAlbums(browseWithoutTag(), "Wishlist"), /Could not find/i);
  });
});

describe("syncTaggedAlbums() - Roon is the master", () => {
  it("adds albums that are tagged in Roon", async () => {
    const wishlist = makeWishlist([]);
    const result = await tagSync.syncTaggedAlbums({
      browseService: browseWithTag([{ artist: "Opeth", title: "Blackwater Park" }]),
      wishlist,
      searchAll: noLinks,
      tagName: "Wishlist",
    });

    assert.strictEqual(result.added, 1);
    assert.strictEqual(wishlist._state.length, 1);
  });

  it("removes an album that was untagged in Roon", async () => {
    // The bug this covers: sync was upsert-only, so untagging in Roon left the album
    // on the wishlist forever and the two silently drifted apart.
    const wishlist = makeWishlist([
      { artist: "Opeth", title: "Blackwater Park", source: "roon-tag" },
      { artist: "Tool", title: "Lateralus", source: "roon-tag" },
    ]);

    const result = await tagSync.syncTaggedAlbums({
      browseService: browseWithTag([{ artist: "Opeth", title: "Blackwater Park" }]),
      wishlist,
      searchAll: noLinks,
      tagName: "Wishlist",
    });

    assert.strictEqual(result.removed, 1);
    assert.deepStrictEqual(result.removedAlbums, [{ artist: "Tool", title: "Lateralus" }]);
    assert.deepStrictEqual(wishlist._state.map((a) => a.title), ["Blackwater Park"]);
  });

  it("never removes an album the user added by hand", async () => {
    // The tag has no authority over entries that were not derived from it.
    const wishlist = makeWishlist([
      { artist: "Manual", title: "Added By Hand", source: "manual" },
      { artist: "Tool", title: "Lateralus", source: "roon-tag" },
    ]);

    await tagSync.syncTaggedAlbums({
      browseService: browseWithTag([]),
      wishlist,
      searchAll: noLinks,
      tagName: "Wishlist",
    });

    assert.deepStrictEqual(wishlist._state.map((a) => a.title), ["Added By Hand"]);
  });

  it("clears tag-derived albums when every album was untagged", async () => {
    // Exactly the case that used to report "Could not find the Roon tag" and change
    // nothing, leaving stale albums behind.
    const wishlist = makeWishlist([
      { artist: "Opeth", title: "Blackwater Park", source: "roon-tag" },
      { artist: "Manual", title: "Added By Hand", source: "manual" },
    ]);

    const result = await tagSync.syncTaggedAlbums({
      browseService: browseWithoutTag(),
      wishlist,
      searchAll: noLinks,
      tagName: "Wishlist",
    });

    assert.strictEqual(result.tagFound, false);
    assert.strictEqual(result.removed, 1);
    assert.deepStrictEqual(wishlist._state.map((a) => a.title), ["Added By Hand"]);
  });

  it("refuses to touch anything when browse is unavailable", async () => {
    const wishlist = makeWishlist([{ artist: "Opeth", title: "Blackwater Park", source: "roon-tag" }]);

    await assert.rejects(() =>
      tagSync.syncTaggedAlbums({
        browseService: null,
        wishlist,
        searchAll: noLinks,
        tagName: "Wishlist",
      }),
    );
    assert.strictEqual(wishlist._state.length, 1);
  });

  it("leaves the wishlist alone when the tag already matches", async () => {
    const wishlist = makeWishlist([{ artist: "Opeth", title: "Blackwater Park", source: "roon-tag" }]);
    const result = await tagSync.syncTaggedAlbums({
      browseService: browseWithTag([{ artist: "Opeth", title: "Blackwater Park" }]),
      wishlist,
      searchAll: noLinks,
      tagName: "Wishlist",
    });

    assert.strictEqual(result.added, 0);
    assert.strictEqual(result.removed, 0);
    assert.strictEqual(wishlist._state.length, 1);
  });
});

describe("reconcileOnStartup() - Roon is the master", () => {
  it("removes tag-derived albums that are no longer tagged", async () => {
    const wishlist = makeWishlist([
      { artist: "Opeth", title: "Blackwater Park", source: "roon-tag" },
      { artist: "Tool", title: "Lateralus", source: "roon-tag" },
    ]);

    const result = await reconciliation.reconcileOnStartup({
      browseService: browseWithTag([{ artist: "Opeth", title: "Blackwater Park" }]),
      wishlist,
      searchAll: noLinks,
      tagName: "Wishlist",
    });

    assert.strictEqual(result.status, "completed");
    assert.strictEqual(result.removed, 1);
    assert.deepStrictEqual(wishlist._state.map((a) => a.title), ["Blackwater Park"]);
  });

  it("keeps manual albums when the tag is gone", async () => {
    const wishlist = makeWishlist([
      { artist: "Manual", title: "Added By Hand", source: "manual" },
      { artist: "Tool", title: "Lateralus", source: "roon-tag" },
    ]);

    const result = await reconciliation.reconcileOnStartup({
      browseService: browseWithoutTag(),
      wishlist,
      searchAll: noLinks,
      tagName: "Wishlist",
    });

    assert.strictEqual(result.tagFound, false);
    assert.deepStrictEqual(wishlist._state.map((a) => a.title), ["Added By Hand"]);
  });

  it("changes nothing when there is no browse service", async () => {
    const wishlist = makeWishlist([{ artist: "Tool", title: "Lateralus", source: "roon-tag" }]);
    const result = await reconciliation.reconcileOnStartup({
      browseService: null,
      wishlist,
      searchAll: noLinks,
      tagName: "Wishlist",
    });

    assert.strictEqual(result.status, "skipped");
    assert.strictEqual(wishlist._state.length, 1);
  });
});
