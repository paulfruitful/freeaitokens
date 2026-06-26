"use strict";

const {
  PlaywrightChatClient,
  createChatGPTWebPlugin,
  createGeminiWebPlugin,
  createAIStudioWebPlugin,
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
function createClient(model, tab) {
  const cdpEndpointURL = process.env.CDP_ENDPOINT_URL || null;
  const userDataDir = process.env.USER_DATA_DIR || null;
  const headless = readBooleanEnv("HEADLESS", true);
  const cdpTabMode = process.env.CDP_TAB_MODE || "new";

  if (cdpEndpointURL) {
    let mode = cdpTabMode;
    let closePage = cdpTabMode === "last" || cdpTabMode === "first" ? false : true;

    const isGeminiOrAIStudio = model && (
      model === "gemini-web" ||
      model.startsWith("aistudio-") ||
      model === "aistudio-web" ||
      model === "aistudio"
    );
    if (isGeminiOrAIStudio) {
      closePage = false;
      if (tab === "new") {
        mode = "new";
      } else {
        mode = "last";
      }
    }

    return new PlaywrightChatClient({
      ...attachToChromeProfile({
        endpointURL: cdpEndpointURL,
        pageMode: mode,
        closePageOnSessionClose: closePage,
      }),
    });
  }

  return new PlaywrightChatClient({
    launchOptions: { headless },
    userDataDir: userDataDir || undefined,
  });
}

// Build a web plugin from environment variables.
function createPlugin(model = "chatgpt-web") {
  const manualVerification = readBooleanEnv("MANUAL_VERIFICATION", false);

  if (model.startsWith("aistudio-") || model === "aistudio-web" || model === "aistudio") {
    let targetModel = "gemini-3.5-flash"; // default
    let isDefaultModel = false;
    if (model.startsWith("aistudio-") && model !== "aistudio-web") {
      targetModel = model.replace("aistudio-", "");
    } else {
      isDefaultModel = true;
    }
    const url = process.env.AISTUDIO_CHAT_URL || "https://aistudio.google.com/prompts/new_chat";
    return createAIStudioWebPlugin({
      url,
      manualVerification,
      modelName: targetModel,
      isDefaultModel,
    });
  }

  if (model === "gemini-web") {
    const url = process.env.CHAT_URL || "https://gemini.google.com/";
    return createGeminiWebPlugin({
      url,
      manualVerification,
      modelName: model,
    });
  }

  const url = process.env.CHAT_URL || "https://chatgpt.com/";
  return createChatGPTWebPlugin({
    url,
    manualVerification,
  });
}

module.exports = { createClient, createPlugin };
