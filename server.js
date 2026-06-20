"use strict";

const { createApp } = require("./src/server/app");

const PORT = Number(process.env.PORT) || 5000;
const HOST = process.env.HOST || "0.0.0.0";

const app = createApp();

app.listen(PORT, HOST, () => {
  const base = `http://127.0.0.1:${PORT}`;

  console.log(`freeaitokens OpenAI-compatible server`);
  console.log(`  Listening : http://${HOST}:${PORT}`);
  console.log(`  Endpoints :`);
  console.log(`    POST ${base}/v1/chat/completions`);
  console.log(`    GET  ${base}/v1/models`);
  console.log(``);
  console.log(`  OpenAI Node SDK:`);
  console.log(`    const openai = new OpenAI({`);
  console.log(`      apiKey: 'any-value',`);
  console.log(`      baseURL: '${base}/v1',`);
  console.log(`    });`);
  console.log(``);
  console.log(`  Browser mode: ${process.env.CDP_ENDPOINT_URL ? `CDP attach (${process.env.CDP_ENDPOINT_URL})` : process.env.USER_DATA_DIR ? `persistent profile (${process.env.USER_DATA_DIR})` : "fresh headless Chromium per request"}`);
});
