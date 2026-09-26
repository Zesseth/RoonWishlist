"use strict";

/**
 * Integration tests for issue #62: the log file must record the process's own
 * lifecycle (startup, bind failure) even when the rest of the boot sequence
 * cannot continue.
 *
 * The regression: `server.listen()` had no 'error' handler, so a bind failure
 * (typically EADDRINUSE from a leftover process holding the port) crashed the
 * process with an unhandled 'error' event whose stack only reached journald —
 * on installs where the log file is the only readable log, restarts left no
 * trace in the file at all, and the file appeared "frozen" while an older
 * process kept serving HTTP from the same port.
 *
 * The app is spawned with a temporary working directory (node-roon-api keeps
 * its config.json in the cwd), a temporary data dir (log file) and a dedicated
 * port. No Roon core is required.
 */

const assert = require("node:assert");
const { after, before, describe, it } = require("node:test");
const { spawn } = require("node:child_process");
const net = require("node:net");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const REPO_ROOT = path.join(__dirname, "..");
const HTTP_PORT = Number(process.env.ROON_WISHLIST_TEST_PORT || 3993);

let workDir = "";
let logFilePath = "";

function startServer(extraEnv = {}) {
  const env = {
    ...process.env,
    ROON_WISHLIST_HTTP_PORT: String(HTTP_PORT),
    ROON_WISHLIST_HTTP_HOST: "127.0.0.1",
    ROON_WISHLIST_DATA_DIR: path.join(workDir, "data"),
    // Distinct identity so the test instance can never collide with a real
    // install's pairing or config.
    ROON_WISHLIST_EXTENSION_ID: "com.zesseth.roon-wishlist-log-test",
    ROON_WISHLIST_DISPLAY_NAME: "Wishlist log test",
    ...extraEnv,
  };
  return spawn(process.execPath, [path.join(REPO_ROOT, "index.js")], {
    cwd: workDir,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function readLog() {
  try {
    return fs.readFileSync(logFilePath, "utf8");
  } catch {
    return "";
  }
}

function occupyPort() {
  return new Promise((resolve, reject) => {
    const blocker = net.createServer();
    blocker.once("error", reject);
    blocker.listen(HTTP_PORT, "127.0.0.1", () => resolve(blocker));
  });
}

async function waitForExit(child) {
  const [code] = await new Promise((resolve) => {
    if (child.exitCode !== null) return resolve([child.exitCode]);
    child.once("exit", (c) => resolve([c]));
    setTimeout(() => resolve([null]), 20000);
  });
  return code;
}

before(async () => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "roon-wishlist-log-test-"));
  logFilePath = path.join(workDir, "data", "roon-wishlist.log");
});

after(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});

describe("startup logging", () => {
  it("logs its startup line to the log file even when the HTTP port is taken", async () => {
    const blocker = await occupyPort();
    try {
      const child = startServer();
      // Wait for the child to die from the bind failure (or time out).
      const code = await waitForExit(child);
      assert.ok(code !== null, "server should exit when the port is unavailable");
      const content = readLog();
      // Before the fix, the file stayed empty: the process crashed on an
      // unhandled 'error' event before anything reached the file sink.
      assert.match(
        content,
        /Wishlist starting/,
        "the startup line must reach the log file even if the process dies right after"
      );
      assert.match(
        content,
        /ERROR\s+Could not listen on http:\/\/127\.0\.0\.1:\d+/,
        "the bind failure must be recorded in the log file, not only in journald"
      );
    } finally {
      blocker.close();
      await new Promise((resolve) => blocker.once("close", resolve));
    }
  });

  it("logs the listening line to the log file on a normal start", async () => {
    const child = startServer();
    try {
      const deadline = Date.now() + 20000;
      for (;;) {
        const content = readLog();
        if (/listening on http:\/\/127\.0\.0\.1:\d+/.test(content)) break;
        if (child.exitCode !== null) {
          throw new Error(`Test server exited early with code ${child.exitCode}.`);
        }
        if (Date.now() > deadline) {
          throw new Error(`Startup line never reached the log file. Log so far:\n${readLog()}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      const content = readLog();
      assert.match(content, /Wishlist starting — version \d+\.\d+\.\d+, pid \d+/);
      assert.match(content, /INFO\s+Wishlist web UI \+ API listening on/);
    } finally {
      child.kill("SIGTERM");
      await waitForExit(child);
    }
  });

  it("keeps working across a restart: a second start appends to the same file", async () => {
    const first = startServer();
    try {
      const deadline = Date.now() + 20000;
      while (!/listening on/.test(readLog()) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      assert.match(readLog(), /listening on/);
    } finally {
      first.kill("SIGTERM");
      await waitForExit(first);
    }

    const second = startServer();
    try {
      const deadline = Date.now() + 20000;
      for (;;) {
        const content = readLog();
        const starts = content.match(/Wishlist starting/g) || [];
        if (starts.length >= 2) break;
        if (second.exitCode !== null) {
          throw new Error(`Second server exited early with code ${second.exitCode}.`);
        }
        if (Date.now() > deadline) {
          throw new Error(`Second startup never appended to the log file. Log:\n${content}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      // Both runs' startup lines must be present in one file, oldest first.
      const content = readLog();
      const firstIdx = content.indexOf("Wishlist starting");
      const lastIdx = content.lastIndexOf("Wishlist starting");
      assert.ok(firstIdx !== -1 && lastIdx !== firstIdx, "two startup lines expected in one file");
      assert.match(content, /listening on/, "the restarted process still logs its listening line");
    } finally {
      second.kill("SIGTERM");
      await waitForExit(second);
    }
  });
});
