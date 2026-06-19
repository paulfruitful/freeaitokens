# freeaitokens

`freeaitokens` is a plugin-based library for automating browser chat platforms with Playwright.

It gives you:

- a `PlaywrightChatClient` for one-off requests
- a `ChatSession` for multi-turn conversations
- a `PluginRegistry` for named adapters
- a `createSelectorPlugin()` helper for sites that can be automated with DOM selectors

## Install

```bash
npm install
npx playwright install chromium
```

## Quick start

```js
const {
  PlaywrightChatClient,
  createSelectorPlugin,
} = require('freeaitokens');

const supportBot = createSelectorPlugin({
  name: 'support-bot',
  url: 'https://example.com/chat',
  inputMode: 'keyboard',
  selectors: {
    promptInput: 'textarea',
    submitButton: 'button[type="submit"]',
    responseItems: '.assistant-message',
    busyIndicator: '.is-generating',
  },
});

const client = new PlaywrightChatClient({
  launchOptions: { headless: false },
  contextOptions: {
    storageState: '.auth/support-bot.json',
  },
});

(async () => {
  const response = await client.chat({
    plugin: supportBot,
    prompt: 'Summarize the last release notes in three bullet points.',
  });

  console.log(response.text);
})();
```

The default response shape is:

```js
{
  text: '...',
  plugin: 'support-bot',
  prompt: '...',
  turn: 1,
  url: 'https://example.com/chat',
  createdAt: '2026-06-19T00:00:00.000Z',
  raw: {
    previousResponseCount: 0,
    responseCount: 1,
    newResponseTexts: ['...'],
    lastResponseText: '...',
  }
}
```

## Reusing a session

```js
const session = client.createSession({ plugin: supportBot });

await session.start();
console.log(await session.sendText('Hello'));
console.log(await session.sendText('Continue with more detail'));
await session.close();
```

## Writing your own plugin

A plugin is just an object with a `name` and a `send()` function. `open()` and `close()` are optional.

```js
const customPlugin = {
  name: 'custom-chat',
  async open({ page }) {
    await page.goto('https://example.com/chat');
  },
  async send({ page, prompt }) {
    await page.locator('textarea').fill(prompt);
    await page.locator('button[type="submit"]').click();
    const text = await page.locator('.assistant-message').last().innerText();
    return { text };
  },
};
```

## `createSelectorPlugin()` options

`createSelectorPlugin()` is the easiest way to support a new browser chat UI.

Required fields:

- `name`
- `selectors.promptInput`
- `selectors.responseItems`

Common optional fields:

- `url`: string or function returning the chat URL
- `selectors.submitButton`: CSS selector for the send button
- `selectors.busyIndicator`: CSS selector visible while a response is streaming
- `inputMode`: `'fill'` or `'keyboard'`
- `submit.strategy`: `'enter'`, `'click'`, `'custom'`, or `'none'`
- `setup(context)`: run once when the session starts
- `beforeSend(context)` / `afterSend(context)`
- `waitForResponse(context)`: custom waiting logic
- `extractResponse(context)`: override the default text extraction
- `afterResponse(context)`

Use `inputMode: 'keyboard'` for editors built with `contenteditable` rather than a normal `textarea`.

## Notes

- No platform-specific selectors are bundled by default. Browser chat UIs change often, so this setup gives you a stable plugin surface and a generic selector-based adapter rather than shipping brittle hard-coded integrations.
- If a platform requires login, use Playwright `storageState` or your plugin `setup()` hook to establish the authenticated session.
- Some platforms have automation restrictions or terms that may prohibit scripted access. Verify that your usage is allowed before deploying this library against a third-party service.
