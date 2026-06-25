"use strict";

const HTTP_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
};

const BANDCAMP_API_URL = "https://bandcamp.com/api/bcsearch_public_api/1/autocomplete_elastic";
const QOBUZ_API_URL = "https://www.qobuz.com/api.json/0.2/album/search";
const DEFAULT_QOBUZ_APP_ID = "712109809";
const FALLBACK_QOBUZ_APP_IDS = ["231339556", "546568742"];
const TIMEOUT_MS = 10000;
const MAX_RETRIES = 3;
const CACHE_TTL_MS = 10 * 60 * 1000;
const RESULT_LIMIT = 1;
const MIN_MATCH_SCORE = 240;
const EDITION_MARKERS =
  /\b(?:deluxe|edition|expanded|remaster(?:ed)?|anniversary|bonus|version|mono|stereo|explicit)\b/g;

const responseCache = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildUrl(url, params) {
  const next = new URL(url);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") {
        next.searchParams.set(key, String(value));
      }
    }
  }
  return next.toString();
}

function getCached(key) {
  const cached = responseCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    responseCache.delete(key);
    return null;
  }
  return cached.value;
}

function setCached(key, value) {
  responseCache.set(key, {
    value,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

async function requestJson(url, options = {}) {
  const method = options.method || "GET";
  const finalUrl = buildUrl(url, options.params);
  const body = typeof options.body === "string" ? options.body : null;
  const cacheKey = `${method} ${finalUrl} ${body || ""}`;
  const cached = getCached(cacheKey);
  if (cached) {
    return { ok: true, data: cached, status: 200, cached: true };
  }

  let lastResult = { ok: false, status: null, error: null };

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const resp = await fetch(finalUrl, {
        method,
        headers: { ...HTTP_HEADERS, ...(options.headers || {}) },
        body,
        signal: controller.signal,
      });

      if (resp.ok) {
        const data = await resp.json();
        setCached(cacheKey, data);
        return { ok: true, data, status: resp.status, cached: false };
      }

      lastResult = {
        ok: false,
        status: resp.status,
        error: new Error(`HTTP ${resp.status}`),
      };

      if (resp.status < 500 && resp.status !== 429) {
        return lastResult;
      }
    } catch (error) {
      lastResult = { ok: false, status: null, error };
    } finally {
      clearTimeout(timer);
    }

    if (attempt < MAX_RETRIES) {
      await sleep(200 * attempt);
    }
  }

  return lastResult;
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function simplifyTitle(value) {
  return normalizeText(
    String(value || "")
      .replace(/\[[^\]]*\]|\([^\)]*\)/g, " ")
      .replace(EDITION_MARKERS, " "),
  );
}

function getTokens(value) {
  return new Set(
    String(value || "")
      .split(" ")
      .map((part) => part.trim())
      .filter(Boolean),
  );
}

function tokenOverlap(left, right) {
  const leftTokens = getTokens(left);
  const rightTokens = getTokens(right);
  if (!leftTokens.size || !rightTokens.size) return 0;

  let matches = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) matches += 1;
  }

  return matches / Math.max(leftTokens.size, rightTokens.size);
}

function scoreField(actual, expected) {
  const actualExact = normalizeText(actual);
  const expectedExact = normalizeText(expected);
  if (!actualExact || !expectedExact) return 0;
  if (actualExact === expectedExact) return 100;

  const actualSimple = simplifyTitle(actual);
  const expectedSimple = simplifyTitle(expected);
  if (actualSimple && actualSimple === expectedSimple) return 85;
  if (actualExact.includes(expectedExact) || expectedExact.includes(actualExact)) return 65;

  return Math.round(tokenOverlap(actualSimple || actualExact, expectedSimple || expectedExact) * 50);
}

function scoreResult(result, artist, title) {
  const titleScore = scoreField(result.title, title);
  const artistScore = scoreField(result.artist, artist);
  return {
    titleScore,
    artistScore,
    totalScore: titleScore * 2 + artistScore + (titleScore > 0 && artistScore > 0 ? 25 : 0),
  };
}

