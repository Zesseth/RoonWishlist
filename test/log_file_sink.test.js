"use strict";

const { test, describe, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createFileSink, createLogger, normalizeMaxSizeMb, DEFAULT_MAX_SIZE_MB } = require("../src/logger");

describe("normalizeMaxSizeMb()", () => {
  test("accepts positive numbers and numeric strings", () => {
    assert.equal(normalizeMaxSizeMb(100), 100);
    assert.equal(normalizeMaxSizeMb("50"), 50);
    assert.equal(normalizeMaxSizeMb("0.5"), 0.5);
  });

  test("rejects zero, negative, missing, and garbage values", () => {
    assert.equal(normalizeMaxSizeMb(0), null);
    assert.equal(normalizeMaxSizeMb(-5), null);
    assert.equal(normalizeMaxSizeMb(""), null);
    assert.equal(normalizeMaxSizeMb(undefined), null);
    assert.equal(normalizeMaxSizeMb(null), null);
    assert.equal(normalizeMaxSizeMb("not-a-number"), null);
    assert.equal(normalizeMaxSizeMb(NaN), null);
  });
});

describe("createFileSink()", () => {
  let dir, filePath;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "roon-wishlist-log-test-"));
    filePath = path.join(dir, "test.log");
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("appends lines to the file", () => {
    const sink = createFileSink({ filePath, maxSizeMb: 100 });
    sink.write("line one");
    sink.write("line two");
    const content = fs.readFileSync(filePath, "utf8");
    assert.equal(content, "line one\nline two\n");
  });

  test("creates the parent directory if missing", () => {
    const nested = path.join(dir, "nested", "sub", "test.log");
    const sink = createFileSink({ filePath: nested, maxSizeMb: 100 });
    sink.write("hello");
    assert.equal(fs.readFileSync(nested, "utf8"), "hello\n");
  });

  test("trims oldest content once the file exceeds the configured max size", () => {
    // A tiny cap (in bytes, via a fractional MB) makes the test fast and deterministic.
    const maxSizeMb = 200 / (1024 * 1024); // 200 bytes
    const sink = createFileSink({ filePath, maxSizeMb });
    for (let i = 0; i < 50; i++) {
      sink.write(`line-${i}-padding-to-make-this-longer`);
    }
    const content = fs.readFileSync(filePath, "utf8");
    assert.ok(Buffer.byteLength(content, "utf8") <= 200 + 100, "file should be trimmed back near the cap");
    // Oldest lines should be gone, newest should remain.
    assert.ok(!content.includes("line-0-"), "oldest entries should have been trimmed");
    assert.ok(content.includes("line-49-"), "newest entry should be kept");
  });

  test("never cuts a line in half when trimming", () => {
    const maxSizeMb = 150 / (1024 * 1024);
    const sink = createFileSink({ filePath, maxSizeMb });
    for (let i = 0; i < 30; i++) sink.write(`entry-${i}`);
    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split("\n").filter(Boolean);
    for (const line of lines) {
      assert.match(line, /^entry-\d+$/, `line should be whole, got: "${line}"`);
    }
  });

  test("setMaxSizeMb updates the cap and re-triggers trimming immediately", () => {
    const sink = createFileSink({ filePath, maxSizeMb: 100 });
    for (let i = 0; i < 20; i++) sink.write(`row-${i}-with-some-extra-padding-text`);
    const beforeSize = sink.getCurrentSizeBytes();
    sink.setMaxSizeMb(100 / (1024 * 1024)); // shrink to 100 bytes
    assert.ok(sink.getCurrentSizeBytes() <= beforeSize);
    assert.ok(sink.getCurrentSizeBytes() <= 100 + 60);
  });

  test("seeds its size counter from an existing file at startup", () => {
    fs.writeFileSync(filePath, "pre-existing\ncontent\n", "utf8");
    const sink = createFileSink({ filePath, maxSizeMb: 100 });
    assert.equal(sink.getCurrentSizeBytes(), Buffer.byteLength("pre-existing\ncontent\n", "utf8"));
  });

  test("defaults to DEFAULT_MAX_SIZE_MB (100) when no size given", () => {
    const sink = createFileSink({ filePath });
    assert.equal(sink.getMaxSizeMb(), DEFAULT_MAX_SIZE_MB);
  });
});

describe("logger + file sink integration", () => {
  let dir, filePath, originalLog, originalWarn, originalError;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "roon-wishlist-log-test-"));
    filePath = path.join(dir, "test.log");
    originalLog = console.log;
    originalWarn = console.warn;
    originalError = console.error;
    console.log = () => {};
    console.warn = () => {};
    console.error = () => {};
  });

  afterEach(() => {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("logger writes formatted lines to an attached file sink", () => {
    const sink = createFileSink({ filePath, maxSizeMb: 100 });
    const logger = createLogger({ level: "info", fileSink: sink });
    logger.info("hello world");
    const content = fs.readFileSync(filePath, "utf8");
    assert.match(content, /INFO\s+hello world/);
  });

  test("logger respects level filtering for the file sink too", () => {
    const sink = createFileSink({ filePath, maxSizeMb: 100 });
    const logger = createLogger({ level: "warn", fileSink: sink });
    logger.debug("should not appear");
    logger.warn("should appear");
    const content = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
    assert.ok(!content.includes("should not appear"));
    assert.ok(content.includes("should appear"));
  });

  test("attachFileSink() lets a sink be added after logger creation", () => {
    const logger = createLogger({ level: "info" });
    logger.info("before sink attached");
    assert.ok(!fs.existsSync(filePath));
    const sink = createFileSink({ filePath, maxSizeMb: 100 });
    logger.attachFileSink(sink);
    logger.info("after sink attached");
    const content = fs.readFileSync(filePath, "utf8");
    assert.ok(!content.includes("before sink attached"));
    assert.ok(content.includes("after sink attached"));
  });
});
