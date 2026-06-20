"use strict";

const {
  ConfigurationError,
  PlaywrightDependencyError,
  SessionStateError,
  ResponseTimeoutError,
  NetworkDiagnosticsError,
  PluginValidationError,
} = require("../../errors");
const { buildError } = require("../openai-format");

// Map a library error instance to { status, body } for the HTTP response.
function classifyError(error) {
  if (error instanceof ConfigurationError || error instanceof PluginValidationError) {
    return {
      status: 400,
      body: buildError(error.message, "invalid_request_error", null, null),
    };
  }

  if (error instanceof PlaywrightDependencyError) {
    return {
      status: 500,
      body: buildError(error.message, "server_error", null, "playwright_unavailable"),
    };
  }

  if (error instanceof ResponseTimeoutError) {
    return {
      status: 504,
      body: buildError(error.message, "server_error", null, "response_timeout"),
    };
  }

  if (error instanceof NetworkDiagnosticsError) {
    return {
      status: 503,
      body: buildError(error.message, "server_error", null, "network_blocked"),
    };
  }

  if (error instanceof SessionStateError) {
    return {
      status: 500,
      body: buildError(error.message, "server_error", null, "session_error"),
    };
  }

  return {
    status: 500,
    body: buildError(
      error.message || "An unexpected error occurred.",
      "server_error",
      null,
      null,
    ),
  };
}

// Express error handler (must have exactly 4 parameters to be recognized as one).
// eslint-disable-next-line no-unused-vars
function errorHandler(error, req, res, next) {
  console.error("[freeaitokens]", error.message || error);

  if (res.headersSent) {
    return;
  }

  const { status, body } = classifyError(error);
  res.status(status).json(body);
}

module.exports = { errorHandler, classifyError };
