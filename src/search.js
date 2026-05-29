"use strict";

const axios = require("axios");
const cheerio = require("cheerio");

const HTTP_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
};
const TIMEOUT = 10000;

async function searchBandcamp(artist, title) {
  const query = `${artist} ${title}`;
  try {
    const resp = await axios.get("https://bandcamp.com/search", {
      params: { q: query },
      headers: HTTP_HEADERS,
      timeout: TIMEOUT,
    });
    const $ = cheerio.load(resp.data);
    const results = [];
    $(".result-items .searchresult.album").each((_, el) => {
      const itemTitle = $(el).find(".heading").text().trim();
      const itemArtist = $(el).find(".subhead").text().trim();
      const url = $(el).find(".itemurl").text().trim();
      if (url) results.push({ store: "Bandcamp", title: itemTitle, artist: itemArtist, url });
    });
    return results.slice(0, 3);
  } catch {
    return [];
  }
}

async function searchQobuz(artist, title) {
  const query = `${artist} ${title}`;
  try {
    const resp = await axios.get("https://www.qobuz.com/fi-en/search/albums", {
      params: { q: query },
      headers: HTTP_HEADERS,
      timeout: TIMEOUT,
    });
    const $ = cheerio.load(resp.data);
    const results = [];
    $(".album-item, [class*='AlbumCard']").each((_, el) => {
      const itemTitle = $(el).find("[class*='title'], .album-title").first().text().trim();
      const itemArtist = $(el).find("[class*='artist'], .album-artist").first().text().trim();
      const href = $(el).find("a").first().attr("href");
      const url = href ? `https://www.qobuz.com${href}` : null;
      if (url && itemTitle) results.push({ store: "Qobuz", title: itemTitle, artist: itemArtist, url });
    });
    return results.slice(0, 3);
  } catch {
    return [];
  }
}

async function searchAll(artist, title) {
  const [bandcamp, qobuz] = await Promise.all([
    searchBandcamp(artist, title),
    searchQobuz(artist, title),
  ]);
  return [...bandcamp, ...qobuz];
}

module.exports = { searchAll, searchBandcamp, searchQobuz };
