"use strict";

const assert = require("node:assert");
const { describe, it, beforeEach, afterEach } = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const streaming = require("../src/streaming_availability");
const wishlist = require("../src/wishlist");

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

function makeWishlistDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wishlist-streaming-"));
  process.env.ROON_WISHLIST_DATA_DIR = dir;
  return dir;
}

describe("streaming availability", () => {
  let dir;
  beforeEach(() => {
    dir = makeWishlistDir();
  });
  afterEach(() => {
    delete process.env.ROON_WISHLIST_DATA_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  describe("listStreamingServicesDetailed", () => {
    it("recognizes services in the browse root", async () => {
      const browse = fakeBrowse({
        root: [
          { item_key: "lib", title: "Library" },
          { item_key: "qob", title: "Qobuz" },
          { item_key: "tid", title: "TIDAL" },
          { item_key: "radio", title: "Live Radio" },
        ],
      });
      const { services, diagnostic } = await streaming.listStreamingServicesDetailed(browse);
      assert.deepEqual(services.sort(), ["qobuz", "tidal"]);
      assert.equal(diagnostic.outcome, "ok");
    });

    it("does not report measured navigation entries as unrecognized", async () => {
      // Root captured from a live Roon 2.73 core (issue #34): the saved
      // live-radio stations show up as "My Live Radio" next to the services.
      const browse = fakeBrowse({
        root: [
          { item_key: "lib", title: "Library" },
          { item_key: "pl", title: "Playlists" },
          { item_key: "radio", title: "My Live Radio" },
          { item_key: "gen", title: "Genres" },
          { item_key: "qob", title: "Qobuz" },
          { item_key: "set", title: "Settings" },
        ],
      });
      const { services, diagnostic } = await streaming.listStreamingServicesDetailed(browse);
      assert.deepEqual(services, ["qobuz"]);
      assert.deepEqual(diagnostic.unrecognized, []);
    });

    it("reports none-found with the root titles as evidence", async () => {
      const browse = fakeBrowse({
        root: [{ item_key: "lib", title: "Library" }],
      });
      const { services, diagnostic } = await streaming.listStreamingServicesDetailed(browse);
      assert.deepEqual(services, []);
      assert.equal(diagnostic.outcome, "none-found");
      assert.ok(Array.isArray(diagnostic.rootTitles));
    });

    it("returns not-paired without a browse service", async () => {
      const { services, diagnostic } = await streaming.listStreamingServicesDetailed(null);
      assert.deepEqual(services, []);
      assert.equal(diagnostic.outcome, "not-paired");
    });
  });

  describe("checkStreamingAvailability", () => {
    it("flags a roon-tag album that is not in any catalogue", async () => {
      wishlist.replaceAll([
        { artist: "Amorphis", title: "Circle", source: "roon-tag", buyLinks: [{ store: "Qobuz", title: "Circle", artist: "Amorphis", url: "https://x" }] },
      ]);
      const result = await streaming.checkStreamingAvailability({
        wishlist,
        probes: { qobuz: async () => false },
        services: ["qobuz"],
        checkedAt: "2026-01-01T00:00:00.000Z",
      });
      assert.equal(result.status, "ok");
      assert.equal(result.flagged.length, 1);
      const entry = wishlist.getAll()[0];
      assert.equal(entry.streamUnavailable, true);
      assert.equal(entry.streaming.available, false);
      assert.ok(entry.streaming.checkedAt);
    });

    it("does not flag a hand-added album on its first failed check", async () => {
      wishlist.replaceAll([
        { artist: "Nobody", title: "Nothing", source: "manual" },
      ]);
      const result = await streaming.checkStreamingAvailability({
        wishlist,
        probes: { qobuz: async () => false },
        services: ["qobuz"],
      });
      assert.equal(result.flagged.length, 0);
      assert.equal(wishlist.getAll()[0].streamUnavailable, false);
    });

    it("does not flag an album already owned locally in full lossless", async () => {
      // "Local wins, but only in lossless" (user decision, issue #34): a complete
      // local lossless copy meets the wishlist goal, so streaming is moot. Measured
      // live: a large share of roon-tag entries have local copies.
      wishlist.replaceAll([
        { artist: "Opeth", title: "Blackwater Park", source: "roon-tag" },
      ]);
      const result = await streaming.checkStreamingAvailability({
        wishlist,
        probes: { qobuz: async () => false },
        services: ["qobuz"],
        localAlbums: [{ artist: "Opeth", title: "Blackwater Park" }],
      });
      assert.equal(result.flagged.length, 0);
      const entry = wishlist.getAll()[0];
      assert.equal(entry.streamUnavailable, false);
      assert.equal(entry.streaming.available, false);
    });

    it("does not flag a lossless-owned album even after a real disappearance", async () => {
      // Owning the album in lossless removes the buy urgency entirely, so no
      // flag is raised even when the album was streamable before and is gone now.
      wishlist.replaceAll([
        {
          artist: "Opeth",
          title: "Blackwater Park",
          source: "roon-tag",
          streaming: { available: true, services: ["qobuz"], checkedAt: "2025-01-01T00:00:00.000Z", lastSeenAt: "2025-01-01T00:00:00.000Z" },
        },
      ]);
      const result = await streaming.checkStreamingAvailability({
        wishlist,
        probes: { qobuz: async () => false },
        services: ["qobuz"],
        localAlbums: [{ artist: "Opeth", title: "Blackwater Park" }],
        checkedAt: "2026-01-01T00:00:00.000Z",
      });
      assert.equal(result.flagged.length, 0);
      assert.equal(wishlist.getAll()[0].streamUnavailable, false);
    });

    it("still checks a lossy-only local rip: streaming matters for it", async () => {
      // A lossy copy is not in localAlbums (findLosslessLocalItems only returns
      // full-lossless copies), so the entry participates like any other: it is on
      // the wishlist to be upgraded, and whether it can still be streamed is
      // significant.
      wishlist.replaceAll([
        { artist: "Barathrum", title: "Hailstorm", source: "roon-tag" },
      ]);
      const result = await streaming.checkStreamingAvailability({
        wishlist,
        probes: { qobuz: async () => false },
        services: ["qobuz"],
        localAlbums: [{ artist: "Opeth", title: "Blackwater Park" }],
      });
      assert.equal(result.flagged.length, 1);
      assert.equal(wishlist.getAll()[0].streamUnavailable, true);
    });

    it("matches the local album list case-insensitively", async () => {
      wishlist.replaceAll([
        { artist: "Opeth", title: "Blackwater Park", source: "roon-tag" },
      ]);
      const result = await streaming.checkStreamingAvailability({
        wishlist,
        probes: { qobuz: async () => false },
        services: ["qobuz"],
        localAlbums: [{ artist: "opeth", title: "blackwater park" }],
      });
      assert.equal(result.flagged.length, 0);
    });

    it("flags a disappearance: previously streamable, now gone", async () => {
      wishlist.replaceAll([
        {
          artist: "Amorphis",
          title: "Circle",
          source: "manual",
          streaming: { available: true, services: ["qobuz"], checkedAt: "2025-01-01T00:00:00.000Z", lastSeenAt: "2025-01-01T00:00:00.000Z" },
        },
      ]);
      const result = await streaming.checkStreamingAvailability({
        wishlist,
        probes: { qobuz: async () => false },
        services: ["qobuz"],
        checkedAt: "2026-01-01T00:00:00.000Z",
      });
      assert.equal(result.flagged.length, 1);
      const entry = wishlist.getAll()[0];
      assert.equal(entry.streamUnavailable, true);
      assert.equal(entry.streaming.lastSeenAt, "2025-01-01T00:00:00.000Z");
    });

    it("clears the flag when the album returns", async () => {
      wishlist.replaceAll([
        {
          artist: "Amorphis",
          title: "Circle",
          source: "roon-tag",
          streamUnavailable: true,
          streamUnavailableSince: "2025-06-01T00:00:00.000Z",
          streaming: { available: false, services: [], checkedAt: "2025-06-01T00:00:00.000Z" },
        },
      ]);
      const result = await streaming.checkStreamingAvailability({
        wishlist,
        probes: { qobuz: async () => true },
        services: ["qobuz"],
        checkedAt: "2026-01-01T00:00:00.000Z",
      });
      assert.equal(result.flagged.length, 0);
      const entry = wishlist.getAll()[0];
      assert.equal(entry.streamUnavailable, false);
      assert.equal(entry.streaming.available, true);
      assert.deepEqual(entry.streaming.services, ["qobuz"]);
    });

    it("treats a probe error as unknown, never as gone", async () => {
      wishlist.replaceAll([
        { artist: "Amorphis", title: "Circle", source: "roon-tag" },
      ]);
      const result = await streaming.checkStreamingAvailability({
        wishlist,
        probes: { qobuz: async () => { throw new Error("network"); } },
        services: ["qobuz"],
      });
      assert.equal(result.flagged.length, 0);
      assert.equal(result.unknown, 1);
      assert.equal(wishlist.getAll()[0].streamUnavailable, false);
    });

    it("does not flag when one of several services still has it", async () => {
      wishlist.replaceAll([
        { artist: "Amorphis", title: "Circle", source: "roon-tag" },
      ]);
      const result = await streaming.checkStreamingAvailability({
        wishlist,
        probes: { qobuz: async () => false, tidal: async () => true },
        services: ["qobuz", "tidal"],
      });
      assert.equal(result.flagged.length, 0);
      const entry = wishlist.getAll()[0];
      assert.equal(entry.streaming.available, true);
      assert.deepEqual(entry.streaming.services, ["tidal"]);
    });

    it("reports no-probes without touching the wishlist", async () => {
      wishlist.replaceAll([{ artist: "A", title: "B", source: "roon-tag" }]);
      const result = await streaming.checkStreamingAvailability({
        wishlist,
        probes: {},
        services: ["qobuz"],
      });
      assert.equal(result.status, "no-probes");
      assert.equal(wishlist.getAll()[0].streamUnavailable, undefined);
    });
  });

  describe("nextStreamingState", () => {
    it("keeps lastSeenAt when the album stays gone", () => {
      const state = streaming.nextStreamingState(
        { available: false, lastSeenAt: "2025-01-01T00:00:00.000Z" },
        { available: false, services: [], checkedAt: "2026-01-01T00:00:00.000Z" },
      );
      assert.equal(state.lastSeenAt, "2025-01-01T00:00:00.000Z");
    });

    it("refreshes lastSeenAt when seen again", () => {
      const state = streaming.nextStreamingState(
        { available: false, lastSeenAt: "2025-01-01T00:00:00.000Z" },
        { available: true, services: ["qobuz"], checkedAt: "2026-01-01T00:00:00.000Z" },
      );
      assert.equal(state.lastSeenAt, "2026-01-01T00:00:00.000Z");
    });
  });
});
