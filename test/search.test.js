"use strict";

const assert = require("node:assert");
const { describe, it } = require("node:test");
const {
  searchBandcamp,
  searchQobuz,
  searchAll,
  buildQuery,
  rankResults,
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

describe("rankResults", () => {
  const exactMatch = {
    store: "Bandcamp",
    title: "Master Of Puppets",
    artist: "Metallica",
    url: "https://metallica.bandcamp.com/album/master-of-puppets",
  };

  it("should reject a cover/stem band whose name embeds the wishlist artist in parentheses", () => {
    const results = rankResults(
      [
        {
          store: "Bandcamp",
          title: "Master Of Puppets",
          artist: "Metallica (First to Eleven Stems)",
          url: "https://firsttoelevenstems.bandcamp.com/album/master-of-puppets",
        },
      ],
      "Metallica",
      "Master of Puppets (Remastered)",
    );
    assert.deepStrictEqual(results, []);
  });

  it("should reject a tribute act whose name appends the wishlist artist", () => {
    const results = rankResults(
      [
        {
          store: "Bandcamp",
          title: "Master Of Puppets",
          artist: "Metallica Tribute",
          url: "https://metallicatribute.bandcamp.com/album/master-of-puppets",
        },
      ],
      "Metallica",
      "Master of Puppets (Remastered)",
    );
    assert.deepStrictEqual(results, []);
  });

  it("should keep an exact artist and title match", () => {
    const results = rankResults([exactMatch], "Metallica", "Master of Puppets (Remastered)");
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].url, exactMatch.url);
  });

  it("should keep a match when only the artist name has an edition marker word", () => {
    const results = rankResults(
      [
        {
          store: "Bandcamp",
          title: "Master Of Puppets",
          artist: "Metallica (Deluxe)",
          url: "https://metallica.bandcamp.com/album/master-of-puppets",
        },
      ],
      "Metallica",
      "Master of Puppets (Remastered)",
    );
    assert.strictEqual(results.length, 1);
  });

  it("should still allow an exact-title result with a partial but overlapping artist name", () => {
    const results = rankResults(
      [
        {
          store: "Bandcamp",
          title: "Abbey Road",
          artist: "The Beatles",
          url: "https://thebeatles.bandcamp.com/album/abbey-road",
        },
      ],
      "Beatles",
      "Abbey Road",
    );
    assert.strictEqual(results.length, 1);
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
