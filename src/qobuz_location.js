"use strict";

const DEFAULT_COUNTRY = "FR";

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
  const languages = {
    FI: "fi", SE: "sv", NO: "no", DK: "da", NL: "nl", DE: "de",
    AT: "de", CH: "de", FR: "fr", BE: "fr", ES: "es", IT: "it",
    PT: "pt", PL: "pl", CZ: "cs", GB: "en", IE: "en", US: "en",
    CA: "en", AU: "en",
  };
  return `${languages[normalized] || "en"}-${normalized.toLowerCase()}`;
}

const COUNTRY_OPTIONS = [
  ["FI", "Finland"], ["SE", "Sweden"], ["NO", "Norway"], ["DK", "Denmark"],
  ["DE", "Germany"], ["FR", "France"], ["GB", "United Kingdom"],
  ["NL", "Netherlands"], ["ES", "Spain"], ["IT", "Italy"], ["US", "United States"],
  ["CA", "Canada"], ["AU", "Australia"],
];

module.exports = {
  DEFAULT_COUNTRY,
  COUNTRY_OPTIONS,
  detectCountry,
  normalizeCountry,
  localeForCountry,
};
