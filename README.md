# freeaitokens

`freeaitokens` is a plugin-based library for automating browser chat platforms with Playwright.

It gives you:

- a `PlaywrightChatClient` for one-off requests
- a `ChatSession` for multi-turn conversations
- a `PluginRegistry` for named adapters
- a `createSelectorPlugin()` helper for sites that can be automated with DOM selectors
- a bundled `createChatGPTWebPlugin()` implementation for the ChatGPT-style page structure captured in your markdown

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

## ChatGPT web implementation

The collected page details in your markdown point to a ChatGPT-style web app with these stable selectors:

- prompt editor: `div#prompt-textarea`
- send button: `button.composer-submit-btn` or `button[data-testid="send-button"]`
- assistant turns: `div[data-message-author-role="assistant"]`
- streaming marker: `.result-streaming`

This package now includes a plugin factory tuned for that flow:

```js
const {
  PlaywrightChatClient,
  createChatGPTWebPlugin,
} = require('freeaitokens');

const client = new PlaywrightChatClient({
  launchOptions: {
    headless: false,
  },
  contextOptions: {
    storageState: '.auth/chatgpt.json',
  },
});

const plugin = createChatGPTWebPlugin({
  url: 'https://chatgpt.com/',
});

const session = client.createSession({ plugin });

await session.start();
console.log(await session.sendText('Hello'));
console.log(await session.sendText('Continue with more detail'));
await session.close();
```

### How this implementation works

`createChatGPTWebPlugin()` follows the interaction pattern shown in your exported DevTools session:

1. open the page and wait for `#prompt-textarea` to become a visible `contenteditable` editor
2. type into the ProseMirror editor with keyboard events instead of `.fill()`
3. wait for the send button to become enabled
4. click the visible send button, with `Enter` as a fallback
5. monitor `div[data-message-author-role="assistant"]` for new assistant turns
6. treat `.result-streaming` as the in-progress marker and wait for the response to settle before returning text

The returned response includes:

- `text`: the aggregated new assistant content for that turn
- `segments`: the raw new assistant blocks captured during that turn
- `lastSegment`: the last captured assistant block

This matters because some turns can render multiple assistant blocks, such as a widget followed by explanatory text.

### Running the example script

```bash
node examples/chatgpt-web-session.js "Hello" "Continue with more detail"
```

The example keeps a single Playwright session open so each prompt continues the same conversation.

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

- A ChatGPT web plugin is bundled as a reference implementation for the selector pattern captured in your markdown. For everything else, prefer `createSelectorPlugin()` or a custom plugin so you can adapt as the target UI changes.
- If a platform requires login, use Playwright `storageState` or your plugin `setup()` hook to establish the authenticated session.
- Browser chat UIs change often. Expect to revisit selectors and response extraction logic over time.
- Some platforms have automation restrictions or terms that may prohibit scripted access. Verify that your usage is allowed before deploying this library against a third-party service.
