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
  parseBandcampTralbum,
  parseQobuzPagePrice,
  qobuzPriceFromAlbum,
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

  it("finds the album when it is not the first search result", () => {
    // Live shape from the Machinae Supremacy self-titled case: the search returns
    // the artist's other albums first and the wanted one further down. All items
    // must survive to the ranking stage, which needs a distinct dedupe key per
    // result — a shared placeholder URL collapsed the set to its first item and
    // the probe answered "not available" for a streamable album.
    const album = (title, id) => ({
      title,
      artist: { name: "Machinae Supremacy" },
      url: `https://www.qobuz.com/fi-en/album/${id}`,
      id,
      streamable: true,
    });
    assert.strictEqual(
      availableOnQobuz(
        [
          album("A View From The End Of The World", "aaaa"),
          album("Overworld", "bbbb"),
          album("Phantom Shadow", "cccc"),
          album("Rise Of A Digital Nation", "dddd"),
          album("Deus Ex Machinae", "eeee"),
          album("Machinae Supremacy", "tk9cknzw7gdyn"),
        ],
        "Machinae Supremacy",
        "Machinae Supremacy",
      ),
      true,
    );
  });

  it("dedupes on the album identity when the API omits urls", () => {
    const album = (title, id) => ({
      title,
      artist: { name: "Machinae Supremacy" },
      id,
      streamable: true,
    });
    assert.strictEqual(
      availableOnQobuz(
        [
          album("A View From The End Of The World", "aaaa"),
          album("Machinae Supremacy", "tk9cknzw7gdyn"),
        ],
        "Machinae Supremacy",
        "Machinae Supremacy",
      ),
      true,
    );
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

describe("price extraction (issue #48)", () => {
  // Bandcamp embeds the sale data HTML-escaped in the data-tralbum attribute.
  const tralbumHtml = (tralbum) => {
    const encoded = JSON.stringify(tralbum).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
    return `<div class="tralbum" data-tralbum="${encoded}"></div>`;
  };

  describe("parseBandcampTralbum", () => {
    it("reads a fixed price and currency from data-tralbum", () => {
      const parsed = parseBandcampTralbum(
        tralbumHtml({ current: { type: "album", is_set_price: true, set_price: 9, minimum_price: 9, currency: "EUR" } }),
      );
      assert.deepStrictEqual(parsed, { price: 9, currency: "EUR" });
    });

    it("uses the store-stated minimum for a name-your-price release", () => {
      const parsed = parseBandcampTralbum(
        tralbumHtml({ current: { type: "album", is_set_price: null, set_price: 7, minimum_price: 7, currency: "EUR" } }),
      );
      assert.strictEqual(parsed.price, 7);
      assert.strictEqual(parsed.currency, "EUR");
    });

    it("keeps a zero price for a free release instead of dropping it", () => {
      const parsed = parseBandcampTralbum(
        tralbumHtml({ current: { type: "album", is_set_price: null, minimum_price: 0, currency: "EUR" } }),
      );
      assert.strictEqual(parsed.price, 0);
    });

    it("falls back to the ld+json priceCurrency when data-tralbum has none", () => {
      const html =
        tralbumHtml({ current: { type: "album", is_set_price: true, set_price: 8 } }) +
        '<script type="application/ld+json">{"@type":"MusicAlbum","offers":{"@type":"Offer","price":8,"priceCurrency":"USD"}}</script>';
      const parsed = parseBandcampTralbum(html);
      assert.strictEqual(parsed.price, 8);
      assert.strictEqual(parsed.currency, "USD");
    });

    it("returns null price when the page carries no price data at all", () => {
      assert.strictEqual(parseBandcampTralbum("<html><body>client challenge</body></html>"), null);
      const parsed = parseBandcampTralbum(tralbumHtml({ current: { type: "album" } }));
      assert.deepStrictEqual(parsed, { price: null, currency: null });
    });
  });

  describe("qobuzPriceFromAlbum", () => {
    it("prefers the hi-res price field on a hires album", () => {
      const info = qobuzPriceFromAlbum({
        price: 9.99,
        hires: true,
        hires_price: 13.99,
        maximum_bit_depth: 24,
        maximum_sampling_rate: 96,
        currency: "EUR",
        display_price: "13,99 €",
      });
      assert.strictEqual(info.price, 13.99);
      assert.strictEqual(info.quality, "24-bit/96 kHz");
      assert.strictEqual(info.currency, "EUR");
      assert.strictEqual(info.displayPrice, "13,99 €");
    });

    it("picks the highest-quality entry when the payload carries per-format offers", () => {
      const info = qobuzPriceFromAlbum({
        formats: [
          { price: 9.99, maximum_bit_depth: 16, maximum_sampling_rate: 44.1 },
          { price: 17.99, maximum_bit_depth: 24, maximum_sampling_rate: 192 },
        ],
      });
      assert.strictEqual(info.price, 17.99);
      assert.strictEqual(info.quality, "24-bit/192 kHz");
    });

    it("falls back to the single album price when no tier-specific field exists", () => {
      const info = qobuzPriceFromAlbum({ price: 8.99, hires: false, maximum_bit_depth: 16, maximum_sampling_rate: 44.1 });
      assert.strictEqual(info.price, 8.99);
      assert.strictEqual(info.quality, "16-bit/44.1 kHz");
    });

    it("returns null when the payload carries no price at all", () => {
      assert.strictEqual(qobuzPriceFromAlbum({ title: "X", hires: true }), null);
      assert.strictEqual(qobuzPriceFromAlbum(null), null);
    });
  });

  describe("parseQobuzPagePrice", () => {
    const pageWithLdJson = (ldjson) =>
      `<html><head><script type="application/ld+json">${JSON.stringify(ldjson)}</script></head><body></body></html>`;

    it("reads offers.price and priceCurrency from the Product JSON-LD (measured live shape)", () => {
      const html = pageWithLdJson({
        "@context": "https://schema.org/",
        "@type": "Product",
        name: "OK Computer OKNOTOK 1997 2017",
        offers: { "@type": "Offer", priceCurrency: "EUR", price: 20.49 },
      });
      assert.deepStrictEqual(parseQobuzPagePrice(html), { price: 20.49, currency: "EUR" });
    });

    it("takes the highest price when several offers are listed (the Hi-Res tier costs more)", () => {
      const html = pageWithLdJson({
        "@type": "Product",
        offers: [
          { "@type": "Offer", priceCurrency: "EUR", price: 9.99 },
          { "@type": "Offer", priceCurrency: "EUR", price: 17.99 },
        ],
      });
      assert.deepStrictEqual(parseQobuzPagePrice(html), { price: 17.99, currency: "EUR" });
    });

    it("ignores non-product JSON-LD and analytics blobs, returns null without any offer", () => {
      const html =
        pageWithLdJson({ "@type": "MusicAlbum", name: "X" }) +
        '<script type="application/ld+json">{"items":[{"price":2.49}]}</script>';
      assert.strictEqual(parseQobuzPagePrice(html), null);
      assert.strictEqual(parseQobuzPagePrice("<html>no data</html>"), null);
    });
  });

  describe("search wiring with a stubbed fetch", () => {
    const jsonResponse = (data) => ({
      ok: true,
      status: 200,
      json: async () => data,
      text: async () => JSON.stringify(data),
    });
    const textResponse = (text) => ({
      ok: true,
      status: 200,
      text: async () => text,
      json: async () => JSON.parse(text),
    });

    function stubFetch(handler) {
      const original = globalThis.fetch;
      globalThis.fetch = async (url, options) => handler(String(url), options || {});
      return () => {
        globalThis.fetch = original;
      };
    }

    it("searchBandcamp attaches the price read from the album page", async () => {
      const restore = stubFetch((url) => {
        if (url.includes("autocomplete_elastic")) {
          return jsonResponse({
            auto: {
              results: [
                { type: "a", name: "Price Album", band_name: "Price Band", item_url_path: "https://priceband.bandcamp.com/album/price-album" },
              ],
            },
          });
        }
        return textResponse(tralbumHtml({ current: { type: "album", is_set_price: true, set_price: 7.5, currency: "EUR" } }));
      });
      try {
        const results = await searchBandcamp("Price Band", "Price Album");
        assert.strictEqual(results.length, 1);
        assert.strictEqual(results[0].price, 7.5);
        assert.strictEqual(results[0].currency, "EUR");
      } finally {
        restore();
      }
    });

    it("searchBandcamp leaves the link without a price when the page has none", async () => {
      const restore = stubFetch((url) => {
        if (url.includes("autocomplete_elastic")) {
          return jsonResponse({
            auto: {
              results: [
                { type: "a", name: "No Price Album", band_name: "Price Band", item_url_path: "https://priceband.bandcamp.com/album/no-price-album" },
              ],
            },
          });
        }
        return textResponse("<html><body>client challenge</body></html>");
      });
      try {
        const results = await searchBandcamp("Price Band", "No Price Album");
        assert.strictEqual(results.length, 1);
        assert.strictEqual(results[0].price, undefined);
      } finally {
        restore();
      }
    });

    it("searchBandcamp falls back to the mobile tralbum API when the page is a bot challenge", async () => {
      const seen = [];
      const restore = stubFetch((url) => {
        seen.push(url);
        if (url.includes("autocomplete_elastic")) {
          return jsonResponse({
            auto: {
              results: [
                { type: "a", name: "Api Album", band_name: "Price Band", item_url_path: "https://priceband.bandcamp.com/album/api-album", id: 555, band_id: 777 },
              ],
            },
          });
        }
        if (url.includes("api/mobile/")) {
          return jsonResponse({ current: { type: "album", is_set_price: true, set_price: 6.5, currency: "EUR" } });
        }
        return textResponse("<html><body>client challenge</body></html>");
      });
      try {
        const results = await searchBandcamp("Price Band", "Api Album");
        assert.strictEqual(results.length, 1);
        assert.strictEqual(results[0].price, 6.5);
        assert.strictEqual(results[0].currency, "EUR");
        assert.strictEqual(results[0]._albumId, undefined, "helper id fields must be stripped from results");
        assert.ok(
          seen.some((u) => u.includes("api/mobile/24/tralbum_details") && u.includes("album_id=555") && u.includes("band_id=777")),
          "the mobile API must be called with the autocomplete item's ids",
        );
      } finally {
        restore();
      }
    });

    it("searchQobuz attaches the hi-res price from the search item and keeps the country-scoped URL", async () => {
      const seen = [];
      const restore = stubFetch((url) => {
        seen.push(url);
        return jsonResponse({
          albums: {
            items: [
              {
                title: "Price Album",
                artist: { name: "Price Band" },
                url: "/fi-en/album/price-album/123456",
                purchasable: true,
                price: 13.99,
                currency: "EUR",
                display_price: "13,99 €",
                hires: true,
                hires_price: 17.99,
                maximum_bit_depth: 24,
                maximum_sampling_rate: 96,
              },
            ],
          },
        });
      });
      try {
        const results = await searchQobuz("Price Band", "Price Album", "FI");
        assert.strictEqual(results.length, 1);
        assert.strictEqual(results[0].price, 17.99);
        assert.strictEqual(results[0].quality, "24-bit/96 kHz");
        assert.strictEqual(results[0].currency, "EUR");
        assert.ok(results[0].url.includes("/fi-en/"));
        assert.ok(seen.every((u) => u.includes("country=FI")), "every Qobuz call must carry the configured country");
      } finally {
        restore();
      }
    });

    it("searchQobuz reads the price from the localized store page when the item has none", async () => {
      const seen = [];
      const restore = stubFetch((url) => {
        seen.push(url);
        if (url.includes("api.json")) {
          return jsonResponse({
            albums: {
              items: [
                {
                  title: "Page Album",
                  artist: { name: "Price Band" },
                  url: "/fi-en/album/page-album/123456",
                  purchasable: true,
                  hires: true,
                  maximum_bit_depth: 24,
                  maximum_sampling_rate: 96,
                },
              ],
            },
          });
        }
        // The storefront page (any /album/... URL) embeds the price in JSON-LD.
        return textResponse(
          '<script type="application/ld+json">{"@type":"Product","offers":{"@type":"Offer","priceCurrency":"EUR","price":20.49}}</script>',
        );
      });
      try {
        const results = await searchQobuz("Price Band", "Page Album", "FI");
        assert.strictEqual(results.length, 1);
        assert.strictEqual(results[0].price, 20.49);
        assert.strictEqual(results[0].currency, "EUR");
        assert.strictEqual(results[0].quality, "24-bit/96 kHz");
        assert.ok(seen.some((u) => u.includes("country=FI")), "the search call must carry the configured country");
        assert.ok(
          seen.some((u) => u.includes("/fi-en/album/")),
          "the price must be read from the country-localized page URL",
        );
      } finally {
        restore();
      }
    });

    it("searchQobuz prefers the Hi-Res edition (link and price) when several purchasable editions match", async () => {
      const restore = stubFetch((url) => {
        if (url.includes("api.json")) {
          return jsonResponse({
            albums: {
              items: [
                {
                  title: "Edition Album",
                  artist: { name: "Price Band" },
                  url: "/fi-en/album/edition-album/111",
                  purchasable: true,
                  hires: false,
                  maximum_bit_depth: 16,
                  maximum_sampling_rate: 44.1,
                },
                {
                  title: "Edition Album (2017 Remaster)",
                  artist: { name: "Price Band" },
                  url: "/fi-en/album/edition-album-2017-remaster/222",
                  purchasable: true,
                  hires: true,
                  maximum_bit_depth: 24,
                  maximum_sampling_rate: 192,
                },
              ],
            },
          });
        }
        if (url.includes("222")) {
          return textResponse(
            '<script type="application/ld+json">{"@type":"Product","offers":{"priceCurrency":"EUR","price":24.99}}</script>',
          );
        }
        return textResponse(
          '<script type="application/ld+json">{"@type":"Product","offers":{"priceCurrency":"EUR","price":9.99}}</script>',
        );
      });
      try {
        const results = await searchQobuz("Price Band", "Edition Album (2017 Remaster)", "FI");
        assert.strictEqual(results.length, 1);
        assert.ok(results[0].url.includes("222"), "the Hi-Res edition's link should win");
        assert.strictEqual(results[0].price, 24.99, "the price must be the Hi-Res one");
        assert.strictEqual(results[0].quality, "24-bit/192 kHz");
      } finally {
        restore();
      }
    });
  });
});
