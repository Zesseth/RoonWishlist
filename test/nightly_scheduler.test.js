"use strict";

const assert = require("node:assert");
const { describe, it } = require("node:test");

const { isValidTime, computeNextRunAt, createScheduler } = require("../src/nightly_scheduler");

describe("isValidTime()", () => {
  it("accepts 24-hour HH:MM values", () => {
    assert.strictEqual(isValidTime("00:00"), true);
    assert.strictEqual(isValidTime("03:30"), true);
    assert.strictEqual(isValidTime("23:59"), true);
  });

  it("rejects 12-hour, out-of-range, and malformed values", () => {
    assert.strictEqual(isValidTime("24:00"), false);
    assert.strictEqual(isValidTime("9:00 PM"), false);
    assert.strictEqual(isValidTime("3:00"), false);
    assert.strictEqual(isValidTime(""), false);
    assert.strictEqual(isValidTime(null), false);
    assert.strictEqual(isValidTime(undefined), false);
  });
});

describe("computeNextRunAt()", () => {
  it("schedules later today when the time has not passed yet", () => {
    const now = new Date(2026, 0, 15, 10, 0, 0);
    const next = computeNextRunAt(now, "20:00");
    assert.strictEqual(next.getFullYear(), 2026);
    assert.strictEqual(next.getMonth(), 0);
    assert.strictEqual(next.getDate(), 15);
    assert.strictEqual(next.getHours(), 20);
    assert.strictEqual(next.getMinutes(), 0);
  });

  it("rolls over to tomorrow when the time has already passed today", () => {
    const now = new Date(2026, 0, 15, 22, 0, 0);
    const next = computeNextRunAt(now, "20:00");
    assert.strictEqual(next.getDate(), 16);
    assert.strictEqual(next.getHours(), 20);
  });

  it("rolls over to tomorrow when now is exactly the configured time", () => {
    const now = new Date(2026, 0, 15, 20, 0, 0);
    const next = computeNextRunAt(now, "20:00");
    assert.strictEqual(next.getDate(), 16);
  });

  it("returns null for an invalid time", () => {
    assert.strictEqual(computeNextRunAt(new Date(), "not-a-time"), null);
  });
});

describe("createScheduler()", () => {
  it("does not schedule anything when disabled", () => {
    const scheduler = createScheduler({
      getSettings: () => ({ enabled: false, time: "03:00" }),
      run: async () => {},
    });
    scheduler.start();
    assert.strictEqual(scheduler.getNextRunAt(), null);
    scheduler.stop();
  });

  it("does not schedule anything with an invalid time", () => {
    const scheduler = createScheduler({
      getSettings: () => ({ enabled: true, time: "bogus" }),
      run: async () => {},
    });
    scheduler.start();
    assert.strictEqual(scheduler.getNextRunAt(), null);
    scheduler.stop();
  });

  it("schedules the next run when enabled with a valid time", () => {
    const fixedNow = new Date(2026, 0, 15, 10, 0, 0);
    const scheduler = createScheduler({
      getSettings: () => ({ enabled: true, time: "20:00" }),
      run: async () => {},
      now: () => fixedNow,
    });
    scheduler.start();
    const next = scheduler.getNextRunAt();
    assert.ok(next);
    assert.strictEqual(next.getHours(), 20);
    scheduler.stop();
    assert.strictEqual(scheduler.getNextRunAt(), null);
  });

  it("reschedule() re-reads settings, so a settings change takes effect without a restart", () => {
    const fixedNow = new Date(2026, 0, 15, 10, 0, 0);
    let time = "20:00";
    const scheduler = createScheduler({
      getSettings: () => ({ enabled: true, time }),
      run: async () => {},
      now: () => fixedNow,
    });
    scheduler.start();
    assert.strictEqual(scheduler.getNextRunAt().getHours(), 20);

    time = "05:00";
    scheduler.reschedule();
    assert.strictEqual(scheduler.getNextRunAt().getHours(), 5);
    // 05:00 has already passed relative to fixedNow (10:00), so it rolls to tomorrow.
    assert.strictEqual(scheduler.getNextRunAt().getDate(), 16);
    scheduler.stop();
  });

  it("runs the task and reschedules for the following day", async () => {
    let calls = 0;
    // Advance the fake clock by a day once the task runs, otherwise the reschedule
    // that follows would see the same near-midnight "now" and fire again almost
    // immediately — an artifact of a fixed clock, not something that happens with the
    // real one.
    let current = new Date(2026, 0, 15, 23, 59, 59, 950);
    const scheduler = createScheduler({
      getSettings: () => ({ enabled: true, time: "00:00" }),
      run: async () => {
        calls += 1;
        // Jump the fake clock to noon the next day, not just +24h — landing near
        // midnight again would make the *next* scheduled delay tiny too, and it
        // would fire a second time within this test's short wait.
        const jumped = new Date(current.getTime() + 24 * 60 * 60 * 1000);
        jumped.setHours(12, 0, 0, 0);
        current = jumped;
      },
      now: () => current,
    });
    scheduler.start();
    // Delay is tiny (~50ms) because "now" sits just before midnight.
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.strictEqual(calls, 1);
    // A next run should have been scheduled again, a full day out this time.
    assert.ok(scheduler.getNextRunAt());
    scheduler.stop();
  });

  it("still reschedules for the next day when the task throws", async () => {
    let calls = 0;
    let current = new Date(2026, 0, 15, 23, 59, 59, 950);
    const scheduler = createScheduler({
      getSettings: () => ({ enabled: true, time: "00:00" }),
      run: async () => {
        calls += 1;
        const jumped = new Date(current.getTime() + 24 * 60 * 60 * 1000);
        jumped.setHours(12, 0, 0, 0);
        current = jumped;
        throw new Error("boom");
      },
      now: () => current,
    });
    scheduler.start();
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.strictEqual(calls, 1);
    assert.ok(scheduler.getNextRunAt());
    scheduler.stop();
  });
});
