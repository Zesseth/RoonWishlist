"use strict";

/**
 * In-process nightly scheduler (issue #2).
 *
 * A separate system scheduler (cron, systemd timer) is not needed for v1 — a single
 * `setTimeout` that always points at the next configured run is enough, and it is
 * recomputed whenever settings change so an edit takes effect without restarting the
 * extension (a hard requirement of #2).
 */

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** 24-hour "HH:MM" as required by #2 — no AM/PM, no free text. */
function isValidTime(value) {
  return typeof value === "string" && TIME_PATTERN.test(value);
}

function parseTime(value) {
  const match = TIME_PATTERN.exec(value);
  if (!match) return null;
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

/**
 * The next Date at or after `now` that lands on `time` ("HH:MM") local time. If that
 * time has already passed today, the run moves to tomorrow — this never schedules into
 * the past, and never skips a day.
 */
function computeNextRunAt(now, time) {
  const parsed = parseTime(time);
  if (!parsed) return null;
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), parsed.hour, parsed.minute, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  return next;
}

/**
 * Creates a scheduler that calls `run()` once per day at the time reported by
 * `getSettings()`. Settings are re-read on every (re)schedule rather than captured
 * once, so calling `reschedule()` after a settings change is all that is needed —
 * no restart required, per #2.
 *
 * A single long `setTimeout` (rather than `setInterval`) is used because the delay to
 * the next run varies day to day (DST, or a settings change mid-wait), and because it
 * lets `reschedule()` cleanly cancel and replace whatever is pending.
 */
function createScheduler({ getSettings, run, now = () => new Date() }) {
  let timer = null;
  let nextRunAt = null;

  function clear() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    nextRunAt = null;
  }

  function scheduleNext() {
    clear();
    const settings = getSettings() || {};
    if (!settings.enabled || !isValidTime(settings.time)) return;

    const target = computeNextRunAt(now(), settings.time);
    if (!target) return;
    nextRunAt = target;

    // setTimeout's max delay (~24.8 days, 32-bit signed ms) comfortably covers a
    // one-day wait, so no chunking is needed here.
    const delay = Math.max(0, target.getTime() - now().getTime());
    timer = setTimeout(() => {
      Promise.resolve()
        .then(run)
        .catch(() => {})
        .then(() => {
          // Always reschedule the following day, even if the run threw.
          scheduleNext();
        });
    }, delay);
    // Don't let a pending nightly run keep the process alive by itself.
    if (timer && typeof timer.unref === "function") timer.unref();
  }

  return {
    start: scheduleNext,
    reschedule: scheduleNext,
    stop: clear,
    getNextRunAt: () => nextRunAt,
  };
}

module.exports = {
  isValidTime,
  computeNextRunAt,
  createScheduler,
};
