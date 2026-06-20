"use strict";

const { DatabaseSync } = require("node:sqlite");
const path = require("path");
const fs = require("fs");

let db = null;
let insertStmt = null;

function initDb() {
  if (db) return db;

  const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), "freeaitokens.db");
  const dbDir = path.dirname(dbPath);

  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  try {
    db = new DatabaseSync(dbPath);

    db.exec(`
      CREATE TABLE IF NOT EXISTS requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        request_id TEXT UNIQUE,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        model TEXT,
        prompt_tokens INTEGER,
        completion_tokens INTEGER,
        total_tokens INTEGER,
        status TEXT,
        error_message TEXT,
        duration_ms INTEGER
      )
    `);

    insertStmt = db.prepare(`
      INSERT INTO requests (request_id, model, prompt_tokens, completion_tokens, total_tokens, status, error_message, duration_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
  } catch (error) {
    console.error("Failed to initialize SQLite database:", error);
    throw error;
  }

  return db;
}

function logRequest({ requestId, model, promptTokens, completionTokens, status, errorMessage, durationMs }) {
  try {
    if (!db || !insertStmt) {
      initDb();
    }
    const totalTokens = promptTokens + completionTokens;
    insertStmt.run(
      requestId,
      model,
      promptTokens,
      completionTokens,
      totalTokens,
      status,
      errorMessage || null,
      durationMs
    );
  } catch (error) {
    console.error("Failed to log request to SQLite database:", error);
  }
}

module.exports = {
  initDb,
  logRequest,
};
