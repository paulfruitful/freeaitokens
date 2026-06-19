class FreeAITokensError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = this.constructor.name;

    if (options.cause) {
      this.cause = options.cause;
    }
  }
}

class PluginValidationError extends FreeAITokensError {}
class PlaywrightDependencyError extends FreeAITokensError {}
class SessionStateError extends FreeAITokensError {}
class ResponseTimeoutError extends FreeAITokensError {}

module.exports = {
  FreeAITokensError,
  PluginValidationError,
  PlaywrightDependencyError,
  SessionStateError,
  ResponseTimeoutError,
};
