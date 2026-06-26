const {
  PlaywrightChatClient,
  createAIStudioWebPlugin,
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
      'Usage: node examples/aistudio-web-session.js "Hello" "Continue with more detail"',
    );
    process.exit(1);
  }

  const url = process.env.AISTUDIO_CHAT_URL || "https://aistudio.google.com/prompts/new_chat";
  const modelName = process.env.AISTUDIO_MODEL || "gemini-3.5-flash";
  const headless = readBooleanEnv("HEADLESS", false);
  const manualVerification = readBooleanEnv("MANUAL_VERIFICATION", false);
  const userDataDir = process.env.USER_DATA_DIR || null;
  const cdpEndpointURL = process.env.CDP_ENDPOINT_URL || null;
  const cdpTabMode = process.env.CDP_TAB_MODE || "new";
  const defaultTimeoutMs = Number(process.env.DEFAULT_TIMEOUT_MS || 300000);

  let client;

  if (cdpEndpointURL) {
    console.error(`Connecting to CDP at ${cdpEndpointURL} using page mode ${cdpTabMode}.`);
    client = new PlaywrightChatClient({
      ...attachToChromeProfile({
        endpointURL: cdpEndpointURL,
        pageMode: cdpTabMode,
        closePageOnSessionClose: cdpTabMode === "last" || cdpTabMode === "first" ? false : true,
      }),
      defaultTimeoutMs,
    });
  } else {
    client = new PlaywrightChatClient({
      launchOptions: { headless },
      userDataDir,
      defaultTimeoutMs,
    });
  }

  const session = client.createSession({
    plugin: createAIStudioWebPlugin({
      url,
      manualVerification,
      modelName,
    }),
  });

  try {
    await session.start();

    // Keep track of messages for simulation of consecutive turns
    const messages = [];

    for (const prompt of prompts) {
      console.error(`Sending prompt: "${prompt}"`);
      messages.push({ role: "user", content: prompt });
      const response = await session.send(prompt, { messages });
      messages.push({ role: "assistant", content: response.text });

      console.log(
        JSON.stringify(
          {
            prompt,
            response: response.text,
            segments: response.segments || [],
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
