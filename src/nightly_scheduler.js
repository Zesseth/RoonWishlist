"use strict";

let scheduledJob = null;
let isScheduling = false;

function getNextRunTime(hour, minute) {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0);
  
  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }
  
  return next;
}

function startScheduler(hour, minute, callback) {
  if (scheduledJob) {
    clearTimeout(scheduledJob);
  }

  if (typeof hour !== "number" || typeof minute !== "number" || typeof callback !== "function") {
    throw new Error("startScheduler requires hour (0-23), minute (0-59), and callback function");
  }

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error("Invalid hour (0-23) or minute (0-59)");
  }

  isScheduling = true;

  function schedule() {
    const nextRun = getNextRunTime(hour, minute);
    const delayMs = nextRun - new Date();

    console.log(`[scheduler] Next run scheduled for ${nextRun.toISOString()} (in ${Math.round(delayMs / 1000 / 60)} minutes)`);

    scheduledJob = setTimeout(() => {
      console.log(`[scheduler] Running scheduled task at ${new Date().toISOString()}`);
      try {
        callback();
      } catch (err) {
        console.error("[scheduler] Callback error:", err);
      }
      schedule();
    }, delayMs);
  }

  schedule();
}

function stopScheduler() {
  if (scheduledJob) {
    clearTimeout(scheduledJob);
    scheduledJob = null;
    isScheduling = false;
    console.log("[scheduler] Scheduler stopped");
  }
}

function isActive() {
  return isScheduling && scheduledJob !== null;
}

module.exports = {
  startScheduler,
  stopScheduler,
  isActive,
};
