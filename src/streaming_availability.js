"use strict";

const crypto = require("crypto");

/**
 * Streaming availability watch (issue #34, rescoped).
 *
 * The question is not "is my subscription valid" and not "does Roon think the tracks
 * are playable" — Roon does not expose playability to extensions (see
 * docs/ROON_API_LIMITATIONS.md) and Roon's own UI already shows unavailable tracks.
 * The question is: "is this album in any of the streaming catalogues I use right
 * now?" If it was streamable yesterday and is gone today while buy links still
 * exist, the user needs to buy it before it disappears everywhere.
 *
 * Two inputs:
 *  - which services are logged in, read from the Roon browse tree root (the SDK has
 *    no "list my services" call; the tree root is the only carrier, and it is
 *    version-dependent, so this is measured rather than assumed — see
 *    listStreamingServicesDetailed)
 *  - whether the album is in a service catalogue, asked from the services
 *    themselves (Qobuz public search today; the caller supplies probes)
 */

class StreamingError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.name = "StreamingError";
    this.statusCode = statusCode || 500;
  }
}

// Services Roon can integrate. Anything else in the browse root is ignored.
// Streaming-only services deliberately omit Bandcamp: Bandcamp is a store, not a
// subscription streaming catalogue, and purchase availability is already covered
// by buy links.
const KNOWN_STREAMING_SERVICES = new Set(["qobuz", "tidal", "kkbox", "deezer", "napster"]);

// What the browse root offers besides services: navigation entries every Roon
// install shows. A title that is not a known service and not one of these is
// still reported in the diagnostic, but not claimed as a service.
const NON_SERVICE_ROOT_TITLES = new Set([
  "library",
  "kirjasto",
  "playlists",
  "soittolistat",
  "artists",
  "artistit",
  "genres",
  "genret",
  "composers",
  "tags",
  "tagit",
  "settings",
  "internet radio",
  "radio",
  "live radio",
  "bookmarks",
  "history",
  "now playing",
  "search",
  "play queue",
  "navigator",
  "discover",
  "explore",
  "focus",
  "browse",
  "help",
]);

function normalizeTitle(value) {
  return String(value || "").trim().toLowerCase();
}

function browseAsync(browseService, opts) {
  return new Promise((resolve, reject) => {
    browseService.browse(opts, (err, body) => {
      if (err) reject(new StreamingError(`Roon browse failed: ${err}`, 502));
      else resolve(body || {});
    });
  });
}

function loadAsync(browseService, opts) {
  return new Promise((resolve, reject) => {
    browseService.load(opts, (err, body) => {
      if (err) reject(new StreamingError(`Roon browse load failed: ${err}`, 502));
      else resolve(body || {});
    });
  });
}

/**
 * Reads the Roon browse tree root and reports which streaming services it shows.
 *
 * The SDK registers no service-listing call, so the tree root — where Roon's own
 * UI shows logged-in services — is the only carrier. What it contains is
 * version-dependent, so this returns a diagnostic (every root item, what was
 * recognized, what was ignored) instead of a bare list, the same pattern as the
 * storage-location lookup in src/roon_storage.js: the answer must be evidence.
 */
async function listStreamingServicesDetailed(browseService) {
  if (!browseService) {
    return {
      services: [],
      diagnostic: {
        outcome: "not-paired",
        detail: "Not paired with Roon, so logged-in streaming services cannot be read yet.",
      },
    };
  }

  const sessionKey = `wishlist-streaming-services:${crypto.randomUUID()}`;
  const body = await browseAsync(browseService, {
    hierarchy: "browse",
    multi_session_key: sessionKey,
    pop_all: true,
  });

  if (body.action !== "list") {
    return {
      services: [],
      diagnostic: {
        outcome: "error",
        detail: `Roon browse root did not open as a list (action: ${body.action || "none"}).`,
      },
    };
  }

  const level = body.list && Number.isInteger(body.list.level) ? body.list.level : 0;
  const items = [];
  let offset = 0;
  let total = Number.POSITIVE_INFINITY;
  while (offset < total) {
    const loaded = await loadAsync(browseService, {
      hierarchy: "browse",
      multi_session_key: sessionKey,
      level,
      offset,
      count: 100,
    });
    const batch = Array.isArray(loaded.items) ? loaded.items : [];
    items.push(...batch);
    const count = loaded.list && typeof loaded.list.count === "number" ? loaded.list.count : null;
    total = count != null ? count : items.length;
    if (!batch.length) break;
    offset += batch.length;
  }

  const entries = items
    .filter((item) => item && item.item_key && item.hint !== "header")
    .map((item) => ({ title: String(item.title || "").trim() }));

  const services = [];
  for (const entry of entries) {
    const normalized = normalizeTitle(entry.title);
    if (!normalized) continue;
    for (const service of KNOWN_STREAMING_SERVICES) {
      if (normalized === service || normalized.startsWith(`${service} `)) {
        if (!services.includes(service)) services.push(service);
        break;
      }
    }
  }

  const unrecognized = entries
    .map((entry) => normalizeTitle(entry.title))
    .filter((title) => title && !KNOWN_STREAMING_SERVICES.has(title) && !NON_SERVICE_ROOT_TITLES.has(title));

  return {
    services,
    diagnostic: {
      outcome: services.length ? "ok" : "none-found",
      detail: services.length
        ? `Streaming services in the Roon browse root: ${services.join(", ")}.`
        : "No recognized streaming service in the Roon browse root. Known navigation entries were ignored; anything unrecognized is listed in rootTitles.",
      rootTitles: entries.map((entry) => entry.title),
      unrecognized,
    },
  };
}