function dedupeResults(results) {
  const seen = new Set();
  return results.filter((result) => {
    const key = `${result.store}|${result.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function rankResults(results, artist, title) {
  const ranked = dedupeResults(results)
    .map((result) => {
      const score = scoreResult(result, artist, title);
      return {
        ...result,
        _titleScore: score.titleScore,
        _artistScore: score.artistScore,
        _score: score.totalScore,
      };
    })
    .sort(
      (left, right) =>
        right._score - left._score ||
        left.title.length - right.title.length ||
        left.artist.length - right.artist.length,
    );

  const credible = ranked.filter(
    (result) =>
      result._titleScore > 0 &&
      result._artistScore > 0 &&
      result._score >= MIN_MATCH_SCORE,
  );

  return credible
    .slice(0, RESULT_LIMIT)
    .map(({ _titleScore, _artistScore, _score, ...result }) => result);
}

function buildQuery(artist, title) {
  return [artist, title]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(" ");
}

function toBandcampUrl(item) {
  if (!item) return null;
  if (item.item_url_path && /^https?:\/\//.test(item.item_url_path)) return item.item_url_path;
  if (item.item_url_root && item.item_url_path) {
    return `${item.item_url_root.replace(/\/$/, "")}/${String(item.item_url_path).replace(/^\//, "")}`;
  }
  return item.item_url_root || null;
}

function getQobuzAppIds() {
  return [...new Set([process.env.ROON_WISHLIST_QOBUZ_APP_ID, DEFAULT_QOBUZ_APP_ID, ...FALLBACK_QOBUZ_APP_IDS].filter(Boolean))];
}

async function searchBandcamp(artist, title) {
  const query = buildQuery(artist, title);
  if (!query) return [];

  const response = await requestJson(BANDCAMP_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      Origin: "https://bandcamp.com",
      Referer: "https://bandcamp.com/",
    },
    body: JSON.stringify({
      search_text: query,
      search_filter: "a",
      full_page: false,
      fan_id: null,
    }),
  });

  if (!response.ok) return [];

  const results = Array.isArray(response.data && response.data.auto && response.data.auto.results)
    ? response.data.auto.results
    : [];

  return rankResults(
    results
      .filter((item) => item && item.type === "a" && item.name && item.band_name && toBandcampUrl(item))
      .map((item) => ({
        store: "Bandcamp",
        title: item.name.trim(),
        artist: item.band_name.trim(),
        url: toBandcampUrl(item),
      })),
    artist,
    title,
  );
}

async function searchQobuz(artist, title) {
  const query = buildQuery(artist, title);
  if (!query) return [];

  let hadFailures = false;

  for (const appId of getQobuzAppIds()) {
    const response = await requestJson(QOBUZ_API_URL, {
      params: {
        query,
        limit: 25,
        offset: 0,
        app_id: appId,
      },
    });

    if (!response.ok) {
      hadFailures = true;
      continue;
    }

    const items =
      response.data &&
      response.data.albums &&
      Array.isArray(response.data.albums.items)
        ? response.data.albums.items
        : [];

    return rankResults(
      items
        .filter(
          (item) =>
            item &&
            item.title &&
            item.artist &&
            item.artist.name &&
            item.url &&
            item.purchasable !== false,
        )
        .map((item) => ({
          store: "Qobuz",
          title: String(item.title).trim(),
          artist: String(item.artist.name).trim(),
          url: /^https?:\/\//.test(item.url) ? item.url : `https://www.qobuz.com${item.url}`,
        })),
      artist,
      title,
    );
  }

  if (hadFailures) {
    console.warn("[search] Qobuz search failed for all configured app IDs.");
  }

  return [];
}

async function searchAll(artist, title) {
  const [bandcamp, qobuz] = await Promise.all([searchBandcamp(artist, title), searchQobuz(artist, title)]);
  return [...bandcamp, ...qobuz];
}

module.exports = { searchAll, searchBandcamp, searchQobuz };
