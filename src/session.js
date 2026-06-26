const { SessionStateError, PluginValidationError } = require("./errors");
const { launchSession } = require("./playwright");
const { assertValidPlugin } = require("./plugin-registry");

function buildSessionContext(session, extra = {}) {
  return {
    client: session.client,
    session,
    browser: session.browser,
    context: session.context,
    page: session.page,
    plugin: session.plugin,
    pluginOptions: session.pluginOptions,
    history: session.history.slice(),
    ...extra,
  };
}

function normalizePluginResponse(result, context) {
  const baseResponse = {
    text: "",
    plugin: context.plugin.name,
    prompt: context.prompt,
    turn: context.turn,
    url: context.page ? context.page.url() : undefined,
    createdAt: new Date().toISOString(),
  };

  if (typeof result === "string") {
    return {
      ...baseResponse,
      text: result,
    };
  }

  if (result && typeof result === "object" && typeof result.text === "string") {
    return {
      ...baseResponse,
      ...result,
    };
  }

  throw new PluginValidationError(
    `Plugin "${context.plugin.name}" returned an invalid response. Expected a string or an object with a \`text\` property.`,
  );
}

async function safeClose(handle) {
  if (!handle) {
    return;
  }

  try {
    await handle.close();
  } catch (error) {
    // Ignore close errors during cleanup.
  }
}

class ChatSession {
  constructor(options = {}) {
    const {
      client = null,
      plugin,
      pluginOptions = {},
      playwright = null,
      browserType = "chromium",
      launchOptions = {},
      contextOptions = {},
      userDataDir = null,
      connectOverCDP = null,
      defaultTimeoutMs = 120000,
    } = options;

    this.client = client;
    this.plugin = assertValidPlugin(plugin);
    this.pluginOptions = pluginOptions;
    this.playwright = playwright;
    this.browserType = browserType;
    this.launchOptions = launchOptions;
    this.contextOptions = contextOptions;
    this.userDataDir = userDataDir;
    this.connectOverCDP = connectOverCDP;
    this.defaultTimeoutMs = defaultTimeoutMs;

    this.browser = null;
    this.context = null;
    this.page = null;
    this.closePageOnClose = true;
    this.closeContextOnClose = true;
    this.closeBrowserOnClose = true;
    this.isConnectedOverCDP = false;
    this.started = false;
    this.closed = false;
    this.history = [];
  }

  async start() {
    if (this.closed) {
      throw new SessionStateError("Cannot start a closed session.");
    }

    if (this.started) {
      return this;
    }

    try {
      const launchedSession = await launchSession({
        playwright: this.playwright,
        browserType: this.browserType,
        launchOptions: this.launchOptions,
        contextOptions: this.contextOptions,
        userDataDir: this.userDataDir,
        connectOverCDP: this.connectOverCDP,
      });

      this.browser = launchedSession.browser;
      this.context = launchedSession.context;
      this.page = launchedSession.page;
      this.closePageOnClose = launchedSession.closePageOnClose !== false;
      this.closeContextOnClose = launchedSession.closeContextOnClose !== false;
      this.closeBrowserOnClose = launchedSession.closeBrowserOnClose !== false;
      this.isConnectedOverCDP = launchedSession.isConnectedOverCDP === true;
      this.page.setDefaultTimeout(this.defaultTimeoutMs);
      this.page.setDefaultNavigationTimeout(this.defaultTimeoutMs);

      this.started = true;

      if (typeof this.plugin.open === "function") {
        await this.plugin.open(buildSessionContext(this));
      }

      return this;
    } catch (error) {
      try {
        await this.close();
      } catch (closeError) {
        // Ignore cleanup errors and preserve the original failure.
      }

      throw error;
    }
  }

  async send(prompt, sendOptions = {}) {
    if (this.closed) {
      throw new SessionStateError("Cannot send a prompt on a closed session.");
    }

    if (typeof prompt !== "string" || !prompt.trim()) {
      throw new SessionStateError("Prompt must be a non-empty string.");
    }

    if (!this.started) {
      await this.start();
    }

    const turn = this.history.length + 1;
    const rawResult = await this.plugin.send(
      buildSessionContext(this, {
        prompt,
        turn,
        sendOptions,
      }),
    );
    const response = normalizePluginResponse(rawResult, {
      plugin: this.plugin,
      prompt,
      turn,
      page: this.page,
    });

    this.history.push({
      prompt,
      response,
    });

    return response;
  }

  async sendText(prompt, sendOptions = {}) {
    const response = await this.send(prompt, sendOptions);
    return response.text;
  }

  async close() {
    if (this.closed) {
      return;
    }

    let closeError = null;

    if (this.started && typeof this.plugin.close === "function") {
      try {
        await this.plugin.close(buildSessionContext(this));
      } catch (error) {
        closeError = error;
      }
    }

    if (this.closePageOnClose) {
      await safeClose(this.page);
    }

    if (this.closeContextOnClose) {
      await safeClose(this.context);
    }

    if (this.closeBrowserOnClose) {
      if (this.isConnectedOverCDP && this.browser && typeof this.browser.disconnect === "function") {
        try {
          await this.browser.disconnect();
        } catch (error) {
          // Ignore cleanup/disconnect errors.
        }
      } else {
        await safeClose(this.browser);
      }
    }

    this.page = null;
    this.context = null;
    this.browser = null;
    this.closePageOnClose = true;
    this.closeContextOnClose = true;
    this.closeBrowserOnClose = true;
    this.isConnectedOverCDP = false;
    this.started = false;
    this.closed = true;

    if (closeError) {
      throw closeError;
    }
  }
}

module.exports = {
  ChatSession,
};
