"use strict";

const { test, describe, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { createLogger, LEVELS, normalizeLevel } = require("../src/logger");

describe("logger", () => {
  let originalLog, originalWarn, originalError;
  let logCalls, warnCalls, errorCalls;

  beforeEach(() => {
    logCalls = [];
    warnCalls = [];
    errorCalls = [];
    originalLog = console.log;
    originalWarn = console.warn;
    originalError = console.error;
    console.log = (...args) => logCalls.push(args.join(" "));
    console.warn = (...args) => warnCalls.push(args.join(" "));
    console.error = (...args) => errorCalls.push(args.join(" "));
  });

  afterEach(() => {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  });

  describe("normalizeLevel()", () => {
    test("accepts known levels case-insensitively", () => {
      assert.equal(normalizeLevel("INFO"), "info");
      assert.equal(normalizeLevel(" debug "), "debug");
      assert.equal(normalizeLevel("warn"), "warn");
    });

    test("rejects unknown values", () => {
      assert.equal(normalizeLevel("verbose"), null);
      assert.equal(normalizeLevel(""), null);
      assert.equal(normalizeLevel(undefined), null);
    });
  });

  describe("createLogger()", () => {
    test("defaults to info level", () => {
      const logger = createLogger();
      assert.equal(logger.getLevel(), "info");
    });

    test("falls back to info and warns once on an invalid configured level", () => {
      const logger = createLogger({ level: "verbose" });
      assert.equal(logger.getLevel(), "info");
      assert.equal(warnCalls.length, 1);
      assert.match(warnCalls[0], /Invalid log level "verbose"/);
    });

    test("respects an explicit valid level", () => {
      const logger = createLogger({ level: "debug" });
      assert.equal(logger.getLevel(), "debug");
    });

    test("info level suppresses debug messages", () => {
      const logger = createLogger({ level: "info" });
      logger.debug("should not appear");
      logger.info("should appear");
      assert.equal(logCalls.length, 1);
      assert.match(logCalls[0], /should appear/);
    });

    test("error level suppresses warn/info/debug", () => {
      const logger = createLogger({ level: "error" });
      logger.warn("nope");
      logger.info("nope");
      logger.debug("nope");
      logger.error("yes");
      assert.equal(warnCalls.length, 0);
      assert.equal(logCalls.length, 0);
      assert.equal(errorCalls.length, 1);
    });

    test("debug level allows everything through", () => {
      const logger = createLogger({ level: "debug" });
      logger.error("a");
      logger.warn("b");
      logger.info("c");
      logger.debug("d");
      assert.equal(errorCalls.length, 1);
      assert.equal(warnCalls.length, 1);
      assert.equal(logCalls.length, 2); // info + debug both go through console.log
    });

    test("setLevel() changes the active threshold at runtime", () => {
      const logger = createLogger({ level: "error" });
      logger.info("suppressed");
      assert.equal(logCalls.length, 0);

      logger.setLevel("info");
      logger.info("now visible");
      assert.equal(logCalls.length, 1);
    });

    test("setLevel() with an invalid value keeps the previous level", () => {
      const logger = createLogger({ level: "warn" });
      const result = logger.setLevel("nonsense");
      assert.equal(result, "warn");
      assert.equal(logger.getLevel(), "warn");
    });

    test("messages are prefixed with an ISO timestamp and uppercase level", () => {
      const fixedNow = () => new Date("2026-01-02T03:04:05.000Z");
      const logger = createLogger({ level: "debug", now: fixedNow });
      logger.info("hello");
      assert.equal(logCalls.length, 1);
      assert.match(logCalls[0], /^\[2026-01-02T03:04:05\.000Z\] INFO\s+hello$/);
    });

    test("Error objects are logged with their stack, not [object Object]", () => {
      const logger = createLogger({ level: "debug" });
      logger.error("boom:", new Error("kaboom"));
      assert.equal(errorCalls.length, 1);
      assert.match(errorCalls[0], /kaboom/);
      assert.doesNotMatch(errorCalls[0], /\[object Object\]/);
    });

    test("plain objects are JSON-stringified", () => {
      const logger = createLogger({ level: "debug" });
      logger.info("payload:", { a: 1 });
      assert.match(logCalls[0], /\{"a":1\}/);
    });

    test("exposes the known level names", () => {
      const logger = createLogger();
      assert.deepEqual(logger.levels, Object.keys(LEVELS));
    });
  });
});
