const { PluginValidationError, ResponseTimeoutError } = require('../errors');
const { createSelectorPlugin } = require('./generic-chat');

const CHATGPT_WEB_SELECTORS = Object.freeze({
  promptInput: 'div#prompt-textarea',
  submitButton: [
    'button.composer-submit-btn',
    'button[data-testid="send-button"]',
    'button[aria-label="Send prompt"]',
  ].join(', '),
  responseItems: 'div[data-message-author-role="assistant"]',
  busyIndicator: '.result-streaming',
});

function normalizeText(text) {
  if (typeof text !== 'string') {
    return '';
  }

  return text.replace(/\r\n/g, '\n').trim();
}

async function readLocatorText(locator) {
  try {
    return normalizeText(await locator.innerText());
  } catch (error) {
    return normalizeText((await locator.textContent()) || '');
  }
}

async function waitForComposer(page, selectors) {
  const input = page.locator(selectors.promptInput).first();

  await input.waitFor({ state: 'visible' });
  await page.waitForFunction(
    (selector) => {
      const element = document.querySelector(selector);
      return Boolean(element) && element.isContentEditable === true;
    },
    selectors.promptInput
  );

  return input;
}

async function getAssistantSnapshot(page, selector) {
  const locator = page.locator(selector);
  const count = await locator.count();
  const texts = [];

  for (let index = 0; index < count; index += 1) {
    texts.push(await readLocatorText(locator.nth(index)));
  }

  return {
    count,
    texts,
    lastText: texts.length ? texts[texts.length - 1] : '',
  };
}

async function hasVisibleElement(page, selector) {
  if (!selector) {
    return false;
  }

  const locator = page.locator(selector);
  const count = await locator.count();

  for (let index = 0; index < count; index += 1) {
    try {
      if (await locator.nth(index).isVisible()) {
        return true;
      }
    } catch (error) {
      // Ignore detached or stale handles while polling.
    }
  }

  return false;
}

async function waitUntilReadyToSend(page, selectors) {
  await page.waitForFunction(
    ({ inputSelector, buttonSelector }) => {
      const input = document.querySelector(inputSelector);

      if (!input) {
        return false;
      }

      const text = (input.innerText || input.textContent || '').trim();

      if (!text) {
        return false;
      }

      if (!buttonSelector) {
        return true;
      }

      const buttons = Array.from(document.querySelectorAll(buttonSelector));

      if (!buttons.length) {
        return true;
      }

      return buttons.some((button) => {
        const styles = window.getComputedStyle(button);
        return (
          !button.disabled &&
          styles.display !== 'none' &&
          styles.visibility !== 'hidden'
        );
      });
    },
    {
      inputSelector: selectors.promptInput,
      buttonSelector: selectors.submitButton,
    }
  );
}

async function findVisibleEnabledSubmitButton(page, selector) {
  if (!selector) {
    return null;
  }

  const locator = page.locator(selector);
  const count = await locator.count();

  for (let index = 0; index < count; index += 1) {
    const button = locator.nth(index);

    try {
      if ((await button.isVisible()) && (await button.isEnabled())) {
        return button;
      }
    } catch (error) {
      // Ignore detached or stale handles while polling.
    }
  }

  return null;
}

async function submitPrompt({ page, inputLocator, config }) {
  await waitUntilReadyToSend(page, config.selectors);

  const submitButton = await findVisibleEnabledSubmitButton(
    page,
    config.selectors.submitButton
  );

  if (submitButton) {
    await submitButton.click();
    return;
  }

  await inputLocator.press('Enter');
}

async function waitForAssistantResponse({ page, previousResponse, config }) {
  const deadline = Date.now() + config.responseTimeoutMs;
  let sawStreaming = false;
  let sawChange = false;
  let lastCandidate = '';
  let stableSince = 0;

  while (Date.now() < deadline) {
    const snapshot = await getAssistantSnapshot(page, config.selectors.responseItems);
    const busy = await hasVisibleElement(page, config.selectors.busyIndicator);
    const newTexts = snapshot.texts.slice(previousResponse.count).filter(Boolean);
    const candidate = newTexts.length
      ? newTexts.join('\n\n')
      : snapshot.lastText && snapshot.lastText !== previousResponse.lastText
        ? snapshot.lastText
        : '';

    if (busy) {
      sawStreaming = true;
    }

    if (snapshot.count > previousResponse.count || candidate) {
      sawChange = true;
    }

    if (candidate) {
      if (candidate === lastCandidate && !busy) {
        if (!stableSince) {
          stableSince = Date.now();
        }
      } else {
        lastCandidate = candidate;
        stableSince = busy ? 0 : Date.now();
      }
    }

    if (
      sawChange &&
      candidate &&
      !busy &&
      stableSince &&
      Date.now() - stableSince >= config.responseStabilityMs
    ) {
      return;
    }

    if (
      sawStreaming &&
      !busy &&
      snapshot.count > previousResponse.count &&
      !candidate
    ) {
      if (!stableSince) {
        stableSince = Date.now();
      } else if (Date.now() - stableSince >= config.responseStabilityMs) {
        return;
      }
    }

    await page.waitForTimeout(config.pollIntervalMs);
  }

  throw new ResponseTimeoutError(
    `Timed out after ${config.responseTimeoutMs}ms waiting for a completed assistant response from plugin "${config.name}".`
  );
}

function createChatGPTWebPlugin(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new PluginValidationError(
      'ChatGPT web plugin options must be an object.'
    );
  }

  const {
    name = 'chatgpt-web',
    url = 'https://chatgpt.com/',
    selectors = {},
    waitForReady = null,
    navigateOnStart = true,
    navigateEveryTurn = false,
    gotoOptions = {},
    responseTimeoutMs = 180000,
    responseStabilityMs = 1800,
    pollIntervalMs = 300,
  } = options;

  if (waitForReady && typeof waitForReady !== 'function') {
    throw new PluginValidationError(
      'ChatGPT web plugin `waitForReady` must be a function when provided.'
    );
  }

  const mergedSelectors = {
    ...CHATGPT_WEB_SELECTORS,
    ...(selectors || {}),
  };

  return createSelectorPlugin({
    name,
    url,
    navigateOnStart,
    navigateEveryTurn,
    gotoOptions: {
      waitUntil: 'domcontentloaded',
      ...(gotoOptions || {}),
    },
    inputMode: 'keyboard',
    fallbackToKeyboard: true,
    responseTimeoutMs,
    responseStabilityMs,
    pollIntervalMs,
    selectors: mergedSelectors,
    async setup(context) {
      await waitForComposer(context.page, mergedSelectors);

      if (typeof waitForReady === 'function') {
        await waitForReady({
          ...context,
          selectors: mergedSelectors,
        });
      }
    },
    async beforeSend(context) {
      await waitForComposer(context.page, mergedSelectors);
    },
    submit: {
      strategy: 'custom',
      async run(context) {
        await submitPrompt(context);
      },
    },
    async waitForResponse(context) {
      await waitForAssistantResponse(context);
    },
    async extractResponse({ responseDetails, defaultText }) {
      const segments = responseDetails.newTexts.map(normalizeText).filter(Boolean);
      const text = segments.length ? segments.join('\n\n') : normalizeText(defaultText);

      return {
        text,
        segments,
        lastSegment: segments.length ? segments[segments.length - 1] : text,
      };
    },
  });
}

module.exports = {
  CHATGPT_WEB_SELECTORS,
  createChatGPTWebPlugin,
};
