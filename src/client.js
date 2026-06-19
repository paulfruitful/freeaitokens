const { PluginValidationError } = require('./errors');
const { PluginRegistry } = require('./plugin-registry');
const { ChatSession } = require('./session');

class PlaywrightChatClient {
  constructor(options = {}) {
    const {
      plugins = [],
      registry = null,
      playwright = null,
      browserType = 'chromium',
      launchOptions = {},
      contextOptions = {},
      defaultTimeoutMs = 120000,
    } = options;

    this.registry = registry instanceof PluginRegistry ? registry : new PluginRegistry();

    for (const plugin of plugins) {
      this.registry.register(plugin);
    }

    this.playwright = playwright;
    this.browserType = browserType;
    this.launchOptions = {
      headless: true,
      ...(launchOptions || {}),
    };
    this.contextOptions = {
      ...(contextOptions || {}),
    };
    this.defaultTimeoutMs = defaultTimeoutMs;
  }

  registerPlugin(plugin) {
    this.registry.register(plugin);
    return this;
  }

  listPlugins() {
    return this.registry.list();
  }

  createSession(options = {}) {
    const {
      plugin,
      pluginOptions = {},
      browserType = this.browserType,
      launchOptions = {},
      contextOptions = {},
      defaultTimeoutMs = this.defaultTimeoutMs,
    } = options;

    if (!plugin) {
      throw new PluginValidationError(
        'A plugin object or registered plugin name must be provided.'
      );
    }

    return new ChatSession({
      client: this,
      plugin: this.registry.resolve(plugin),
      pluginOptions,
      playwright: this.playwright,
      browserType,
      launchOptions: {
        ...this.launchOptions,
        ...(launchOptions || {}),
      },
      contextOptions: {
        ...this.contextOptions,
        ...(contextOptions || {}),
      },
      defaultTimeoutMs,
    });
  }

  async chat(options = {}) {
    const { prompt, sendOptions = {} } = options;
    const session = this.createSession(options);
    let result;
    let sendError = null;

    try {
      await session.start();
      result = await session.send(prompt, sendOptions);
    } catch (error) {
      sendError = error;
    }

    try {
      await session.close();
    } catch (closeError) {
      if (!sendError) {
        throw closeError;
      }
    }

    if (sendError) {
      throw sendError;
    }

    return result;
  }

  async chatText(options = {}) {
    const response = await this.chat(options);
    return response.text;
  }
}

module.exports = {
  PlaywrightChatClient,
};
