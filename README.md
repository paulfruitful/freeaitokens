<div align="center">
  <h1>⚡ FreeAITokens</h1>
  <p><b>An OpenAI-compatible local server powered by Playwright browser automation, offering free local API inference backed by web-based LLM interfaces.</b></p>
  
  [![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)
  [![Node.js Version](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org/)
  [![Playwright](https://img.shields.io/badge/powered_by-Playwright-2EAD33.svg)](https://playwright.dev/)
  [![Platform Support](https://img.shields.io/badge/plugins-ChatGPT%20%7C%20Gemini%20%7C%20AI%20Studio-orange.svg)](#-supported-plugins)
</div>

---

## 💡 Why I Built This

> *I built this for every developer's local projects without the need for burning cash on API tokens and getting rate-limited. Especially for developers without enough hardware resources to run local models at their full capacity, I built it to provide a free, OpenAI-compatible local inference server backed by browser AI.*

**The Server Approach:** `freeaitokens` operates as a standalone HTTP server that perfectly mimics the OpenAI Chat Completions API (`/v1/chat/completions`). By seamlessly bridging standard API requests to a real automated browser, you can drop it into any existing application, SDK, or tool that speaks to OpenAI—zero code changes required!

---

## 🔌 Supported Plugins & Models

We support multiple web plugins. Each plugin automates browser interactions on the target LLM platform and exposes them via OpenAI-compatible endpoints.

| Platform / Plugin | Model ID | Target URL | Status | Tab Persistence |
| :--- | :--- | :--- | :---: | :---: |
| **ChatGPT Web** | `chatgpt-web` | `https://chatgpt.com/` | 🟢 Active | ❌ Session |
| **Gemini Web** | `gemini-web` | `https://gemini.google.com/` | 🟢 Active | ❌ Session |
| **Google AI Studio** | `aistudio-web`<br>`aistudio-gemini-3.5-flash`<br>`aistudio-gemini-3.1-flash-lite`<br>`aistudio-gemini-3.1-pro-preview` | `https://aistudio.google.com/prompts/new_chat` | 🟢 Active | 🔄 Persistent Tab |
| **Claude Web** | `claude-web` | `https://claude.ai/` | ⚪ Planned | — |
| **DeepSeek Web** | `deepseek-web` | `https://chat.deepseek.com/` | ⚪ Planned | — |
| **Kimi / Moonshot** | `kimi-web` | `https://kimi.moonshot.cn/` | ⚪ Planned | — |
| **Qwen / Alibaba** | `qwen-web` | `https://chat.qwen.ai/` | ⚪ Planned | — |

> [!TIP]
> **AI Studio Tab Persistence:** The Google AI Studio integration is specially optimized to reuse a single open tab for consecutive conversation requests (when running in `CDP_TAB_MODE: "reuse"` or `"last"`/`"first"`). The plugin intelligently detects ongoing chats, prevents page refreshes, and posts only the newest message, keeping your history intact without duplicates!

---

## 🚀 Quick Start

### Prerequisites

Before you begin, make sure you have:
- **Node.js 18 or later** installed.
- **Git** installed.
- Access to the LLM platform accounts (ChatGPT, Gemini, or Google AI Studio).

### 1. Clone the Repository

```bash
git clone https://github.com/paulfruitful/freeaitokens.git
cd freeaitokens
```

### 2. Setup

We've bundled a robust, cross-platform **Setup Script** that handles everything for you. It verifies your Node.js version, installs dependencies, downloads Playwright's Chromium browser, creates the necessary Chrome CDP profiles, and runs checks.

```bash
npm run setup
```

*(Windows users can also double-click `scripts\setup.cmd` or run `scripts\setup.ps1`.)*

### 3. Start the Server

Once setup is complete, run the start script. This script finds your local Chrome installation, launches it with an exposed Remote Debugging Port (CDP), and starts the local API server on port `5000` (along with the dashboard UI on port `5500`).

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

## 💻 Usage (OpenAI SDK)

Because `freeaitokens` speaks the exact same protocol as OpenAI, you can point your existing tools directly to `http://localhost:5000/v1`.

### JavaScript SDK Example

```js
const OpenAI = require('openai');

const openai = new OpenAI({
  apiKey: 'any-value', // Not validated, but required by the SDK
  baseURL: 'http://localhost:5000/v1',
});

async function run() {
  const completion = await openai.chat.completions.create({
    model: 'aistudio-gemini-3.5-flash', // Request target plugin model
    messages: [{ role: 'user', content: 'Say hello in one sentence.' }],
  });

  console.log(completion.choices[0].message.content);
}

run();
```

### Streaming Responses

Our server supports real-time text streaming, just like the real API!

```js
const stream = await openai.chat.completions.create({
  model: 'aistudio-gemini-3.5-flash',
  messages: [{ role: 'user', content: 'Tell me a short story.' }],
  stream: true,
});

for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content ?? '');
}
```

---

## ⚙️ Configuration

You can customize the server behavior using environment variables or the configuration file (`fai-config.json`):

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `5000` | Server HTTP API Port |
| `HOST` | `0.0.0.0` | Server bind host address |
| `CHAT_URL` | `https://chatgpt.com/` | ChatGPT Web interface target URL |
| `AISTUDIO_CHAT_URL` | `https://aistudio.google.com/prompts/new_chat` | AI Studio Web interface target URL |
| `CDP_PORT` | `9222` | Chrome remote debugging port (CDP) |
| `USER_DATA_DIR` | `.playwright/chrome-cdp-profile` | Persistent Chrome profile directory |
| `DEFAULT_TIMEOUT_MS` | `300000` | Per-request Playwright Browser Timeout (ms) |
| `HEADLESS` | `true` | Run browser in Headless Mode (true/false) |
| `MANUAL_VERIFICATION` | `false` | Pause for manual verification check (true/false) |
| `CDP_TAB_MODE` | `new` | CDP Mode tab opening behavior (`new`, `first`, or `last`) |

---

## 🧠 Advanced: Library Access

While the Server Approach is recommended for universal compatibility, you can still import the core engine directly if you need lower-level control.

```js
const {
  PlaywrightChatClient,
  createAIStudioWebPlugin,
} = require('freeaitokens');

const client = new PlaywrightChatClient({
  launchOptions: { headless: false },
  userDataDir: '.playwright/aistudio-profile',
});

const plugin = createAIStudioWebPlugin({
  url: 'https://aistudio.google.com/prompts/new_chat',
  modelName: 'gemini-3.5-flash',
  manualVerification: true,
});

const session = client.createSession({ plugin });

(async () => {
  await session.start();
  // Simulate conversation
  console.log(await session.sendText('Hello world!'));
  await session.close();
})();
```

---

## 🤝 Contributing

We want this to become the ultimate OpenAI-compatible local inference bridge. Contributions are welcome—feel free to open issues, submit pull requests, and help expand provider support.

---

<div align="center">
  <p>Built with ❤️ for every developer.</p>
</div>
