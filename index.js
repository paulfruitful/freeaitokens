const { PlaywrightChatClient } = require("./src/client");
const { ChatSession } = require("./src/session");
const {
  PluginRegistry,
  assertValidPlugin,
  definePlugin,
} = require("./src/plugin-registry");
const { createSelectorPlugin } = require("./src/plugins/generic-chat");
const {
  CHATGPT_WEB_SELECTORS,
  createChatGPTWebPlugin,
} = require("./src/plugins/chatgpt-web");
const {
  FreeAITokensError,
  PluginValidationError,
  PlaywrightDependencyError,
  SessionStateError,
  ResponseTimeoutError,
} = require("./src/errors");

module.exports = {
  PlaywrightChatClient,
  ChatSession,
  PluginRegistry,
  assertValidPlugin,
  definePlugin,
  createSelectorPlugin,
  CHATGPT_WEB_SELECTORS,
  createChatGPTWebPlugin,
  FreeAITokensError,
  PluginValidationError,
  PlaywrightDependencyError,
  SessionStateError,
  ResponseTimeoutError,
};
