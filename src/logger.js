"use strict";

// Minimal leveled logger (issue #8): readable, timestamped lines with no dependency,
// configurable via ROON_WISHLIST_LOG_LEVEL so it fits the same env-var pattern already
// used for the HTTP port/host and extension identity (see README "Environment variables").

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const DEFAULT_LEVEL = "info";

function normalizeLevel(value) {
  const lvl = String(value || "").toLowerCase().trim();
  return Object.prototype.hasOwnProperty.call(LEVELS, lvl) ? lvl : null;
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
 * Creates an independent logger. Exposed mainly for tests; the app uses the shared
 * `defaultLogger` below so every module logs at the same, single configured level.
 */
function createLogger({ level, now = () => new Date() } = {}) {
  let currentLevel = normalizeLevel(level) || DEFAULT_LEVEL;
  let invalidLevelWarning = null;

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
  }

  const logger = {
    error: (...args) => log("error", args),
    warn: (...args) => log("warn", args),
    info: (...args) => log("info", args),
    debug: (...args) => log("debug", args),
    setLevel,
    getLevel,
    levels: Object.keys(LEVELS),
  };

  // Surface a bad ROON_WISHLIST_LOG_LEVEL value instead of silently ignoring it.
  if (invalidLevelWarning) logger.warn(invalidLevelWarning);

  return logger;
}

// Single shared instance used across the app, configured once from the environment
// at startup. `setLevel` still works at runtime (e.g. from a future settings toggle).
const defaultLogger = createLogger({ level: process.env.ROON_WISHLIST_LOG_LEVEL });

module.exports = { createLogger, defaultLogger, LEVELS, normalizeLevel };
