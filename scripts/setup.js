#!/usr/bin/env node
"use strict";

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const projectRoot = path.resolve(__dirname, "..");

// npm and npx are .cmd files on Windows and must be invoked via shell
const isWindows = os.platform() === "win32";
const npmCmd = isWindows ? "npm.cmd" : "npm";
const npxCmd = isWindows ? "npx.cmd" : "npx";

// ---------------------------------------------------------------------------
// ANSI colours (suppressed when stdout is not a TTY)
// ---------------------------------------------------------------------------

const USE_COLOR = process.stdout.isTTY;

const c = {
  cyan:  USE_COLOR ? "\x1b[36m"  : "",
  green: USE_COLOR ? "\x1b[32m"  : "",
  yellow:USE_COLOR ? "\x1b[33m"  : "",
  red:   USE_COLOR ? "\x1b[31m"  : "",
  gray:  USE_COLOR ? "\x1b[90m"  : "",
  white: USE_COLOR ? "\x1b[97m"  : "",
  reset: USE_COLOR ? "\x1b[0m"   : "",
};

function step(msg)  { console.log(`\n${c.cyan}==> ${msg}${c.reset}`); }
function ok(msg)    { console.log(`    ${c.green}[OK]  ${msg}${c.reset}`); }
function warn(msg)  { console.log(`    ${c.yellow}[!!]  ${msg}${c.reset}`); }
function fail(msg)  { console.error(`\n    ${c.red}[FAIL]  ${msg}${c.reset}\n`); }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function run(cmd, args) {
  const result = spawnSync(cmd, args, {
    cwd: projectRoot,
    stdio: "inherit",
    shell: isWindows,
  });
  return result.status ?? 1;
}

// Return the first Chrome executable found on this platform, or null.
function findChrome() {
  const platform = os.platform();
  let candidates = [];

  if (platform === "win32") {
    candidates = [
      process.env.PROGRAMFILES        && path.join(process.env.PROGRAMFILES,         "Google", "Chrome", "Application", "chrome.exe"),
      process.env["PROGRAMFILES(X86)"] && path.join(process.env["PROGRAMFILES(X86)"],"Google", "Chrome", "Application", "chrome.exe"),
      process.env.LOCALAPPDATA        && path.join(process.env.LOCALAPPDATA,          "Google", "Chrome", "Application", "chrome.exe"),
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
// Banner
// ---------------------------------------------------------------------------

console.log();
console.log(`  ${c.white}freeaitokens setup${c.reset}`);
console.log(`  ${c.gray}OpenAI-compatible local server backed by Playwright${c.reset}`);
console.log();

// ---------------------------------------------------------------------------
// Step 1: Node.js version
// ---------------------------------------------------------------------------

step("Checking Node.js (>= 18 required)");

const major = parseInt(process.versions.node.split(".")[0], 10);
if (major < 18) {
  fail(`Node.js v${process.versions.node} detected. Version 18 or higher is required.`);
  console.log(`  Download the latest LTS from ${c.yellow}https://nodejs.org/${c.reset}`);
  process.exit(1);
}
ok(`Node.js v${process.versions.node}`);

// ---------------------------------------------------------------------------
// Step 2: npm
// ---------------------------------------------------------------------------

step("Checking npm");

const npmVersion = spawnSync(npmCmd, ["--version"], { encoding: "utf8", shell: isWindows });
if (npmVersion.status !== 0) {
  fail("npm is not available. It should come bundled with Node.js.");
  process.exit(1);
}
ok(`npm ${npmVersion.stdout.trim()}`);

// ---------------------------------------------------------------------------
// Step 3: Chrome (warn-only — CDP mode needs it, headless Playwright does not)
// ---------------------------------------------------------------------------

step("Checking for Chrome");

const chromePath = findChrome();
if (chromePath) {
  ok(`Chrome found at ${chromePath}`);
} else {
  warn("Chrome not found in standard locations.");
  warn("CDP attach mode (recommended) requires Chrome.");
  warn(`Download from ${c.yellow}https://www.google.com/chrome/${c.reset}`);
  warn("Continuing - Playwright Chromium can still be used for headless mode.");
}

// ---------------------------------------------------------------------------
// Step 4: npm install
// ---------------------------------------------------------------------------

step("Installing npm dependencies");

if (run(npmCmd, ["install"]) !== 0) {
  fail("npm install failed.");
  process.exit(1);
}
ok("Dependencies installed");

// ---------------------------------------------------------------------------
// Step 5: Playwright Chromium browser
// ---------------------------------------------------------------------------

const skipPlaywright = process.argv.includes("--skip-playwright");

if (skipPlaywright) {
  step("Skipping Playwright Chromium install (--skip-playwright passed)");
  warn("Run  npx playwright install chromium  later if you need headless mode.");
} else {
  step("Installing Playwright Chromium browser");

  if (run(npxCmd, ["playwright", "install", "chromium"]) !== 0) {
    fail("Playwright browser install failed.");
    process.exit(1);
  }
  ok("Playwright Chromium installed");
}

// ---------------------------------------------------------------------------
// Step 6: Chrome CDP profile directory
// ---------------------------------------------------------------------------

step("Creating Chrome CDP profile directory");

const profileDir = path.join(projectRoot, ".playwright", "chrome-cdp-profile");
fs.mkdirSync(profileDir, { recursive: true });
ok(`Profile directory ready at ${profileDir}`);

// ---------------------------------------------------------------------------
// Step 7: Project checks
// ---------------------------------------------------------------------------

step("Running project checks");

if (run(npmCmd, ["test"]) !== 0) {
  fail("Project checks failed. Something may be wrong with the installation.");
  process.exit(1);
}
ok("All checks passed");

// ---------------------------------------------------------------------------
// Done — next steps
// ---------------------------------------------------------------------------

const div = "-".repeat(60);
const S = `  ${"$"}`;   // keep $ out of template literals for clarity

console.log();
console.log(`${c.green}${div}${c.reset}`);
console.log(`${c.green}  Setup complete. Here is how to start:${c.reset}`);
console.log(`${c.green}${div}${c.reset}`);
console.log();
console.log(`  ${c.white}Step 1${c.reset}  Run the start command (handles Chrome automatically):`);
console.log(`          ${c.yellow}npm start${c.reset}`);
console.log();
console.log(`  ${c.white}Step 2${c.reset}  On first run, log in to ChatGPT in the opened`);
console.log(`          Chrome window and complete any Cloudflare check.`);
console.log(`          Then run ${c.yellow}npm start${c.reset} again.`);
console.log();
console.log(`  ${c.white}Step 3${c.reset}  Call it like any OpenAI endpoint:`);
console.log(`          ${c.yellow}baseURL : http://localhost:5000/v1${c.reset}`);
console.log(`          ${c.yellow}apiKey  : any-value${c.reset}`);
console.log(`          ${c.yellow}model   : chatgpt-web${c.reset}`);
console.log();
console.log(`  ${c.gray}Optional flags:${c.reset}`);
console.log(`  ${c.gray}  --skip-playwright   skip the Playwright browser download${c.reset}`);
console.log();
