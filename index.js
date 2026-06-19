const { PlaywrightChatClient } = require('./src/client');
const { ChatSession } = require('./src/session');
const {
  PluginRegistry,
  assertValidPlugin,
  definePlugin,
} = require('./src/plugin-registry');
const { createSelectorPlugin } = require('./src/plugins/generic-chat');
const {
  FreeAITokensError,
  PluginValidationError,
  PlaywrightDependencyError,
  SessionStateError,
  ResponseTimeoutError,
} = require('./src/errors');

module.exports = {
  PlaywrightChatClient,
  ChatSession,
  PluginRegistry,
  assertValidPlugin,
  definePlugin,
  createSelectorPlugin,
  FreeAITokensError,
  PluginValidationError,
  PlaywrightDependencyError,
  SessionStateError,
  ResponseTimeoutError,
};
