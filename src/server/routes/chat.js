"use strict";

const express = require("express");
const { createClient, createPlugin } = require("../browser-client");
const { buildPrompt } = require("../prompt-builder");
const {
  completionId,
  buildCompletion,
  buildChunk,
  buildError,
  sseData,
} = require("../openai-format");
const { classifyError } = require("../middleware/error-handler");
const db = require("../db");
const { ensureChromeRunning } = require("../chrome-manager");

const router = express.Router();

// Calculate token count where 1 token is 3/4 of a word
function countTokens(text) {
  if (!text) return 0;
  const words = text.match(/\S+/g) || [];
  return Math.ceil(words.length / 0.75);
}

// Clean markdown code blocks and leading JSON labels from response content
function cleanResponseContent(text) {
  if (typeof text !== "string") {
    return "";
  }

  let cleaned = text.trim();

  // 1. Strip triple backticks markdown code blocks (e.g. ```json ... ``` or ``` ... ```)
  const markdownBlockRegex = /^```(?:json)?\s*([\s\S]*?)\s*```$/i;
  const match = cleaned.match(markdownBlockRegex);
  if (match) {
    cleaned = match[1].trim();
  }

  // 2. Strip leading "JSON" or "json" prefix followed by a newline (and optional spaces)
  // only if it's followed by a JSON start character like [ or {
  cleaned = cleaned.replace(/^json\s*\n\s*(?=[{\[])/i, "");

  return cleaned.trim();
}

// Validate a single message object
function isValidMessage(message) {
  if (!message || typeof message !== "object") {
    return false;
  }

  if (typeof message.role !== "string" || !message.role) {
    return false;
  }

  const { content } = message;

  return (
    typeof content === "string" ||
    (Array.isArray(content) && content.length > 0)
  );
}

// Split text into word-level tokens for fake streaming
function tokenize(text) {
  return text.match(/\S+\s*/g) || (text ? [text] : []);
}

async function handleCompletion(req, res) {
  const startTime = Date.now();
  const { messages, model = "chatgpt-web", stream = false } = req.body || {};

  // ── Validate ────────────────────────────────────────────────────────────
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json(
      buildError(
        "`messages` must be a non-empty array.",
        "invalid_request_error",
        "messages",
        "invalid_value",
      ),
    );
  }

  const invalidIndex = messages.findIndex((m) => !isValidMessage(m));
  if (invalidIndex !== -1) {
    return res.status(400).json(
      buildError(
        `messages[${invalidIndex}] must have a non-empty string 'role' and a 'content' that is a string or array.`,
        "invalid_request_error",
        `messages[${invalidIndex}]`,
        "invalid_value",
      ),
    );
  }

  const prompt = buildPrompt(messages);

  if (!prompt.trim()) {
    return res.status(400).json(
      buildError(
        "No user content found in `messages`.",
        "invalid_request_error",
        "messages",
        "invalid_value",
      ),
    );
  }

  const promptTokens = countTokens(prompt);
  const id = completionId();

  // ── Browser session ──────────────────────────────────────────────────────
  // If we are connecting to Chrome over CDP, verify that it's running and relaunch if down
  if (process.env.CDP_ENDPOINT_URL) {
    try {
      await ensureChromeRunning();
    } catch (launchError) {
      console.error("[FAI] Failed to auto-recover Chrome:", launchError);
      // Let it fail normally during connectOverCDP if recovery completely fails
    }
  }

  const client = createClient();
  const plugin = createPlugin();
  const session = client.createSession({ plugin });

  let response;
  try {
    await session.start();
    response = await session.send(prompt);
  } catch (error) {
    const durationMs = Date.now() - startTime;
    db.logRequest({
      requestId: id,
      model,
      promptTokens,
      completionTokens: 0,
      status: "error",
      errorMessage: error.message || String(error),
      durationMs,
    });

    const { status, body } = classifyError(error);
    return res.status(status).json(body);
  } finally {
    session.close().catch(() => {});
  }

  const content = cleanResponseContent(response.text || "");
  const completionTokens = countTokens(content);
  const durationMs = Date.now() - startTime;

  db.logRequest({
    requestId: id,
    model,
    promptTokens,
    completionTokens,
    status: "success",
    errorMessage: null,
    durationMs,
  });

  const created = Math.floor(Date.now() / 1000);

  // ── Non-streaming ────────────────────────────────────────────────────────
  if (!stream) {
    return res.json(buildCompletion(id, model, content, promptTokens, completionTokens));
  }

  // ── Streaming (SSE) ──────────────────────────────────────────────────────
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  // First chunk: role announcement
  res.write(
    sseData(buildChunk(id, model, created, { role: "assistant", content: "" })),
  );

  // Content chunks: one per word/token
  for (const token of tokenize(content)) {
    res.write(sseData(buildChunk(id, model, created, { content: token })));
  }

  // Final chunk: finish_reason
  res.write(sseData(buildChunk(id, model, created, {}, "stop")));
  res.write("data: [DONE]\n\n");
  res.end();
}

router.post("/chat/completions", (req, res, next) => {
  handleCompletion(req, res).catch(next);
});

module.exports = { chatRouter: router };
