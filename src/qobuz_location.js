"use strict";

const DEFAULT_COUNTRY = "FI";

function detectCountry(env = process.env) {
  const locale = env.ROON_WISHLIST_QOBUZ_COUNTRY ||
    env.LC_ALL ||
    env.LC_ADDRESS ||
    env.LC_MESSAGES ||
    env.LANG ||
    "";
  const match = String(locale).match(/(?:[_-]([A-Za-z]{2})(?:[.@_-]|$)|^([A-Za-z]{2})$)/);
  return normalizeCountry(match ? (match[1] || match[2]) : DEFAULT_COUNTRY);
}

function normalizeCountry(value) {
  const country = String(value || "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(country) ? country : "";
}

function localeForCountry(country) {
  const normalized = normalizeCountry(country) || DEFAULT_COUNTRY;
  const locales = {
    FI: "fi-en", SE: "se-en", NO: "no-en", DK: "dk-en",
    DE: "de-de", AT: "at-de", CH: "ch-de", FR: "fr-fr",
    BE: "be-fr", GB: "gb-en", IE: "ie-en", NL: "nl-nl",
    ES: "es-es", IT: "it-it", PT: "pt-pt", US: "us-en",
    CA: "ca-en", AU: "au-en",
  };
  return locales[normalized] || locales[DEFAULT_COUNTRY];
}

const COUNTRY_OPTIONS = [
  ["FI", "Finland"], ["SE", "Sweden"], ["NO", "Norway"], ["DK", "Denmark"],
  ["DE", "Germany"], ["AT", "Austria"], ["CH", "Switzerland"], ["FR", "France"],
  ["BE", "Belgium"], ["GB", "United Kingdom"], ["IE", "Ireland"],
  ["NL", "Netherlands"], ["ES", "Spain"], ["IT", "Italy"], ["PT", "Portugal"],
  ["US", "United States"], ["CA", "Canada"], ["AU", "Australia"],
];

module.exports = {
  DEFAULT_COUNTRY,
  COUNTRY_OPTIONS,
  detectCountry,
  normalizeCountry,
  localeForCountry,
};
