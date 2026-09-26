"use strict";

const assert = require("node:assert");
const { describe, it } = require("node:test");
const {
  searchBandcamp,
  searchQobuz,
  searchAll,
  buildQuery,
} = require("../src/search");

describe("buildQuery", () => {
  it("should keep plain titles unchanged", () => {
    assert.strictEqual(buildQuery("Metallica", "Ride The Lightning"), "Metallica Ride The Lightning");
  });

  it("should strip parenthetical edition markers from the query", () => {
    assert.strictEqual(
      buildQuery("Metallica", "Ride The Lightning (Remastered)"),
      "Metallica Ride The Lightning",
    );
  });

  it("should strip bracketed edition markers and standalone marker words", () => {
    assert.strictEqual(
      buildQuery("Pink Floyd", "The Wall [Deluxe Edition]"),
      "Pink Floyd The Wall",
    );
  });

  it("should fall back to the raw title when stripping removes everything", () => {
    assert.strictEqual(buildQuery("Artist", "(Remastered)"), "Artist (Remastered)");
  });

  it("should return only the artist when the title is empty", () => {
    assert.strictEqual(buildQuery("Adele", ""), "Adele");
  });
});

describe("search module", () => {
  describe("searchBandcamp", () => {
    it("should return array for valid input", async () => {
      const result = await searchBandcamp("The Beatles", "Abbey Road");
      assert.ok(Array.isArray(result));
    });

    it("should return empty array for empty input", async () => {
      const result = await searchBandcamp("", "");
      assert.deepStrictEqual(result, []);
    });

    it("should handle artist without title", async () => {
      const result = await searchBandcamp("Adele", "");
      assert.ok(Array.isArray(result));
    });
  });

  describe("searchQobuz", () => {
    it("should return array for valid input", async () => {
      const result = await searchQobuz("The Beatles", "Abbey Road");
      assert.ok(Array.isArray(result));
    });

    it("should return empty array for empty input", async () => {
      const result = await searchQobuz("", "");
      assert.deepStrictEqual(result, []);
    });

    it("should handle artist without title", async () => {
      const result = await searchQobuz("Adele", "");
      assert.ok(Array.isArray(result));
    });
  });

  describe("searchAll", () => {
    it("should search both platforms for valid input", async () => {
      const result = await searchAll("The Beatles", "Abbey Road");
      assert.ok(Array.isArray(result));
    });

    it("should return empty array for empty input", async () => {
      const result = await searchAll("", "");
      assert.deepStrictEqual(result, []);
    });

    it("should combine results from both platforms", async () => {
      const result = await searchAll("Pink Floyd", "The Wall");
      assert.ok(Array.isArray(result));
      // Result is combined array, could be empty if no results
    });
  });
});
