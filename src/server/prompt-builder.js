"use strict";

// Flatten a message's content field to a plain string.
// Handles both string content and multimodal content arrays (text parts only).
function extractText(content) {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .filter((part) => part && part.type === "text")
      .map((part) => String(part.text || ""))
      .join("\n")
      .trim();
  }

  return "";
}

// Convert an OpenAI messages array into a single prompt string for the chat web UI.
function buildPrompt(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return "";
  }

  const systemMessage = messages.find(
    (m) => m.role === "system" || m.role === "developer",
  );
  const conversationMessages = messages.filter(
    (m) => m.role !== "system" && m.role !== "developer",
  );

  // Fast path: no system message, single user turn
  if (!systemMessage && conversationMessages.length === 1) {
    return extractText(conversationMessages[0].content);
  }

  const parts = [];

  if (systemMessage) {
    const systemText = extractText(systemMessage.content);
    if (systemText) {
      parts.push(`[Instructions]\n${systemText}`);
    }
  }

  // Conversation history (everything except the last message)
  const history = conversationMessages.slice(0, -1);
  if (history.length > 0) {
    const historyLines = history.map((m) => {
      const label = m.role === "user" ? "User" : "Assistant";
      return `${label}: ${extractText(m.content)}`;
    });
    parts.push(`[Previous conversation]\n${historyLines.join("\n")}`);
  }

  // The actual new user message
  const last = conversationMessages[conversationMessages.length - 1];
  if (last) {
    parts.push(extractText(last.content));
  }

  return parts.join("\n\n");
}

module.exports = { buildPrompt, extractText };
