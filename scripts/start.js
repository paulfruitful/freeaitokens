#!/usr/bin/env node
"use strict";

const { spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const path = require("path");
const os = require("os");

const projectRoot = path.resolve(__dirname, "..");

const PORT         = parseInt(process.env.PORT         || "5000",  10);
const CDP_PORT     = parseInt(process.env.CDP_PORT     || "9222",  10);
const CDP_TIMEOUT  = parseInt(process.env.CDP_TIMEOUT  || "20000", 10); // ms
const CDP_ENDPOINT = `http://127.0.0.1:${CDP_PORT}`;
const PROFILE_DIR  = process.env.USER_DATA_DIR ||
                     path.join(projectRoot, ".playwright", "chrome-cdp-profile");

// ---------------------------------------------------------------------------
// ANSI colours
// ---------------------------------------------------------------------------

const USE_COLOR = process.stdout.isTTY;

const c = {
  cyan:  USE_COLOR ? "\x1b[36m" : "",
  green: USE_COLOR ? "\x1b[32m" : "",
  yellow:USE_COLOR ? "\x1b[33m" : "",
  red:   USE_COLOR ? "\x1b[31m" : "",
  gray:  USE_COLOR ? "\x1b[90m" : "",
  reset: USE_COLOR ? "\x1b[0m"  : "",
};

function info(msg)  { console.log(`${c.cyan}==> ${msg}${c.reset}`); }
function ok(msg)    { console.log(`    ${c.green}[OK]  ${msg}${c.reset}`); }
function warn(msg)  { console.log(`    ${c.yellow}[!!]  ${msg}${c.reset}`); }
function fail(msg)  { console.error(`\n    ${c.red}[FAIL]  ${msg}${c.reset}\n`); }

// ---------------------------------------------------------------------------
// Chrome discovery
// ---------------------------------------------------------------------------

function findChrome() {
  // Allow override via env or CLI
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }

  const platform = os.platform();
  let candidates = [];

  if (platform === "win32") {
    candidates = [
      process.env.PROGRAMFILES         && path.join(process.env.PROGRAMFILES,         "Google", "Chrome", "Application", "chrome.exe"),
      process.env["PROGRAMFILES(X86)"] && path.join(process.env["PROGRAMFILES(X86)"], "Google", "Chrome", "Application", "chrome.exe"),
      process.env.LOCALAPPDATA         && path.join(process.env.LOCALAPPDATA,          "Google", "Chrome", "Application", "chrome.exe"),
    ];
  } else if (platform === "darwin") {
    candidates = [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ];
  } else {
    // Linux
    candidates = [
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
      "/snap/bin/chromium",
    ];
  }

  return candidates.filter(Boolean).find((p) => fs.existsSync(p)) || null;
}

// ---------------------------------------------------------------------------
// CDP readiness check
// ---------------------------------------------------------------------------

function checkCDPReady() {
  return new Promise((resolve) => {
    const req = http.get(`${CDP_ENDPOINT}/json/version`, { timeout: 2000 }, (res) => {
      resolve(res.statusCode === 200);
      res.resume(); // drain so the socket closes
    });
    req.on("error",   () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
  });
}

async function waitForCDP(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await checkCDPReady()) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

// ---------------------------------------------------------------------------
// Chrome launcher
// ---------------------------------------------------------------------------

function launchChrome(chromePath) {
  fs.mkdirSync(PROFILE_DIR, { recursive: true });

  const args = [
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${PROFILE_DIR}`,
    "--no-first-run",
    "--no-default-browser-check",
    "https://chatgpt.com/",
  ];

  // On Linux, warn if there is no display server available
  if (os.platform() === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    warn("No display server detected (DISPLAY / WAYLAND_DISPLAY not set).");
    warn("Chrome may fail to launch in headed mode on this system.");
    warn("If you are on a headless server, set CHROME_PATH and add --headless");
    warn("to the Chrome args, or use USER_DATA_DIR with a pre-authenticated profile.");
  }

  const chrome = spawn(chromePath, args, {
    detached: true,
    stdio:    "ignore",
  });
  chrome.unref();
}

// ---------------------------------------------------------------------------
// Server launcher
// ---------------------------------------------------------------------------

function startServer() {
  const env = {
    ...process.env,
    CDP_ENDPOINT_URL: CDP_ENDPOINT,
    CDP_TAB_MODE:     process.env.CDP_TAB_MODE || "new",
    PORT:             String(PORT),
  };

  const server = spawn(process.execPath, ["server.js"], {
    cwd:   projectRoot,
    env,
    stdio: "inherit",
  });

  server.on("exit", (code) => process.exit(code ?? 0));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

(async () => {
  console.log();
  info(`freeaitokens  |  starting...`);
  console.log();

  // ── Step 1: Is Chrome already up? ────────────────────────────────────────
  info(`Checking for Chrome CDP at ${CDP_ENDPOINT}`);

  if (await checkCDPReady()) {
    ok(`Chrome already running with CDP at ${CDP_ENDPOINT}`);
  } else {
    // ── Step 2: Find and launch Chrome ─────────────────────────────────────
    info("Launching Chrome with CDP");

    const chromePath = findChrome();
    if (!chromePath) {
      fail("Chrome not found. Install Chrome or set the CHROME_PATH environment variable.");
      console.log(`  ${c.yellow}https://www.google.com/chrome/${c.reset}`);
      process.exit(1);
    }

    launchChrome(chromePath);

    console.log(`    Chrome launched.`);
    console.log(`    Profile : ${PROFILE_DIR}`);
    console.log(`    CDP     : ${CDP_ENDPOINT}`);
    console.log();
    warn("If this is your first run, log in to ChatGPT and complete");
    warn("any Cloudflare check in the opened Chrome window, then");
    warn("re-run  npm start  (the server will start automatically");
    warn("once the CDP endpoint becomes available).");
    console.log();

    // ── Step 3: Poll until Chrome is ready ─────────────────────────────────
    info(`Waiting for Chrome to be ready (up to ${CDP_TIMEOUT / 1000}s)...`);

    const ready = await waitForCDP(CDP_TIMEOUT);
    if (!ready) {
      fail(`Chrome did not expose the CDP endpoint within ${CDP_TIMEOUT / 1000}s.`);
      console.log(`  Check that nothing is blocking port ${CDP_PORT}.`);
      if (os.platform() === "win32") {
        console.log(`  You can also run scripts\\launch-chrome-cdp.cmd manually.`);
      }
      process.exit(1);
    }

    ok("Chrome is ready");
  }

  // ── Step 4: Start the Node.js server ───────────────────────────────────
  console.log();
  info(`Starting freeaitokens server on port ${PORT}`);
  console.log();

  startServer();
})();
