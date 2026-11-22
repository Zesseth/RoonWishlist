"use strict";

const log = require("./logger").defaultLogger;
const { DEFAULT_COUNTRY, localeForCountry, normalizeCountry } = require("./qobuz_location");

const HTTP_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
};

// Storefront HTML pages answer a plain API client with 403; with document-ish
// headers they are served server-rendered (measured live: 200 with the embedded
// price data, 403 without).
const PAGE_HEADERS = {
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "sec-fetch-dest": "document",
  "sec-fetch-mode": "navigate",
  "sec-fetch-site": "none",
};

const BANDCAMP_API_URL = "https://bandcamp.com/api/bcsearch_public_api/1/autocomplete_elastic";
const BANDCAMP_MOBILE_API_URL = "https://bandcamp.com/api/mobile/24/tralbum_details";
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

async function requestText(url, options = {}) {
  const method = options.method || "GET";
  const finalUrl = buildUrl(url, options.params);
  const body = typeof options.body === "string" ? options.body : null;
  const cacheKey = `${method} ${finalUrl} ${body || ""}`;
  const cached = getCached(cacheKey);
  if (cached) {
    return { ok: true, text: cached, status: 200, cached: true };
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
        const text = await resp.text();
        setCached(cacheKey, text);
        return { ok: true, text, status: resp.status, cached: false };
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

async function requestJson(url, options = {}) {
  const result = await requestText(url, options);
  if (!result.ok) return result;
  try {
    return { ok: true, data: JSON.parse(result.text), status: result.status, cached: result.cached };
  } catch (error) {
    return { ok: false, status: result.status, error };
  }
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

// Strip only standalone edition marker words, keeping parenthetical/bracketed
// segments intact — unlike simplifyTitle, which removes those segments entirely.
// EDITION_MARKERS is case-sensitive, so lowercase first.
function stripEditionWords(value) {
  return String(value || "").toLowerCase().replace(EDITION_MARKERS, " ");
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

// The compact form — lowercase with every space and punctuation mark removed — is
// equal exactly when two names differ only in punctuation/spacing ("I.C.S. Vortex"
// vs the stores' "ICS Vortex", issue #78). It only ever *adds* matches and cannot
// conflate genuinely different names ("j.s. bach" does not compact-match "bach").
function compactForm(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

// Artist matching is deliberately stricter than title matching. Store results may
// name a different act that merely references the wishlist artist, e.g. Bandcamp
// cover/tribute/stem bands whose band name embeds the original artist
// ("Metallica (First to Eleven Stems)", "Metallica Tribute"). Arbitrary
// parenthetical segments and substring containment must not earn credit, or those
// results pass the credibility threshold as false positives.
function scoreArtistField(actual, expected) {
  const actualExact = normalizeText(actual);
  const expectedExact = normalizeText(expected);
  if (!actualExact || !expectedExact) return 0;
  if (actualExact === expectedExact) return 100;

  // Punctuation variants of one name are the same act, not a near miss: exact
  // credit, or the dotted spelling from Roon's metadata loses to the store's
  // undotted one on token overlap (measured: 13/100, below credibility — #78).
  const actualCompact = compactForm(actual);
  const expectedCompact = compactForm(expected);
  if (expectedCompact && actualCompact === expectedCompact) return 100;

  const actualSimple = normalizeText(stripEditionWords(actual));
  const expectedSimple = normalizeText(stripEditionWords(expected));
  if (actualSimple && actualSimple === expectedSimple) return 85;

  return Math.round(tokenOverlap(actualSimple || actualExact, expectedSimple || expectedExact) * 50);
}

function scoreResult(result, artist, title) {
  const titleScore = scoreField(result.title, title);
  const artistScore = scoreArtistField(result.artist, artist);
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

function stripEditionMarkers(value) {
  return String(value || "")
    .replace(/\[[^\]]*\]|\([^\)]*\)/g, " ")
    .replace(EDITION_MARKERS, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildQuery(artist, title) {
  const simplifiedTitle = stripEditionMarkers(title);
  const effectiveTitle = simplifiedTitle || String(title || "").trim();
  return [String(artist || "").trim(), effectiveTitle]
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

function unescapeHtmlAttribute(value) {
  return String(value)
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

// The schema.org JSON-LD blocks carry the offer's currency (priceCurrency) when
// data-tralbum does not spell it out.
function parseBandcampLdJsonCurrency(html) {
  const blocks = String(html || "").match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) || [];
  for (const block of blocks) {
    const inner = block
      .replace(/^<script type="application\/ld\+json">/, "")
      .replace(/<\/script>$/, "");
    let data;
    try {
      data = JSON.parse(inner);
    } catch {
      continue;
    }
    const entries = Array.isArray(data) ? data : [data];
    for (const entry of entries) {
      const offers = entry && entry.offers;
      const list = Array.isArray(offers) ? offers : offers ? [offers] : [];
      for (const offer of list) {
        if (offer && typeof offer.priceCurrency === "string" && offer.priceCurrency) {
          return offer.priceCurrency;
        }
      }
    }
  }
  return null;
}

// The tralbum payload (embedded in the album page's data-tralbum attribute, or
// returned by the mobile tralbum_details API) holds the digital album's price in
// `current`: set_price when the artist set a fixed price (is_set_price),
// otherwise minimum_price — the floor of a name-your-price release, still the
// store's own number. packages[] are physical editions (vinyl/CD), not the
// digital download this wishlist buys. Only store-provided values are returned.
function bandcampPriceFromTralbumData(data) {
  const current = data && data.current;
  if (!current || typeof current !== "object") return null;

  let price = null;
  if (typeof current.price === "number") price = current.price;
  else if (current.is_set_price && typeof current.set_price === "number") price = current.set_price;
  else if (typeof current.minimum_price === "number") price = current.minimum_price;
  else if (typeof current.set_price === "number") price = current.set_price;

  return {
    price: Number.isFinite(price) ? price : null,
    currency: typeof current.currency === "string" && current.currency ? current.currency : null,
  };
}

// Same payload, read out of the album page HTML (attribute value is HTML-escaped).
function parseBandcampTralbum(html) {
  const match = String(html || "").match(/data-tralbum="([^"]*)"/);
  if (!match) return null;
  let data;
  try {
    data = JSON.parse(unescapeHtmlAttribute(match[1]));
  } catch {
    return null;
  }
  const parsed = bandcampPriceFromTralbumData(data);
  if (!parsed) return null;
  if (!parsed.currency) parsed.currency = parseBandcampLdJsonCurrency(html);
  return parsed;
}

// The album page is the primary source; when Bandcamp answers with its bot
// challenge page instead (no data-tralbum), fall back to the mobile JSON API
// keyed by the album/band ids the autocomplete result already carried. Either
// way the price is the store's own value; any failure just means no price.
async function attachBandcampPrice(result) {
  if (!result || !result.url) return result;
  const next = { ...result };

  const resp = await requestText(result.url, { headers: PAGE_HEADERS });
  if (resp.ok) {
    const parsed = parseBandcampTralbum(resp.text);
    if (parsed && parsed.price !== null) {
      next.price = parsed.price;
      if (parsed.currency) next.currency = parsed.currency;
      return next;
    }
  }

  if (result._albumId && result._bandId) {
    const api = await requestJson(BANDCAMP_MOBILE_API_URL, {
      params: { band_id: result._bandId, album_id: result._albumId },
    });
    if (api.ok) {
      const parsed = bandcampPriceFromTralbumData(api.data);
      if (parsed && parsed.price !== null) {
        next.price = parsed.price;
        if (parsed.currency && !next.currency) next.currency = parsed.currency;
      }
    }
  }
  return next;
}

function qobuzQualityLabel(bitDepth, samplingRate) {
  if (Number.isFinite(bitDepth) && Number.isFinite(samplingRate) && bitDepth > 0 && samplingRate > 0) {
    return `${bitDepth}-bit/${samplingRate} kHz`;
  }
  return null;
}

// Price straight from a Qobuz album object (an album/search item or an album/get
// response), in the storefront of the requested country. Only store-provided
// values are ever returned. When the payload offers several tiers — a per-format
// `formats` list, or a separate `hires_price` — the Hi-Res tier wins, because
// that is the edition this wishlist exists to buy; otherwise the album's single
// `price` is used. No price in the payload -> null (never an estimate).
function qobuzPriceFromAlbum(album) {
  if (!album || typeof album !== "object") return null;

  let price = null;
  let currency = typeof album.currency === "string" && album.currency ? album.currency : null;
  let displayPrice = typeof album.display_price === "string" && album.display_price ? album.display_price : null;
  let quality = null;

  if (Array.isArray(album.formats) && album.formats.length) {
    const offers = album.formats.filter((f) => f && Number.isFinite(f.price));
    if (offers.length) {
      offers.sort(
        (a, b) =>
          (b.maximum_bit_depth || 0) - (a.maximum_bit_depth || 0) ||
          (b.maximum_sampling_rate || 0) - (a.maximum_sampling_rate || 0),
      );
      const best = offers[0];
      price = best.price;
      quality = qobuzQualityLabel(best.maximum_bit_depth, best.maximum_sampling_rate);
      if (typeof best.currency === "string" && best.currency) currency = best.currency;
      if (typeof best.display_price === "string" && best.display_price) displayPrice = best.display_price;
    }
  }
  if (price === null && album.hires === true && Number.isFinite(album.hires_price)) {
    price = album.hires_price;
    quality = qobuzQualityLabel(album.maximum_bit_depth, album.maximum_sampling_rate);
  }
  if (price === null && Number.isFinite(album.price)) {
    price = album.price;
    quality = qobuzQualityLabel(album.maximum_bit_depth, album.maximum_sampling_rate);
  }
  if (price === null) return null;
  return { price, currency, displayPrice, quality };
}

// The public api.json payloads carry no price (measured live: neither album/search
// items nor album/get have price fields), but the localized storefront page embeds
// the album's listed price as schema.org JSON-LD: a Product/MusicAlbum entry whose
// offers carry price (number) and priceCurrency — in the currency of the storefront
// in the URL's locale, i.e. the configured country (fi-en -> EUR). When several
// offers are present, the highest numeric price wins: that is the Hi-Res tier,
// which costs more than CD quality and is the edition this wishlist buys.
function parseQobuzPagePrice(html) {
  const blocks = String(html || "").match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) || [];
  let price = null;
  let currency = null;
  for (const block of blocks) {
    const inner = block
      .replace(/^<script type="application\/ld\+json">/, "")
      .replace(/<\/script>$/, "");
    let data;
    try {
      data = JSON.parse(inner);
    } catch {
      continue;
    }
    const entries = Array.isArray(data) ? data : [data];
    for (const entry of entries) {
      if (!entry || !/^(Product|MusicAlbum)$/i.test(String(entry["@type"] || ""))) continue;
      const offers = entry.offers;
      const list = Array.isArray(offers) ? offers : offers ? [offers] : [];
      for (const offer of list) {
        const value = Number(offer && offer.price);
        if (!Number.isFinite(value)) continue;
        if (price === null || value > price) price = value;
        if (!currency && typeof offer.priceCurrency === "string" && offer.priceCurrency) {
          currency = offer.priceCurrency;
        }
      }
    }
  }
  return price === null ? null : { price, currency };
}

// A result without a price from the search item gets one fetch of its own
// localized store page (cached). Failure just means no price, never a guess.
async function attachQobuzPrice(result) {
  if (!result || !result.url) return result;
  const next = { ...result };
  if (next.price === undefined) {
    const resp = await requestText(result.url, { headers: PAGE_HEADERS });
    if (resp.ok) {
      const parsed = parseQobuzPagePrice(resp.text);
      if (parsed) {
        next.price = parsed.price;
        if (parsed.currency) next.currency = parsed.currency;
      }
    }
  }
  if (next.price !== undefined && !next.quality) {
    next.quality = qobuzQualityLabel(result._bit, result._sr);
  }
  return next;
}

// Punctuation can zero out Bandcamp's autocomplete at the query level: measured,
// "I.C.S. Vortex" finds nothing while "ICS Vortex" finds the album (issue #78).
// Periods and commas are removed outright (initials stay glued: "I.C.S." ->
// "ICS"); anything else non-alphanumeric becomes a space.
function stripPunctuation(value) {
  return String(value || "")
    .replace(/[.,]/g, "")
    .replace(/[^a-zA-Z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function bandcampRanked(query, artist, title) {
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
        // Helper ids for the mobile-API price fallback; stripped before returning.
        _albumId: item.id,
        _bandId: item.band_id,
      })),
    artist,
    title,
  );
}

async function searchBandcamp(artist, title) {
  const query = buildQuery(artist, title);
  if (!query) return [];

  let ranked = await bandcampRanked(query, artist, title);
  if (!ranked.length) {
    // One retry with the punctuation stripped, then give up: an empty first
    // answer is usually either this exact failure or an album that is not there.
    const fallbackQuery = buildQuery(stripPunctuation(artist), stripPunctuation(title));
    if (fallbackQuery && fallbackQuery !== query) {
      ranked = await bandcampRanked(fallbackQuery, artist, title);
    }
  }
  // The autocomplete response carries no price, so each found link gets its own
  // price lookup (album page, mobile-API fallback; both cached).
  const withPrices = await Promise.all(ranked.map((result) => attachBandcampPrice(result)));
  return withPrices.map(({ _albumId, _bandId, ...result }) => result);
}

async function searchQobuz(artist, title, country = DEFAULT_COUNTRY) {
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
        country: normalizeCountry(country) || DEFAULT_COUNTRY,
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

    const mapped = items
      .filter(
        (item) =>
          item &&
          item.title &&
          item.artist &&
          item.artist.name &&
          item.url &&
          item.purchasable !== false,
      )
      .map((item) => {
        const result = {
          store: "Qobuz",
          title: String(item.title).trim(),
          artist: String(item.artist.name).trim(),
          url: localizeQobuzUrl(
            /^https?:\/\//.test(item.url) ? item.url : `https://www.qobuz.com${item.url}`,
            country,
          ),
        };
        // Price straight from the search item when the payload carries one;
        // attachQobuzPrice below reads it off the store page otherwise.
        const info = qobuzPriceFromAlbum(item);
        if (info) Object.assign(result, info);
        // Helper fields for edition/price selection; stripped before returning.
        result._hires = item.hires === true;
        result._bit = item.maximum_bit_depth;
        result._sr = item.maximum_sampling_rate;
        return result;
      });

    const ranked = rankResults(mapped, artist, title);
    if (!ranked.length) return [];

    // Qobuz lists each quality as its own purchasable album entry. When several
    // editions match, the Hi-Res one wins — both for the link and the price —
    // because that is the download this wishlist exists to buy (issue #48).
    const credible = mapped.filter((result) => {
      const score = scoreResult(result, artist, title);
      return score.titleScore > 0 && score.artistScore > 0 && score.totalScore >= MIN_MATCH_SCORE;
    });
    const hiresOffers = credible.filter((result) => result._hires);
    hiresOffers.sort(
      (a, b) => (b._bit || 0) - (a._bit || 0) || (b._sr || 0) - (a._sr || 0),
    );
    const chosen = hiresOffers.length ? hiresOffers[0] : ranked[0];

    const withPrice = await attachQobuzPrice(chosen);
    const { _hires, _bit, _sr, ...clean } = withPrice;
    return [clean];
  }

  if (hadFailures) {
    log.warn("[search] Qobuz search failed for all configured app IDs.");
  }

  return [];
}

/**
 * Decides catalogue availability from Qobuz album/search result items.
 *
 * Measured live (issue #34): the public album/search payload carries explicit
 * `streamable` and `purchasable` flags on every album. A credible match that
 * Qobuz itself marks `streamable: false` is a purchase-only release — in the
 * catalogue, but not streamable anywhere — which is exactly the "buy it before
 * it is gone everywhere" state, so it must not count as available. A payload
 * without the flag (older builds, cached shapes) falls back to catalogue
 * existence, the pre-measurement semantics.
 *
 * Exported so the decision can be tested against captured payloads without
 * depending on Qobuz being reachable.
 */
function availableOnQobuz(items, artist, title) {
  const ranked = rankResults(
    (Array.isArray(items) ? items : [])
      .filter((item) => item && item.title && item.artist && item.artist.name)
      .map((item) => ({
        store: "Qobuz",
        title: String(item.title).trim(),
        artist: String(item.artist.name).trim(),
        // Dedupe key only, never surfaced: every result must carry its own URL or
        // the album id, because rankResults dedupes on store|url — one shared
        // placeholder collapsed the whole result set to its first item and hid
        // the wanted album whenever it was not the top result (measured live:
        // Machinae Supremacy's self-titled album answered "not available" while
        // sitting streamable at result #6).
        url:
          /^https?:\/\//.test(item.url || "")
            ? item.url
            : `https://www.qobuz.com${item.url || `/album/${item.id || ""}`}`,
        streamable: item.streamable,
      })),
    artist,
    title,
  );
  return ranked.length > 0 && ranked[0].streamable !== false;
}

/**
 * Is the album in Qobuz's streaming catalogue right now? (issue #34)
 *
 * Deliberately looser than searchQobuz: that function also requires `purchasable`
 * and returns at most RESULT_LIMIT links, because its job is a credible buy link.
 * This one asks whether the album is streamable at all, so no purchase filter and
 * the explicit `streamable` flag decide — an album that stopped being purchasable
 * but is still streamable must count as available, and a purchase-only release
 * must not. The same scoring machinery (rankResults) stays in use so a different
 * act's similarly-titled album cannot satisfy the probe on its own.
 */
async function isOnQobuz(artist, title, country = DEFAULT_COUNTRY) {
  const query = buildQuery(artist, title);
  if (!query) return null;
  for (const appId of getQobuzAppIds()) {
    const response = await requestJson(QOBUZ_API_URL, {
      params: {
        query,
        limit: 25,
        offset: 0,
        app_id: appId,
        country: normalizeCountry(country) || DEFAULT_COUNTRY,
      },
    });
    if (!response.ok) continue;
    const items =
      response.data &&
      response.data.albums &&
      Array.isArray(response.data.albums.items)
        ? response.data.albums.items
        : [];
    return availableOnQobuz(items, artist, title);
  }
  return null;
}

async function searchAll(artist, title, country = DEFAULT_COUNTRY) {
  const [bandcamp, qobuz] = await Promise.all([
    searchBandcamp(artist, title),
    searchQobuz(artist, title, country),
  ]);
  return [...bandcamp, ...qobuz];
}

function localizeQobuzUrl(url, country) {
  const locale = localeForCountry(country);
  return String(url).replace(/(https?:\/\/www\.qobuz\.com\/)[a-z]{2}-[a-z]{2}(?=\/)/i, `$1${locale}`);
}

module.exports = {
  searchAll,
  searchBandcamp,
  searchQobuz,
  isOnQobuz,
  availableOnQobuz,
  localizeQobuzUrl,
  buildQuery,
  rankResults,
  parseBandcampTralbum,
  bandcampPriceFromTralbumData,
  parseQobuzPagePrice,
  qobuzPriceFromAlbum,
};
