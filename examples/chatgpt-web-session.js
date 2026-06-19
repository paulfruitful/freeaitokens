const fs = require("fs");
const path = require("path");
const { PlaywrightChatClient, createChatGPTWebPlugin } = require("../index.js");

function readBooleanEnv(name, defaultValue) {
  const value = process.env[name];

  if (typeof value === "undefined") {
    return defaultValue;
  }

  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

async function saveStorageState(session, storageStatePath) {
  if (!storageStatePath || !session.context) {
    return;
  }

  await fs.promises.mkdir(path.dirname(storageStatePath), { recursive: true });
  await session.context.storageState({ path: storageStatePath });
  console.error(`Saved storage state to ${storageStatePath}`);
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
  const storageStatePath =
    process.env.STORAGE_STATE_PATH || ".auth/chatgpt.json";
  const hasSavedAuth = fs.existsSync(storageStatePath);
  const headless = readBooleanEnv("HEADLESS", false);
  const defaultTimeoutMs = Number(process.env.DEFAULT_TIMEOUT_MS || 300000);

  if (!hasSavedAuth) {
    console.error(
      `No saved auth found at ${storageStatePath}. The browser will open in headed mode so you can log in manually if needed.`,
    );
  }

  const client = new PlaywrightChatClient({
    launchOptions: {
      headless,
    },
    contextOptions: hasSavedAuth
      ? {
          storageState: storageStatePath,
        }
      : {},
    defaultTimeoutMs,
  });

  const session = client.createSession({
    plugin: createChatGPTWebPlugin({
      url,
    }),
  });

  try {
    await session.start();

    if (!hasSavedAuth) {
      console.error(
        "Composer detected. Continuing the test and saving auth state for next time.",
      );
    }

    for (const prompt of prompts) {
      const response = await session.send(prompt);
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

    await saveStorageState(session, storageStatePath);
  } finally {
    await session.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
