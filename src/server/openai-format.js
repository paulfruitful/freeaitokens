"use strict";

const { randomUUID } = require("crypto");

// Generates a chatcmpl-style ID identical in shape to OpenAI's
function completionId() {
  return `chatcmpl-${randomUUID().replace(/-/g, "").slice(0, 24)}`;
}

// Single model object (the shape returned by GET /v1/models/:id)
function modelObject(id, ownedBy = "freeaitokens") {
  return {
    id,
    object: "model",
    created: 1700000000,
    owned_by: ownedBy,
  };
}

// Non-streaming ChatCompletion response
function buildCompletion(id, model, content, promptTokens = 0, completionTokens = 0) {
  return {
    id,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    system_fingerprint: null,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content,
          refusal: null,
        },
        finish_reason: "stop",
        logprobs: null,
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  };
}

// One SSE chunk. Pass delta = { role: "assistant", content: "" } for the first chunk,
// delta = { content: "..." } for content chunks,
// delta = {} with finishReason = "stop" for the final chunk.
function buildChunk(id, model, created, delta, finishReason = null) {
  return {
    id,
    object: "chat.completion.chunk",
    created,
    model,
    system_fingerprint: null,
    choices: [
      {
        index: 0,
        delta,
        finish_reason: finishReason,
        logprobs: null,
      },
    ],
  };
}

// OpenAI-compatible error envelope
function buildError(
  message,
  type = "server_error",
  param = null,
  code = null,
) {
  return {
    error: {
      message,
      type,
      param,
      code,
    },
  };
}

// Format a single SSE data line (with trailing double-newline as required by spec)
function sseData(payload) {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

module.exports = {
  completionId,
  modelObject,
  buildCompletion,
  buildChunk,
  buildError,
  sseData,
};
