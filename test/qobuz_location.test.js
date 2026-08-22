"use strict";

const assert = require("node:assert");
const { describe, it } = require("node:test");
const {
  detectCountry,
  normalizeCountry,
  localeForCountry,
} = require("../src/qobuz_location");
const { localizeQobuzUrl } = require("../src/search");

describe("Qobuz location", () => {
  it("detects a country from common locale formats", () => {
    assert.strictEqual(detectCountry({ LANG: "fi_FI.UTF-8" }), "FI");
    assert.strictEqual(detectCountry({ LC_ALL: "sv-SE" }), "SE");
  });

  it("prefers the explicit environment override", () => {
    assert.strictEqual(
      detectCountry({ ROON_WISHLIST_QOBUZ_COUNTRY: "DE", LANG: "fi_FI.UTF-8" }),
      "DE",
    );
  });

  it("falls back to France when no country can be detected", () => {
    assert.strictEqual(detectCountry({}), "FR");
    assert.strictEqual(normalizeCountry(" fi "), "FI");
    assert.strictEqual(normalizeCountry("FIN"), "");
  });

  it("maps countries to Qobuz URL locales", () => {
    assert.strictEqual(localeForCountry("FI"), "fi-fi");
    assert.strictEqual(localeForCountry("US"), "en-us");
    assert.strictEqual(localeForCountry("XX"), "en-xx");
  });

  it("localizes an existing Qobuz URL without changing its album path", () => {
    assert.strictEqual(
      localizeQobuzUrl("https://www.qobuz.com/fr-fr/album/ride-the-lightning/abc", "FI"),
      "https://www.qobuz.com/fi-fi/album/ride-the-lightning/abc",
    );
  });
});
