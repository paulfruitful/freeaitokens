"use strict";

const http = require("http");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const projectRoot = path.resolve(__dirname, "../..");

function findChrome() {
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

function checkCDPReady(cdpPort) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${cdpPort}/json/version`, { timeout: 1000 }, (res) => {
      resolve(res.statusCode === 200);
      res.resume();
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

function launchChrome(chromePath, cdpPort) {
  const profileDir = process.env.USER_DATA_DIR || path.join(projectRoot, ".playwright", "chrome-cdp-profile");
  fs.mkdirSync(profileDir, { recursive: true });

  const args = [
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
  ];

  if (process.env.HEADLESS === "true") {
    args.push("--headless=new");
  }

  args.push("https://chatgpt.com/");

  const chrome = spawn(chromePath, args, {
    detached: true,
    stdio:    "ignore",
  });
  chrome.unref();
}

async function ensureChromeRunning() {
  const cdpPort = parseInt(process.env.CDP_PORT || "9222", 10);
  const isReady = await checkCDPReady(cdpPort);
  if (isReady) {
    return true;
  }

  console.log(`[FAI] Chrome CDP not found on port ${cdpPort}. Relaunching browser...`);
  const chromePath = findChrome();
  if (!chromePath) {
    throw new Error("Chrome executable not found. Install Chrome or set the CHROME_PATH environment variable.");
  }

  launchChrome(chromePath, cdpPort);

  // Poll until ready, up to 20 seconds
  const timeoutMs = parseInt(process.env.CDP_TIMEOUT || "20000", 10);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await checkCDPReady(cdpPort)) {
      console.log(`[FAI] Chrome CDP is now active and ready on port ${cdpPort}`);
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`Chrome launched but CDP port ${cdpPort} did not become active within ${timeoutMs / 1000} seconds.`);
}

module.exports = {
  ensureChromeRunning,
  checkCDPReady,
};
