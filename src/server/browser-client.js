"use strict";

const {
  PlaywrightChatClient,
  createChatGPTWebPlugin,
  attachToChromeProfile,
} = require("../../index");

function readBooleanEnv(name, defaultValue) {
  const value = process.env[name];

  if (typeof value === "undefined") {
    return defaultValue;
  }

  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

// Build a PlaywrightChatClient from environment variables.
// This is inexpensive — no browser is launched here.
function createClient() {
  const cdpEndpointURL = process.env.CDP_ENDPOINT_URL || null;
  const userDataDir = process.env.USER_DATA_DIR || null;
  const headless = readBooleanEnv("HEADLESS", true);
  const cdpTabMode = process.env.CDP_TAB_MODE || "new";

  if (cdpEndpointURL) {
    return new PlaywrightChatClient({
      ...attachToChromeProfile({
        endpointURL: cdpEndpointURL,
        pageMode: cdpTabMode,
      }),
    });
  }

  return new PlaywrightChatClient({
    launchOptions: { headless },
    userDataDir: userDataDir || undefined,
  });
}

// Build a ChatGPT web plugin from environment variables.
function createPlugin() {
  const url = process.env.CHAT_URL || "https://chatgpt.com/";
  const manualVerification = readBooleanEnv("MANUAL_VERIFICATION", false);

  return createChatGPTWebPlugin({
    url,
    manualVerification,
  });
}

module.exports = { createClient, createPlugin };
