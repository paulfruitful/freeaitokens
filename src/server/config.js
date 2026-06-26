"use strict";

const fs = require("fs");
const path = require("path");

const CONFIG_FILE_PATH = path.join(process.cwd(), "fai-config.json");

const CONFIG_METADATA = {
  PORT: { description: "Main Server API HTTP Port", type: "number", requiresRestart: true, default: "5000" },
  HOST: { description: "Main Server API Bind Host Address", type: "string", requiresRestart: true, default: "0.0.0.0" },
  CHAT_URL: { description: "ChatGPT Web Interface Target URL", type: "string", requiresRestart: false, default: "https://chatgpt.com/" },
  AISTUDIO_CHAT_URL: { description: "AI Studio Web Interface Target URL", type: "string", requiresRestart: false, default: "https://aistudio.google.com/prompts/new_chat" },
  CDP_PORT: { description: "Chrome Remote Debugging Port (CDP)", type: "number", requiresRestart: true, default: "9222" },
  USER_DATA_DIR: { description: "Chrome Persistent Profile Directory", type: "string", requiresRestart: false, default: ".playwright/chrome-cdp-profile" },
  DEFAULT_TIMEOUT_MS: { description: "Per-request Playwright Browser Timeout (ms)", type: "number", requiresRestart: false, default: "300000" },
  HEADLESS: { description: "Run Browser in Headless Mode (true/false)", type: "boolean", requiresRestart: false, default: "true" },
  MANUAL_VERIFICATION: { description: "Pause for manual Cloudflare verification (true/false)", type: "boolean", requiresRestart: false, default: "false" },
  CDP_TAB_MODE: { description: "Browser Tab Opening Mode (new/reuse)", type: "string", requiresRestart: false, default: "new" },
};

// Store original environment values capture on boot
const initialEnv = {};
for (const key of Object.keys(CONFIG_METADATA)) {
  initialEnv[key] = process.env[key] !== undefined ? process.env[key] : CONFIG_METADATA[key].default;
}

/**
 * Load configuration overrides from file and inject them into process.env
 */
function loadConfig() {
  if (fs.existsSync(CONFIG_FILE_PATH)) {
    try {
      const data = fs.readFileSync(CONFIG_FILE_PATH, "utf8");
      const overrides = JSON.parse(data);
      for (const [key, value] of Object.entries(overrides)) {
        if (CONFIG_METADATA[key] !== undefined) {
          process.env[key] = String(value);
        }
      }
    } catch (error) {
      console.error("FAI Config: Error reading config file overrides, using defaults:", error);
    }
  }
}

/**
 * Get the full configuration state (initial, current, schema metadata)
 */
function getConfigState() {
  const current = {};
  for (const key of Object.keys(CONFIG_METADATA)) {
    current[key] = process.env[key] !== undefined ? process.env[key] : initialEnv[key];
  }

  return {
    current,
    initial: initialEnv,
    metadata: CONFIG_METADATA,
  };
}

/**
 * Validate and save configuration overrides to the JSON file, and apply to process.env
 * @param {Object} overrides 
 */
function saveConfig(overrides) {
  const cleanOverrides = {};

  for (const [key, value] of Object.entries(overrides)) {
    if (CONFIG_METADATA[key] !== undefined) {
      let typedValue = value;
      // Convert / validate types
      if (CONFIG_METADATA[key].type === "number") {
        typedValue = Number(value);
        if (isNaN(typedValue)) continue;
      } else if (CONFIG_METADATA[key].type === "boolean") {
        typedValue = String(value).toLowerCase() === "true";
      } else {
        typedValue = String(value);
      }

      cleanOverrides[key] = typedValue;
      process.env[key] = String(typedValue);
    }
  }

  try {
    fs.writeFileSync(CONFIG_FILE_PATH, JSON.stringify(cleanOverrides, null, 2), "utf8");
    return true;
  } catch (error) {
    console.error("FAI Config: Failed to write config overrides to file:", error);
    return false;
  }
}

/**
 * Reset config overrides back to initial settings (deletes the config file)
 */
function resetConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE_PATH)) {
      fs.unlinkSync(CONFIG_FILE_PATH);
    }
  } catch (error) {
    console.error("FAI Config: Failed to delete config file on reset:", error);
  }

  // Restore process.env to initial values
  for (const [key, value] of Object.entries(initialEnv)) {
    process.env[key] = String(value);
  }
  return true;
}

// Initial application of configuration overrides
loadConfig();

module.exports = {
  loadConfig,
  getConfigState,
  saveConfig,
  resetConfig,
};
