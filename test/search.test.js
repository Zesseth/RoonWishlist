"use strict";

const assert = require("node:assert");
const { describe, it } = require("node:test");
const {
  searchBandcamp,
  searchQobuz,
  searchAll,
  availableOnQobuz,
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

describe("availableOnQobuz", () => {
  // Shape captured from the live public album/search payload (issue #34): every
  // album item carries explicit streamable/purchasable flags.
  const qobuzItem = (artist, title, streamable) => ({
    title,
    artist: { name: artist },
    streamable,
    purchasable: streamable !== false,
  });

  it("counts a streamable catalogue hit as available", () => {
    assert.strictEqual(
      availableOnQobuz([qobuzItem("Opeth", "Blackwater Park", true)], "Opeth", "Blackwater Park"),
      true,
    );
  });

  it("does not count a purchase-only release: in the catalogue but not streamable", () => {
    assert.strictEqual(
      availableOnQobuz([qobuzItem("Opeth", "Blackwater Park", false)], "Opeth", "Blackwater Park"),
      false,
    );
  });

  it("falls back to catalogue existence when the payload has no streamable flag", () => {
    const item = qobuzItem("Opeth", "Blackwater Park", undefined);
    delete item.streamable;
    assert.strictEqual(availableOnQobuz([item], "Opeth", "Blackwater Park"), true);
  });

  it("does not let a different act's similarly-titled album satisfy the probe", () => {
    assert.strictEqual(
      availableOnQobuz([qobuzItem("Pink Floyd", "Wish You Were Here", true)], "Opeth", "Wish You Were Here"),
      false,
    );
  });

  it("returns false for an empty catalogue answer", () => {
    assert.strictEqual(availableOnQobuz([], "Opeth", "Blackwater Park"), false);
  });
});

describe("artist punctuation matching (issue #78)", () => {
  const stormSeeker = {
    store: "Qobuz",
    title: "Storm Seeker",
    artist: "ICS Vortex",
    url: "https://www.qobuz.com/album/storm-seeker-ics-vortex",
  };

  it("accepts the store's undotted artist when the wishlist artist is dotted", () => {
    const results = rankResults([stormSeeker], "I.C.S. Vortex", "Storm Seeker");
    assert.strictEqual(results.length, 1);
  });

  it("accepts the dotted artist when the store result is the dotted spelling", () => {
    const results = rankResults(
      [{ ...stormSeeker, artist: "I.C.S. Vortex" }],
      "ICS Vortex",
      "Storm Seeker",
    );
    assert.strictEqual(results.length, 1);
  });

  it("counts the album as available on Qobuz under the dotted spelling", () => {
    // The exact shape of the live false negative: Roon's metadata said
    // "I.C.S. Vortex", Qobuz's catalogue says "ICS Vortex", and the probe
    // answered "not available" for an album that is streamable.
    assert.strictEqual(
      availableOnQobuz(
        [
          {
            title: "Storm Seeker",
            artist: { name: "ICS Vortex" },
            streamable: true,
            purchasable: true,
          },
        ],
        "I.C.S. Vortex",
        "Storm Seeker",
      ),
      true,
    );
  });
});

describe("searchBandcamp punctuation fallback (issue #78)", () => {
  it("finds the album although the wishlist artist is dotted", async () => {
    // Bandcamp's autocomplete returns nothing for "I.C.S. Vortex" at the query
    // level; the fallback re-asks with the punctuation stripped and finds the
    // Soulseller Records page. Live call, like the other store tests.
    const results = await searchBandcamp("I.C.S. Vortex", "Storm Seeker");
    assert.ok(Array.isArray(results));
    assert.ok(results.length >= 1, "expected the fallback query to find the album");
    assert.strictEqual(results[0].artist, "ICS Vortex");
  });
});