/**
 * Normalizes a stored streaming state, or starts a fresh one.
 *
 * `lastSeenAt` is preserved across refreshes unless the album was just seen again;
 * it is what "recently disappeared" urgency is computed from.
 */
function nextStreamingState(previous, { available, services, checkedAt, error }) {
  const prev = previous && typeof previous === "object" ? previous : {};
  if (available === true) {
    return {
      available: true,
      services: (services || []).slice(),
      checkedAt,
      lastSeenAt: checkedAt,
    };
  }
  if (available === false) {
    return {
      available: false,
      services: [],
      checkedAt,
      ...(prev.lastSeenAt ? { lastSeenAt: prev.lastSeenAt } : {}),
    };
  }
  return {
    available: "unknown",
    services: (prev.services || []).slice(),
    checkedAt,
    ...(error ? { error } : {}),
    ...(prev.lastSeenAt ? { lastSeenAt: prev.lastSeenAt } : {}),
  };
}

/**
 * Checks every wishlist entry against the configured streaming catalogue probes.
 *
 * `probes` maps a service name (e.g. "qobuz") to
 * `async (artist, title) => boolean` — true meaning "in the catalogue now". The
 * probes are injected so tests can fake them; index.js wires the Qobuz public
 * search. Services with no probe contribute "unknown", not "unavailable": a
 * service we cannot ask must never be read as "the album is gone".
 *
 * `previousStates` maps the album key (`artist||title`, lowercased) to the entry's
 * stored streaming state, so an album that has never been seen streamable is not
 * flagged on its first failed check — a wishlist album may legitimately have
 * been added by hand and never streamed. Only a disappearance (seen before, gone
 * now) or a missing-from-all with no buy links gets flagged.
 */
async function checkStreamingAvailability({
  wishlist,
  probes,
  services,
  checkedAt = new Date().toISOString(),
}) {
  const probeEntries = Object.entries(probes || {}).filter(([name, fn]) => typeof fn === "function");
  if (!probeEntries.length) {
    return { status: "no-probes", checked: 0, flagged: [], unknown: 0 };
  }

  const activeServices = (services && services.length ? services : probeEntries.map(([name]) => name)).filter(
    (name) => probeEntries.some(([probeName]) => probeName === name),
  );
  if (!activeServices.length) {
    return { status: "no-probes", checked: 0, flagged: [], unknown: 0 };
  }

  const checked = [];
  const flagged = [];
  let unknown = 0;
  let errors = 0;

  for (const entry of wishlist.getAll()) {
    if (!entry || !entry.artist || !entry.title) continue;

    let sawAny = false;
    let sawError = false;
    const foundIn = [];
    for (const service of activeServices) {
      const probe = probeEntries.find(([name]) => name === service)[1];
      try {
        const inCatalogue = await probe(entry.artist, entry.title);
        if (inCatalogue) {
          sawAny = true;
          foundIn.push(service);
        }
      } catch {
        sawError = true;
        errors += 1;
      }
    }

    const available = sawAny ? true : sawError ? "unknown" : false;
    const state = nextStreamingState(entry.streaming, {
      available,
      services: foundIn,
      checkedAt,
      ...(available === "unknown" ? { error: "probe error" } : {}),
    });

    checked.push({ artist: entry.artist, title: entry.title });
    if (available === "unknown") unknown += 1;

    // A probe that could not answer must never be read as "the album is gone",
    // so "unknown" clears nothing and flags nothing.
    //
    // A first-ever "not found" is flagged only for roon-tag entries: an album tagged
    // in Roon is in the library, so "not in any catalogue" is a real signal there.
    // A hand-added or low-quality entry may simply never have been streamable, and
    // flaging those on first sight would cry wolf. A disappearance (seen streamable
    // before, gone now) is flagged regardless of source.
    const seenStreamableBefore = entry.streaming && entry.streaming.available === true;
    const flaggedNow =
      available === false && (seenStreamableBefore || entry.source === "roon-tag");
    if (flaggedNow) {
      const since = entry.streamUnavailableSince || checkedAt;
      wishlist.upsert({
        artist: entry.artist,
        title: entry.title,
        streaming: state,
        streamUnavailable: true,
        streamUnavailableSince: since,
      });
      flagged.push({
        artist: entry.artist,
        title: entry.title,
        lastSeenAt: state.lastSeenAt || null,
        since,
        buyable: hasBuyLinks(entry),
      });
    } else {
      wishlist.upsert({
        artist: entry.artist,
        title: entry.title,
        streaming: state,
        streamUnavailable: false,
        streamUnavailableSince: null,
      });
    }
  }

  return {
    status: "ok",
    services: activeServices,
    checked: checked.length,
    flagged,
    unknown,
    errors,
    checkedAt,
  };
}

function hasBuyLinks(entry) {
  return Array.isArray(entry && entry.buyLinks) && entry.buyLinks.length > 0;
}

module.exports = {
  KNOWN_STREAMING_SERVICES,
  StreamingError,
  listStreamingServicesDetailed,
  nextStreamingState,
  checkStreamingAvailability,
};
