"use strict";

const assert = require("node:assert");
const { describe, it, beforeEach, afterEach } = require("node:test");

const path = require("path");
const fs = require("fs");
const os = require("os");

// We'll use the real wishlist module but with a temp directory
// We need to set ROON_WISHLIST_DATA_DIR before requiring the module

function cleanupTestDir(testDir) {
  try {
    const files = fs.readdirSync(testDir);
    for (const file of files) {
      const filePath = path.join(testDir, file);
      try {
        if (fs.statSync(filePath).isFile()) {
          fs.unlinkSync(filePath);
        }
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }
}

describe("wishlist module", () => {
  let testDir;
  let wishlist;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "roon-wishlist-test-"));
    // Set env before loading
    process.env.ROON_WISHLIST_DATA_DIR = testDir;
    // Clear cache and load fresh
    delete require.cache[require.resolve("../src/wishlist")];
    wishlist = require("../src/wishlist");
  });

  afterEach(() => {
    // Clean up env
    delete process.env.ROON_WISHLIST_DATA_DIR;
    cleanupTestDir(testDir);
    try {
      fs.rmdirSync(testDir);
    } catch {
      // ignore
    }
    // Clear module cache for next test
    delete require.cache[require.resolve("../src/wishlist")];
  });

  describe("add()", () => {
    it("should add a new album to empty wishlist", () => {
      const result = wishlist.add({ artist: "Test Artist", title: "Test Album" });
      assert.strictEqual(result, true);
      const items = wishlist.getAll();
      assert.strictEqual(items.length, 1);
      assert.strictEqual(items[0].artist, "Test Artist");
      assert.strictEqual(items[0].title, "Test Album");
    });

    it("should return false when adding duplicate album", () => {
      wishlist.add({ artist: "Test Artist", title: "Test Album" });
      const result = wishlist.add({ artist: "Test Artist", title: "Test Album" });
      assert.strictEqual(result, false);
      const items = wishlist.getAll();
      assert.strictEqual(items.length, 1);
    });

    it("should treat albums with different case as duplicates", () => {
      wishlist.add({ artist: "Test Artist", title: "Test Album" });
      const result = wishlist.add({ artist: "TEST ARTIST", title: "test album" });
      assert.strictEqual(result, false);
      const items = wishlist.getAll();
      assert.strictEqual(items.length, 1);
    });

    it("should trim whitespace in album data", () => {
      const result = wishlist.add({ artist: "  Test   Artist  ", title: "  Test   Album  " });
      assert.strictEqual(result, true);
      const items = wishlist.getAll();
      // Note: wishlist only trims leading/trailing whitespace, not internal
      assert.strictEqual(items[0].artist, "Test   Artist");
      assert.strictEqual(items[0].title, "Test   Album");
    });

    it("should add album with buyLinks", () => {
      const buyLinks = [
        { store: "Bandcamp", url: "https://test.bandcamp.com", title: "Test Album", artist: "Test Artist" }
      ];
      const result = wishlist.add({ artist: "Test Artist", title: "Test Album", buyLinks });
      assert.strictEqual(result, true);
      const items = wishlist.getAll();
      assert.strictEqual(items[0].buyLinks.length, 1);
      assert.strictEqual(items[0].buyLinks[0].store, "Bandcamp");
      assert.strictEqual(items[0].buyLinks[0].url, "https://test.bandcamp.com");
    });

    it("should add album with addedAt timestamp", () => {
      const addedAt = "2026-01-01T00:00:00.000Z";
      const result = wishlist.add({ artist: "Test Artist", title: "Test Album", addedAt });
      assert.strictEqual(result, true);
      const items = wishlist.getAll();
      assert.strictEqual(items[0].addedAt, addedAt);
    });

    it("should filter out buyLinks without store or url", () => {
      const buyLinks = [
        { store: "Valid", url: "http://valid.com" },
        { store: "", url: "http://invalid.com" },
        { store: "NoUrl", url: "" }
      ];
      wishlist.add({ artist: "Test Artist", title: "Test Album", buyLinks });
      const items = wishlist.getAll();
      assert.strictEqual(items[0].buyLinks.length, 1);
      assert.strictEqual(items[0].buyLinks[0].store, "Valid");
    });
  });

  describe("remove()", () => {
    it("should remove existing album", () => {
      wishlist.add({ artist: "Test Artist", title: "Test Album" });
      const result = wishlist.remove({ artist: "Test Artist", title: "Test Album" });
      assert.strictEqual(result, true);
      const items = wishlist.getAll();
      assert.strictEqual(items.length, 0);
    });

    it("should return false when removing non-existent album", () => {
      const result = wishlist.remove({ artist: "Non-existent", title: "Album" });
      assert.strictEqual(result, false);
    });

    it("should remove with different case", () => {
      wishlist.add({ artist: "Test Artist", title: "Test Album" });
      const result = wishlist.remove({ artist: "TEST ARTIST", title: "test album" });
      assert.strictEqual(result, true);
      const items = wishlist.getAll();
      assert.strictEqual(items.length, 0);
    });

    it("should not remove similar but different albums", () => {
      wishlist.add({ artist: "Test Artist", title: "First Album" });
      wishlist.add({ artist: "Test Artist", title: "Second Album" });
      const result = wishlist.remove({ artist: "Test Artist", title: "First Album" });
      assert.strictEqual(result, true);
      const items = wishlist.getAll();
      assert.strictEqual(items.length, 1);
      assert.strictEqual(items[0].title, "Second Album");
    });
  });

  describe("getAll()", () => {
    it("should return empty array for new wishlist", () => {
      const items = wishlist.getAll();
      assert.strictEqual(items.length, 0);
      assert.deepStrictEqual(items, []);
    });

    it("should return copy of wishlist array", () => {
      wishlist.add({ artist: "Test Artist", title: "Test Album" });
      const items = wishlist.getAll();
      items.push({ artist: "Another", title: "Album" });
      const items2 = wishlist.getAll();
      assert.strictEqual(items2.length, 1);
    });

    it("should return all added albums", () => {
      wishlist.add({ artist: "Artist 1", title: "Album 1" });
      wishlist.add({ artist: "Artist 2", title: "Album 2" });
      wishlist.add({ artist: "Artist 3", title: "Album 3" });
      const items = wishlist.getAll();
      assert.strictEqual(items.length, 3);
    });
  });

  describe("upsert()", () => {
    it("should add new album when not exists", () => {
      const result = wishlist.upsert({ artist: "Test Artist", title: "Test Album" });
      assert.strictEqual(result, "added");
      const items = wishlist.getAll();
      assert.strictEqual(items.length, 1);
    });

    it("should update existing album with new buyLinks", () => {
      wishlist.add({ artist: "Test Artist", title: "Test Album" });
      const result = wishlist.upsert({ 
        artist: "Test Artist", 
        title: "Test Album", 
        buyLinks: [{ store: "Bandcamp", url: "http://test.com" }] 
      });
      assert.strictEqual(result, "updated");
      const items = wishlist.getAll();
      assert.strictEqual(items.length, 1);
      assert.strictEqual(items[0].buyLinks.length, 1);
      assert.strictEqual(items[0].buyLinks[0].store, "Bandcamp");
    });

    it("should return unchanged when data is same", () => {
      wishlist.add({ artist: "Test Artist", title: "Test Album" });
      const result = wishlist.upsert({ artist: "Test Artist", title: "Test Album" });
      assert.strictEqual(result, "unchanged");
    });

    it("should preserve addedAt when updating existing album", () => {
      const originalAddedAt = "2026-01-01T00:00:00.000Z";
      wishlist.add({ artist: "Test Artist", title: "Test Album", addedAt: originalAddedAt });
      
      const result = wishlist.upsert({ 
        artist: "Test Artist", 
        title: "Test Album", 
        buyLinks: [{ store: "NewStore", url: "http://new.com" }] 
      });
      
      assert.strictEqual(result, "updated");
      const items = wishlist.getAll();
      assert.strictEqual(items[0].addedAt, originalAddedAt);
      assert.strictEqual(items[0].buyLinks[0].store, "NewStore");
    });
  });

  describe("replaceAll()", () => {
    it("should replace entire wishlist with new albums", () => {
      wishlist.add({ artist: "Old", title: "Album" });
      const count = wishlist.replaceAll([
        { artist: "New1", title: "Album1" },
        { artist: "New2", title: "Album2" }
      ]);
      assert.strictEqual(count, 2);
      const items = wishlist.getAll();
      assert.strictEqual(items.length, 2);
      assert.strictEqual(items[0].artist, "New1");
      assert.strictEqual(items[1].artist, "New2");
    });

    it("should deduplicate albums in input", () => {
      const count = wishlist.replaceAll([
        { artist: "Test", title: "Album" },
        { artist: "Test", title: "Album" }
      ]);
      assert.strictEqual(count, 1);
      const items = wishlist.getAll();
      assert.strictEqual(items.length, 1);
    });

    it("should remove duplicates with different case", () => {
      const count = wishlist.replaceAll([
        { artist: "Test", title: "Album" },
        { artist: "TEST", title: "ALBUM" }
      ]);
      assert.strictEqual(count, 1);
    });

    it("should skip albums without artist or title", () => {
      const count = wishlist.replaceAll([
        { artist: "Valid", title: "Album" },
        { artist: "", title: "No Artist" },
        { artist: "No Title", title: "" }
      ]);
      assert.strictEqual(count, 1);
      const items = wishlist.getAll();
      assert.strictEqual(items.length, 1);
      assert.strictEqual(items[0].artist, "Valid");
    });

    it("should clear wishlist when passed empty array", () => {
      wishlist.add({ artist: "Test", title: "Album" });
      const count = wishlist.replaceAll([]);
      assert.strictEqual(count, 0);
      const items = wishlist.getAll();
      assert.strictEqual(items.length, 0);
    });

    it("should handle null/undefined input", () => {
      wishlist.add({ artist: "Test", title: "Album" });
      const count = wishlist.replaceAll(null);
      assert.strictEqual(count, 0);
      const items = wishlist.getAll();
      assert.strictEqual(items.length, 0);
    });
  });

  describe("data persistence", () => {
    it("should persist data to file", () => {
      wishlist.add({ artist: "Test Artist", title: "Test Album" });
      
      // Check that file was created
      const dataFile = path.join(testDir, "wishlist.json");
      assert.strictEqual(fs.existsSync(dataFile), true);
      
      // Check file content
      const content = fs.readFileSync(dataFile, "utf8");
      const data = JSON.parse(content);
      assert.strictEqual(data.length, 1);
      assert.strictEqual(data[0].artist, "Test Artist");
    });

    it("should load persisted data on subsequent calls", () => {
      wishlist.add({ artist: "Test Artist", title: "Test Album" });
      
      // Reload the module to test persistence
      delete require.cache[require.resolve("../src/wishlist")];
      const wishlist2 = require("../src/wishlist");
      
      const items = wishlist2.getAll();
      assert.strictEqual(items.length, 1);
      assert.strictEqual(items[0].artist, "Test Artist");
    });
  });
});
