"use strict";

const express = require("express");
const { chatRouter } = require("./routes/chat");
const { modelsRouter } = require("./routes/models");
const { errorHandler } = require("./middleware/error-handler");

function createApp() {
  const app = express();

  app.use(express.json());

  // Health check — useful for SDK connection tests
  app.get("/", (req, res) => {
    res.json({ status: "ok", service: "freeaitokens" });
  });

  app.use("/v1", chatRouter);
  app.use("/v1", modelsRouter);

  // 404 for unknown routes
  app.use((req, res) => {
    res.status(404).json({
      error: {
        message: `Unknown route: ${req.method} ${req.path}`,
        type: "invalid_request_error",
        param: null,
        code: null,
      },
    });
  });

  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
