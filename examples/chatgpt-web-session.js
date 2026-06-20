const {
  PlaywrightChatClient,
  createChatGPTWebPlugin,
  attachToChromeProfile,
} = require("../index.js");

function readBooleanEnv(name, defaultValue) {
  const value = process.env[name];

  if (typeof value === "undefined") {
    return defaultValue;
  }

  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function printDiagnostics(error) {
  if (!error || !error.diagnostics) {
    return;
  }

  console.error("Network diagnostics:");
  console.error(JSON.stringify(error.diagnostics, null, 2));
}

async function main() {
  const prompts = process.argv.slice(2);

  if (!prompts.length) {
    console.error(
      'Usage: node examples/chatgpt-web-session.js "Hello" "Continue with more detail"',
    );
    process.exit(1);
  }

  const url = process.env.CHAT_URL || "https://chatgpt.com/";
  const headless = readBooleanEnv("HEADLESS", false);
  const manualVerification = readBooleanEnv("MANUAL_VERIFICATION", false);
  const userDataDir = process.env.USER_DATA_DIR || null;
  const cdpEndpointURL = process.env.CDP_ENDPOINT_URL || null;
  const cdpTabMode = process.env.CDP_TAB_MODE || "new";
  const defaultTimeoutMs = Number(process.env.DEFAULT_TIMEOUT_MS || 300000);

  let client;

  if (cdpEndpointURL) {
    console.error(` ${cdpEndpointURL} using page mode ${cdpTabMode}.`);

    if (userDataDir) {
      console.error(
        "USER_DATA_DIR is ignored when CDP_ENDPOINT_URL is set because the browser profile is already running.",
      );
    }

    if (typeof process.env.HEADLESS !== "undefined") {
      console.error(
        "HEADLESS is ignored when CDP_ENDPOINT_URL is set because the browser is already open.",
      );
    }

    client = new PlaywrightChatClient({
      ...attachToChromeProfile({
        endpointURL: cdpEndpointURL,
        pageMode: cdpTabMode,
      }),
      defaultTimeoutMs,
    });
  } else {
    if (userDataDir) {
      console.error(
        `Launching Chromium with a persistent profile at ${userDataDir}. Cookies and login state will be reused across runs.`,
      );
    } else {
      console.error(
        "Launching a fresh stateless Chromium context for this run. No cookies or storage state will be reused.",
      );
    }

    if (manualVerification && headless) {
      console.error(
        "MANUAL_VERIFICATION is enabled but HEADLESS is true. Manual verification only works in a visible browser window.",
      );
    }

    client = new PlaywrightChatClient({
      launchOptions: {
        headless,
      },
      contextOptions: {},
      userDataDir,
      defaultTimeoutMs,
    });
  }

  const session = client.createSession({
    plugin: createChatGPTWebPlugin({
      url,
      manualVerification,
    }),
  });

  try {
    await session.start();

    for (const prompt of prompts) {
      const response = await session.send(prompt);
      console.log(
        JSON.stringify(
          {
            prompt,
            response: response.text,
            segments: response.segments || [],
            //     networkDiagnostics: response.networkDiagnostics || null,
          },
          null,
          2,
        ),
      );
    }
  } finally {
    await session.close();
  }
}

main().catch((error) => {
  console.error(error);
  printDiagnostics(error);
  process.exit(1);
});
