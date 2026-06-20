"use strict";

const express = require("express");
const { modelObject, buildError } = require("../openai-format");

const router = express.Router();

const SUPPORTED_MODELS = [modelObject("chatgpt-web")];
const SUPPORTED_MODEL_IDS = new Set(SUPPORTED_MODELS.map((m) => m.id));

router.get("/models", (req, res) => {
  res.json({ object: "list", data: SUPPORTED_MODELS });
});

router.get("/models/:id", (req, res) => {
  const { id } = req.params;

  if (!SUPPORTED_MODEL_IDS.has(id)) {
    return res.status(404).json(
      buildError(`The model '${id}' does not exist.`, "invalid_request_error", "model", "model_not_found"),
    );
  }

  res.json(modelObject(id));
});

module.exports = { modelsRouter: router };
