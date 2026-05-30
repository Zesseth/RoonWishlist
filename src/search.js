"use strict";

const cheerio = require("cheerio");

const HTTP_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
};
const TIMEOUT = 10000;

// Thin wrapper over the global fetch (Node >= 18) so we don't ship an HTTP client
// dependency. Adds an AbortController timeout and returns the response body as text,
// or null on any network/timeout/non-2xx error (callers treat that as "no results").
async function fetchText(url, params) {
  const u = new URL(url);
  if (params) for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const resp = await fetch(u, { headers: HTTP_HEADERS, signal: controller.signal });
    if (!resp.ok) return null;
    return await resp.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function searchBandcamp(artist, title) {
  const query = `${artist} ${title}`;
  const html = await fetchText("https://bandcamp.com/search", { q: query });
  if (!html) return [];
  const $ = cheerio.load(html);
  const results = [];
  $(".result-items .searchresult.album").each((_, el) => {
    const itemTitle = $(el).find(".heading").text().trim();
    const itemArtist = $(el).find(".subhead").text().trim();
    const url = $(el).find(".itemurl").text().trim();
    if (url) results.push({ store: "Bandcamp", title: itemTitle, artist: itemArtist, url });
  });
  return results.slice(0, 3);
}

async function searchQobuz(artist, title) {
  const query = `${artist} ${title}`;
  const html = await fetchText("https://www.qobuz.com/fi-en/search/albums", { q: query });
  if (!html) return [];
  const $ = cheerio.load(html);
  const results = [];
  $(".album-item, [class*='AlbumCard']").each((_, el) => {
    const itemTitle = $(el).find("[class*='title'], .album-title").first().text().trim();
    const itemArtist = $(el).find("[class*='artist'], .album-artist").first().text().trim();
    const href = $(el).find("a").first().attr("href");
    const url = href ? `https://www.qobuz.com${href}` : null;
    if (url && itemTitle) results.push({ store: "Qobuz", title: itemTitle, artist: itemArtist, url });
  });
  return results.slice(0, 3);
}

async function searchAll(artist, title) {
  const [bandcamp, qobuz] = await Promise.all([
    searchBandcamp(artist, title),
    searchQobuz(artist, title),
  ]);
  return [...bandcamp, ...qobuz];
}

module.exports = { searchAll, searchBandcamp, searchQobuz };
