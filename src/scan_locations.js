"use strict";

/**
 * Resolves which folders the library scan should actually walk.
 *
 * Roon knows where the music lives, so the user should not have to type a path by
 * hand. In practice Roon's Browse API is not guaranteed to expose storage folders on
 * every version or setup, so this module blends three inputs:
 *
 *   1. storage locations reported by Roon (best case, zero configuration)
 *   2. the manual `music_library_path` override, which always wins as a fallback
 *   3. a user-maintained exclusion list, so an unwanted location can be opted out
 *
 * See issue #15.
 */

const fsp = require("fs/promises");
const path = require("path");

/**
 * Roon returns display strings, not necessarily filesystem paths — a location may be
 * rendered as "My NAS (SMB)" with no usable path at all. Only entries that look like
 * a real absolute path are worth handing to the scanner.
 */
function looksLikeFilesystemPath(value) {
  const candidate = String(value || "").trim();
  if (!candidate) return false;
  if (candidate.startsWith("/")) return true;
  if (/^[A-Za-z]:[\\/]/.test(candidate)) return true;
  if (candidate.startsWith("\\\\")) return true;
  return false;
}

function canonicalize(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  return path.resolve(trimmed);
}

/**
 * The manual override is the fallback for setups where Roon does not report storage
 * over the API. If it only accepted a single folder, those users would be locked out
 * of multi-location scanning entirely — which is the whole point of issue #15. So the
 * override accepts several paths separated by a newline or a semicolon.
 *
 * Comma is deliberately *not* a separator: it is a legal character in a directory
 * name, and splitting on it would silently break libraries such as
 * "/music/Crosby, Stills & Nash".
 */
function splitManualPaths(value) {
  return String(value || "")
    .split(/[\n;]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/**
 * Extracts usable filesystem paths from whatever `getStorageLocations()` returned.
 * Roon puts the path in `subtitle` on some versions and in `title` on others, so both
 * are considered and the first plausible one wins.
 */
function extractRoonPaths(roonLocations) {
  const list = Array.isArray(roonLocations) ? roonLocations : [];
  const extracted = [];

  for (const entry of list) {
    if (!entry) continue;
    if (typeof entry === "string") {
      if (looksLikeFilesystemPath(entry)) extracted.push({ path: entry.trim(), title: entry.trim() });
      continue;
    }

    const candidates = [entry.path, entry.subtitle, entry.title];
    const usable = candidates.find(looksLikeFilesystemPath);
    if (!usable) continue;

    extracted.push({
      path: String(usable).trim(),
      title: String(entry.title || usable).trim(),
    });
  }

  return extracted;
}

function isExcluded(candidatePath, excludedSet) {
  return excludedSet.has(canonicalize(candidatePath));
}

/**
 * Builds the full picture of scan locations: every known location, where it came
 * from, whether it is excluded, and the resulting active list.
 *
 * The manual path is listed last but is never dropped for being a duplicate of a Roon
 * location — instead the existing entry is marked as coming from both sources, so the
 * settings UI can explain why a folder is being scanned.
 *
 * @param {Object} options
 * @param {Array} [options.roonLocations] Raw output of `getStorageLocations()`.
 * @param {string} [options.manualPath] The `music_library_path` override.
 * @param {string[]} [options.excluded] Paths the user opted out of.
 * @returns {{locations: Array, active: string[], excluded: string[], usedFallback: boolean}}
 */
function resolveScanLocations({ roonLocations, manualPath, excluded } = {}) {
  const excludedList = (Array.isArray(excluded) ? excluded : [])
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  const excludedSet = new Set(excludedList.map(canonicalize));

  const locations = [];
  const byCanonical = new Map();

  const register = (entry) => {
    const key = canonicalize(entry.path);
    if (!key) return;

    const existing = byCanonical.get(key);
    if (existing) {
      if (!existing.sources.includes(entry.source)) existing.sources.push(entry.source);
      if (!existing.title && entry.title) existing.title = entry.title;
      return;
    }

    const record = {
      path: entry.path,
      canonicalPath: key,
      title: entry.title || entry.path,
      sources: [entry.source],
      excluded: excludedSet.has(key),
    };
    byCanonical.set(key, record);
    locations.push(record);
  };

  for (const roon of extractRoonPaths(roonLocations)) {
    register({ path: roon.path, title: roon.title, source: "roon" });
  }

  const manual = splitManualPaths(manualPath);
  for (const entry of manual) {
    register({ path: entry, title: entry, source: "manual" });
  }

  const active = locations.filter((entry) => !entry.excluded).map((entry) => entry.path);

  return {
    locations,
    active,
    excluded: locations.filter((entry) => entry.excluded).map((entry) => entry.path),
    // True when Roon told us nothing usable and we are relying on the typed path.
    usedFallback: !extractRoonPaths(roonLocations).length && manual.length > 0,
  };
}

/**
 * Confirms each location is a readable directory. A path that Roon reports but that
 * this process cannot read (permissions, an unmounted network share) must not silently
 * count as "no albums found" — that would make the clean step think nothing is owned.
 */
async function validateLocations(paths) {
  const list = Array.isArray(paths) ? paths : [paths];
  const usable = [];
  const unreadable = [];

  for (const entry of list) {
    const candidate = String(entry || "").trim();
    if (!candidate) continue;
    try {
      const stats = await fsp.stat(candidate);
      if (!stats.isDirectory()) {
        unreadable.push({ path: candidate, reason: "Not a directory" });
        continue;
      }
      await fsp.access(candidate);
      usable.push(candidate);
    } catch (err) {
      unreadable.push({ path: candidate, reason: err.code === "ENOENT" ? "Does not exist" : err.message });
    }
  }

  return { usable, unreadable };
}

/**
 * Adds or removes a path from the exclusion list, returning a new array. Comparison is
 * done on the canonical path so "/music" and "/music/" are the same location.
 */
function toggleExclusion(excluded, targetPath, shouldExclude) {
  const current = (Array.isArray(excluded) ? excluded : []).filter(Boolean);
  const key = canonicalize(targetPath);
  if (!key) return current;

  const without = current.filter((entry) => canonicalize(entry) !== key);
  if (!shouldExclude) return without;

  const value = String(targetPath).trim();
  return [...without, value];
}

module.exports = {
  canonicalize,
  extractRoonPaths,
  isExcluded,
  looksLikeFilesystemPath,
  resolveScanLocations,
  splitManualPaths,
  toggleExclusion,
  validateLocations,
};
