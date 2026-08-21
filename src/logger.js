"use strict";

// Minimal leveled logger (issue #8): readable, timestamped lines with no dependency,
// configurable via ROON_WISHLIST_LOG_LEVEL so it fits the same env-var pattern already
// used for the HTTP port/host and extension identity (see README "Environment variables").
//
// File logging + max size (issue #8 follow-up): console/journal output has no size cap
// of its own (systemd/journald manage that separately), so a bounded log *file* is
// opt-in and wired up by index.js only — requiring this module never touches disk by
// itself, which keeps every other module/test that just wants console logging free of
// side effects. See createFileSink() below for the size cap and trimming.

const fs = require("fs");
const path = require("path");

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const DEFAULT_LEVEL = "info";
const MB = 1024 * 1024;
const DEFAULT_MAX_SIZE_MB = 100;
const DEFAULT_DATA_DIR = process.env.ROON_WISHLIST_DATA_DIR || path.join(__dirname, "..", "data");
const DEFAULT_LOG_FILE = path.join(DEFAULT_DATA_DIR, "roon-wishlist.log");

function normalizeLevel(value) {
  const lvl = String(value || "").toLowerCase().trim();
  return Object.prototype.hasOwnProperty.call(LEVELS, lvl) ? lvl : null;
}

// Accepts a positive, finite number of megabytes (fractional is fine, e.g. "0.5").
// Anything else (missing, zero, negative, NaN, garbage string) is invalid.
function normalizeMaxSizeMb(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function stringifyArg(value) {
  if (value instanceof Error) return value.stack || value.message;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * A single bounded log file: appends lines, and once the file exceeds `maxSizeMb` it
 * is trimmed back down by dropping the *oldest* content and keeping the newest half,
 * cut on a line boundary so the file never starts mid-line.
 *
 * Kept as one plain file rather than a `.log` + `.log.1` rotation pair on purpose: it
 * is simpler to reason about ("the file is never bigger than the configured max"), and
 * this is a low-volume log for a background extension, not a high-throughput service.
 */
function createFileSink({ filePath = DEFAULT_LOG_FILE, maxSizeMb = DEFAULT_MAX_SIZE_MB, fsImpl = fs } = {}) {
  let maxBytes = Math.round((normalizeMaxSizeMb(maxSizeMb) || DEFAULT_MAX_SIZE_MB) * MB);
  // Track size ourselves instead of stat-ing on every write: this is the only writer
  // of this file (single process), so a running counter seeded from the real size at
  // startup stays accurate without an extra syscall per log line.
  let currentSize = 0;
  try {
    currentSize = fsImpl.statSync(filePath).size;
  } catch {
    currentSize = 0;
  }

  function rotateIfNeeded() {
    if (currentSize <= maxBytes) return;
    let content;
    try {
      content = fsImpl.readFileSync(filePath, "utf8");
    } catch {
      currentSize = 0;
      return;
    }
    const keepBytes = Math.max(0, Math.floor(maxBytes / 2));
    const totalBytes = Buffer.byteLength(content, "utf8");
    let cut = Math.max(0, totalBytes - keepBytes);
    // Cutting mid-line would leave a garbled fragment at the top of the trimmed file;
    // advance to just after the next newline so every remaining line is whole.
    const nl = content.indexOf("\n", cut);
    const sliceStart = nl !== -1 ? nl + 1 : content.length;
    const trimmed = content.slice(sliceStart);
    try {
      fsImpl.mkdirSync(path.dirname(filePath), { recursive: true });
      fsImpl.writeFileSync(filePath, trimmed, "utf8");
      currentSize = Buffer.byteLength(trimmed, "utf8");
    } catch {
      // Best-effort: if trimming fails (e.g. permissions), leave the file as-is rather
      // than lose log lines or crash the process over housekeeping.
    }
  }

  function write(line) {
    const withNewline = line + "\n";
    try {
      fsImpl.mkdirSync(path.dirname(filePath), { recursive: true });
      fsImpl.appendFileSync(filePath, withNewline, "utf8");
      currentSize += Buffer.byteLength(withNewline, "utf8");
    } catch {
      return; // Best-effort: console/journal output already happened regardless.
    }
    rotateIfNeeded();
  }

  return {
    write,
    getFilePath: () => filePath,
    getMaxSizeMb: () => maxBytes / MB,
    setMaxSizeMb: (next) => {
      const normalized = normalizeMaxSizeMb(next);
      if (normalized) {
        maxBytes = Math.round(normalized * MB);
        rotateIfNeeded();
      }
      return maxBytes / MB;
    },
    // Test/inspection hook; not used by the app itself.
    getCurrentSizeBytes: () => currentSize,
  };
}

/**
 * Creates an independent logger. Exposed mainly for tests; the app uses the shared
 * `defaultLogger` below so every module logs at the same, single configured level.
 */
function createLogger({ level, now = () => new Date(), fileSink = null } = {}) {
  let currentLevel = normalizeLevel(level) || DEFAULT_LEVEL;
  let invalidLevelWarning = null;
  let sink = fileSink;

  if (level !== undefined && !normalizeLevel(level)) {
    invalidLevelWarning = `Invalid log level "${level}" — falling back to "${DEFAULT_LEVEL}". ` +
      `Valid levels: ${Object.keys(LEVELS).join(", ")}.`;
  }

  function setLevel(next) {
    const normalized = normalizeLevel(next);
    if (normalized) currentLevel = normalized;
    return currentLevel;
  }

  function getLevel() {
    return currentLevel;
  }

  function shouldLog(level) {
    return LEVELS[level] <= LEVELS[currentLevel];
  }

  function format(level, args) {
    const ts = now().toISOString();
    const message = args.map(stringifyArg).join(" ");
    return `[${ts}] ${level.toUpperCase().padEnd(5)} ${message}`;
  }

  function log(level, args) {
    if (!shouldLog(level)) return;
    const line = format(level, args);
    const target = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
    target(line);
    // File logging mirrors exactly what reached the console — same level filter, same
    // formatted line — so the file is never more verbose than what an operator already
    // sees live, and "readable" applies equally to both (issue #8).
    if (sink) sink.write(line);
  }

  const logger = {
    error: (...args) => log("error", args),
    warn: (...args) => log("warn", args),
    info: (...args) => log("info", args),
    debug: (...args) => log("debug", args),
    setLevel,
    getLevel,
    levels: Object.keys(LEVELS),
    attachFileSink: (next) => { sink = next; },
    getFileSink: () => sink,
  };

  // Surface a bad ROON_WISHLIST_LOG_LEVEL value instead of silently ignoring it.
  if (invalidLevelWarning) logger.warn(invalidLevelWarning);

  return logger;
}

// Single shared instance used across the app, configured once from the environment
// at startup. `setLevel` still works at runtime (e.g. from a future settings toggle).
// No file sink is attached here — requiring this module must never write to disk as a
// side effect (every other module just wants console logging). index.js attaches the
// real file sink once, at startup, via `defaultLogger.attachFileSink(...)`.
const defaultLogger = createLogger({ level: process.env.ROON_WISHLIST_LOG_LEVEL });

module.exports = {
  createLogger,
  defaultLogger,
  createFileSink,
  LEVELS,
  normalizeLevel,
  normalizeMaxSizeMb,
  DEFAULT_MAX_SIZE_MB,
  DEFAULT_LOG_FILE,
};

