<div align="center">
  <h1> FreeAITokens</h1>
  <p><b>An OpenAI-compatible local server powered by Playwright browser automation to give you free inference from popular LLM platforms like ChatGPT, Gemini, and Claude.</b></p>
  
  [![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)
  [![Node.js Version](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org/)
  [![Playwright](https://img.shields.io/badge/powered_by-Playwright-2EAD33.svg)](https://playwright.dev/)
</div>

---

## 💡 Why I Built This

> *I built this for every developer's local projects without the need for burning cash on API tokens and getting rate-limited. Especially for developers without enough hardware resources to run local models at their full capacity, I built it to provide a free, OpenAI-compatible local inference server backed by browser AI.*

> **The Server Approach:** `freeaitokens` operates as a standalone HTTP server that perfectly mimics the OpenAI Chat Completions API (`/v1/chat/completions`). By seamlessly bridging standard API requests to a real automated browser, you can drop it into any existing application, SDK, or tool that speaks to OpenAI—zero code changes required!

---

## 🚀 Quick Start

### Prerequisites

Before you begin, make sure you have:

- **Node.js 18 or later** installed.
- **Git** installed.
- ChatGPT account (It's optional also additional providers like Claude and Gemini are coming soon).

---

### 1. Clone the Repository

```bash
git clone https://github.com/paulfruitful/freeaitokens.git
cd freeaitokens
```

---

### 2. Setup

We've bundled a robust, cross-platform **Setup Script** that handles everything for you. It verifies your Node.js version, installs dependencies, downloads Playwright's Chromium browser, creates the necessary Chrome CDP profiles, and runs project checks.

```bash
npm run setup
```

*(Windows users can also double-click `scripts\setup.cmd` or run `scripts\setup.ps1`.)*

---

### 3. Start the Server

Once setup is flawless, simply run our intelligent **Start Script**. This script automatically finds your local Chrome installation, launches it with an exposed Remote Debugging Port (CDP), waits for it to become ready, and then starts the local API server on port `5000`.

```bash
npm start
```

*(Windows users can also double-click `scripts\start.cmd` or run `scripts\start.ps1`.)*

> **Note on First Run:** A Chrome window will open. If you are not logged in, or if you face a Cloudflare verification challenge, simply log in and pass the check manually in that browser window. You only need to do this once per profile!

---

## 📊 Comparison

<div align="center">

| Feature | OpenAI API | Ollama | FreeAITokens |
|----------|:----------:|:-------:|:------------:|
| API Costs | ❌ | ✅ | ✅ |
| Requires Local GPU | ❌ | ✅ | ❌ |
| OpenAI Compatible | ✅ | ✅ | ✅ |
| Uses Browser AI Accounts | ❌ | ❌ | ✅ |
| Works with Existing OpenAI SDKs | ✅ | ✅ | ✅ |
| Runs as Local HTTP Server | ❌ | ✅ | ✅ |

</div>

---

## Usage (OpenAI SDK)
Because `freeaitokens` speaks the exact same protocol as OpenAI, you can point your existing tools directly to `http://localhost:5000/v1`.

```js
const OpenAI = require('openai');

const openai = new OpenAI({
  apiKey: 'any-value', // Not validated, but required by the SDK
  baseURL: 'http://localhost:5000/v1',
});

async function run() {
  const completion = await openai.chat.completions.create({
    model: 'chatgpt-web', // The requested model
    messages: [{ role: 'user', content: 'Say hello in one sentence.' }],
  });

  console.log(completion.choices[0].message.content);
}

run();
```

---

### Streaming Responses

Our server supports real-time text streaming, just like the real API!

```js
const stream = await openai.chat.completions.create({
  model: 'chatgpt-web',
  messages: [{ role: 'user', content: 'Tell me a short story.' }],
  stream: true,
});

for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content ?? '');
}
```

---

## ⚙️ Configuration

You can customize the server behavior using environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `5000` | Server HTTP port |
| `HOST` | `0.0.0.0` | Server bind address |
| `CHAT_URL` | `https://chatgpt.com/` | Target chat page |
| `CDP_PORT` | `9222` | Chrome remote debugging port |
| `USER_DATA_DIR` | `.playwright/chrome-cdp-profile` | Persistent Chrome profile path |
| `DEFAULT_TIMEOUT_MS` | `300000` | Per-request browser timeout (ms) |

---

## 🧠 Advanced: Library Access

While the Server Approach is recommended for universal compatibility, you can still import the core engine directly if you need lower-level control.

```js
const {
  PlaywrightChatClient,
  createChatGPTWebPlugin,
} = require('freeaitokens');

const client = new PlaywrightChatClient({
  launchOptions: { headless: false },
  userDataDir: '.playwright/chatgpt-profile',
});

const plugin = createChatGPTWebPlugin({
  url: 'https://chatgpt.com/',
  manualVerification: true,
});

const session = client.createSession({ plugin });

(async () => {
  await session.start();
  console.log(await session.sendText('Hello world!'));
  await session.close();
})();
```

---

## 🛣️ Roadmap & Upcoming Support

In the coming weeks, we are actively working on adding support for:

- ChatGPT
- Claude
- Gemini
- DeepSeek
- Kimi
- MiniMax
- Qwen

---

## 🤝 Contributing

We want this to become the ultimate OpenAI-compatible local inference bridge.

Contributions are welcome—feel free to open issues, submit pull requests, and help expand provider support.

---

<div align="center">
  <p>Built with ❤️ for every developer.</p>
</div>
