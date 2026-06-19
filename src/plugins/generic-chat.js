const { PluginValidationError, ResponseTimeoutError } = require('../errors');
const { definePlugin } = require('../plugin-registry');

function validateSelectorPluginConfig(config) {
  if (!config || typeof config !== 'object') {
    throw new PluginValidationError('Selector plugins require a configuration object.');
  }

  if (!config.name || typeof config.name !== 'string') {
    throw new PluginValidationError('Selector plugins require a non-empty `name` string.');
  }

  if (config.url && typeof config.url !== 'string' && typeof config.url !== 'function') {
    throw new PluginValidationError(
      `Selector plugin "${config.name}" has an invalid \`url\` value. Expected a string or function.`
    );
  }

  if (!config.selectors || typeof config.selectors !== 'object') {
    throw new PluginValidationError(
      `Selector plugin "${config.name}" must define a \`selectors\` object.`
    );
  }

  if (!config.selectors.promptInput || typeof config.selectors.promptInput !== 'string') {
    throw new PluginValidationError(
      `Selector plugin "${config.name}" must define \`selectors.promptInput\`.`
    );
  }

  if (!config.selectors.responseItems || typeof config.selectors.responseItems !== 'string') {
    throw new PluginValidationError(
      `Selector plugin "${config.name}" must define \`selectors.responseItems\`.`
    );
  }

  if (config.selectors.submitButton && typeof config.selectors.submitButton !== 'string') {
    throw new PluginValidationError(
      `Selector plugin "${config.name}" has an invalid \`selectors.submitButton\` value.`
    );
  }

  if (config.selectors.busyIndicator && typeof config.selectors.busyIndicator !== 'string') {
    throw new PluginValidationError(
      `Selector plugin "${config.name}" has an invalid \`selectors.busyIndicator\` value.`
    );
  }

  if (config.inputMode && !['fill', 'keyboard'].includes(config.inputMode)) {
    throw new PluginValidationError(
      `Selector plugin "${config.name}" has an invalid \`inputMode\`. Use "fill" or "keyboard".`
    );
  }

  if (config.submit && typeof config.submit !== 'object') {
    throw new PluginValidationError(
      `Selector plugin "${config.name}" has an invalid \`submit\` value. Expected an object.`
    );
  }

  if (
    config.submit &&
    config.submit.strategy &&
    !['enter', 'click', 'custom', 'none'].includes(config.submit.strategy)
  ) {
    throw new PluginValidationError(
      `Selector plugin "${config.name}" has an invalid \`submit.strategy\` value.`
    );
  }

  if (config.submit && config.submit.run && typeof config.submit.run !== 'function') {
    throw new PluginValidationError(
      `Selector plugin "${config.name}" has an invalid \`submit.run\` value. Expected a function.`
    );
  }

  for (const hookName of [
    'setup',
    'beforeSend',
    'afterSend',
    'waitForResponse',
    'extractResponse',
    'afterResponse',
  ]) {
    if (config[hookName] && typeof config[hookName] !== 'function') {
      throw new PluginValidationError(
        `Selector plugin "${config.name}" has an invalid \`${hookName}\` hook. Expected a function.`
      );
    }
  }
}

function normalizeText(text) {
  if (typeof text !== 'string') {
    return '';
  }

  return text.replace(/\r\n/g, '\n').trim();
}

async function resolveValue(value, context) {
  if (typeof value === 'function') {
    return value(context);
  }

  return value;
}

async function readLocatorText(locator) {
  try {
    return normalizeText(await locator.innerText());
  } catch (error) {
    return normalizeText((await locator.textContent()) || '');
  }
}

async function captureResponseSummary(page, responseSelector) {
  const locator = page.locator(responseSelector);
  const count = await locator.count();
  const lastText = count > 0 ? await readLocatorText(locator.nth(count - 1)) : '';

  return {
    count,
    lastText,
  };
}

async function captureResponseDetails(page, responseSelector, previousResponse) {
  const locator = page.locator(responseSelector);
  const count = await locator.count();

  if (count === 0) {
    return {
      count: 0,
      newTexts: [],
      lastText: '',
    };
  }

  if (count > previousResponse.count) {
    const newTexts = [];

    for (let index = previousResponse.count; index < count; index += 1) {
      newTexts.push(await readLocatorText(locator.nth(index)));
    }

    return {
      count,
      newTexts,
      lastText: newTexts.length ? newTexts[newTexts.length - 1] : '',
    };
  }

  const lastText = await readLocatorText(locator.nth(count - 1));

  return {
    count,
    newTexts: [],
    lastText,
  };
}

async function isBusy(page, busyIndicatorSelector) {
  if (!busyIndicatorSelector) {
    return false;
  }

  const locator = page.locator(busyIndicatorSelector);
  const count = await locator.count();

  if (!count) {
    return false;
  }

  try {
    return await locator.first().isVisible();
  } catch (error) {
    return false;
  }
}

async function fillWithKeyboard(page, inputLocator, prompt) {
  await inputLocator.click();
  await inputLocator.press('ControlOrMeta+A').catch(() => {});
  await page.keyboard.press('Backspace').catch(() => {});
  await page.keyboard.insertText(prompt);
}

async function writePrompt(page, inputLocator, prompt, config) {
  if (config.inputMode === 'keyboard') {
    await fillWithKeyboard(page, inputLocator, prompt);
    return;
  }

  try {
    await inputLocator.fill(prompt);
  } catch (error) {
    if (!config.fallbackToKeyboard) {
      throw error;
    }

    await fillWithKeyboard(page, inputLocator, prompt);
  }
}

async function submitPrompt(page, inputLocator, config, context) {
  const submitConfig = config.submit || {};
  const strategy = submitConfig.strategy || (config.selectors.submitButton ? 'click' : 'enter');

  if (strategy === 'none') {
    return;
  }

  if (strategy === 'custom') {
    if (typeof submitConfig.run !== 'function') {
      throw new PluginValidationError(
        `Selector plugin "${config.name}" uses a custom submit strategy but does not define \`submit.run\`.`
      );
    }

    await submitConfig.run({
      ...context,
      inputLocator,
    });
    return;
  }

  if (strategy === 'click') {
    const buttonSelector = submitConfig.selector || config.selectors.submitButton;

    if (!buttonSelector) {
      throw new PluginValidationError(
        `Selector plugin "${config.name}" cannot click submit without a button selector.`
      );
    }

    const button = page.locator(buttonSelector).first();
    await button.waitFor({ state: 'visible' });
    await button.click();
    return;
  }

  await inputLocator.press(submitConfig.key || 'Enter');
}

function extractFreshText(previousResponse, responseDetails) {
  const newTexts = responseDetails.newTexts.filter(Boolean);

  if (newTexts.length) {
    return newTexts.join('\n\n');
  }

  if (responseDetails.lastText && responseDetails.lastText !== previousResponse.lastText) {
    return responseDetails.lastText;
  }

  return responseDetails.lastText || '';
}

async function waitForStableResponse(page, config, previousResponse) {
  const deadline = Date.now() + config.responseTimeoutMs;
  let sawNewContent = false;
  let lastObservedText = '';
  let stableSince = 0;

  while (Date.now() < deadline) {
    const currentResponse = await captureResponseSummary(
      page,
      config.selectors.responseItems
    );
    const busy = await isBusy(page, config.selectors.busyIndicator);
    const hasNewItems = currentResponse.count > previousResponse.count;
    const hasChangedText =
      currentResponse.lastText && currentResponse.lastText !== previousResponse.lastText;
    const candidateText = extractFreshText(previousResponse, {
      ...currentResponse,
      newTexts: [],
    });

    if (hasNewItems || hasChangedText) {
      sawNewContent = true;
    }

    if (sawNewContent && candidateText) {
      if (candidateText === lastObservedText) {
        if (!stableSince) {
          stableSince = Date.now();
        }
      } else {
        lastObservedText = candidateText;
        stableSince = Date.now();
      }

      if (!busy && Date.now() - stableSince >= config.responseStabilityMs) {
        return;
      }
    }

    await page.waitForTimeout(config.pollIntervalMs);
  }

  throw new ResponseTimeoutError(
    `Timed out after ${config.responseTimeoutMs}ms waiting for a response from plugin "${config.name}".`
  );
}

async function maybeNavigate(config, context) {
  if (!config.url) {
    return;
  }

  const url = await resolveValue(config.url, context);

  if (!url) {
    return;
  }

  await context.page.goto(url, config.gotoOptions);
}

function normalizeExtractedResponse(result, fallbackResponse, pluginName) {
  if (typeof result === 'undefined' || result === null) {
    return fallbackResponse;
  }

  if (typeof result === 'string') {
    return {
      ...fallbackResponse,
      text: result,
    };
  }

  if (result && typeof result === 'object' && typeof result.text === 'string') {
    return {
      ...fallbackResponse,
      ...result,
    };
  }

  throw new PluginValidationError(
    `Selector plugin "${pluginName}" returned an invalid extracted response. Expected undefined, a string, or an object with a \`text\` property.`
  );
}

function createSelectorPlugin(config) {
  validateSelectorPluginConfig(config);

  const normalizedConfig = {
    navigateOnStart: true,
    navigateEveryTurn: false,
    gotoOptions: {
      waitUntil: 'domcontentloaded',
      ...(config.gotoOptions || {}),
    },
    inputMode: 'fill',
    fallbackToKeyboard: true,
    responseTimeoutMs: 120000,
    responseStabilityMs: 1500,
    pollIntervalMs: 300,
    ...config,
    submit: config.submit ? { ...config.submit } : undefined,
  };

  return definePlugin({
    name: normalizedConfig.name,
    async open(context) {
      if (normalizedConfig.url && normalizedConfig.navigateOnStart !== false) {
        await maybeNavigate(normalizedConfig, context);
      }

      if (typeof normalizedConfig.setup === 'function') {
        await normalizedConfig.setup({
          ...context,
          config: normalizedConfig,
        });
      }
    },
    async send(context) {
      if (normalizedConfig.url && normalizedConfig.navigateEveryTurn) {
        await maybeNavigate(normalizedConfig, context);
      }

      const previousResponse = await captureResponseSummary(
        context.page,
        normalizedConfig.selectors.responseItems
      );
      const inputLocator = context.page
        .locator(normalizedConfig.selectors.promptInput)
        .first();

      await inputLocator.waitFor({ state: 'visible' });

      if (typeof normalizedConfig.beforeSend === 'function') {
        await normalizedConfig.beforeSend({
          ...context,
          config: normalizedConfig,
          previousResponse,
          inputLocator,
        });
      }

      await writePrompt(
        context.page,
        inputLocator,
        context.prompt,
        normalizedConfig
      );
      await submitPrompt(context.page, inputLocator, normalizedConfig, {
        ...context,
        config: normalizedConfig,
      });

      if (typeof normalizedConfig.afterSend === 'function') {
        await normalizedConfig.afterSend({
          ...context,
          config: normalizedConfig,
          previousResponse,
          inputLocator,
        });
      }

      if (typeof normalizedConfig.waitForResponse === 'function') {
        await normalizedConfig.waitForResponse({
          ...context,
          config: normalizedConfig,
          previousResponse,
        });
      } else {
        await waitForStableResponse(context.page, normalizedConfig, previousResponse);
      }

      const responseDetails = await captureResponseDetails(
        context.page,
        normalizedConfig.selectors.responseItems,
        previousResponse
      );
      const defaultText = extractFreshText(previousResponse, responseDetails);
      const fallbackResponse = {
        text: defaultText,
        raw: {
          previousResponseCount: previousResponse.count,
          responseCount: responseDetails.count,
          newResponseTexts: responseDetails.newTexts,
          lastResponseText: responseDetails.lastText,
        },
      };

      let response = fallbackResponse;

      if (typeof normalizedConfig.extractResponse === 'function') {
        const extractedResponse = await normalizedConfig.extractResponse({
          ...context,
          config: normalizedConfig,
          previousResponse,
          responseDetails,
          responseLocator: context.page.locator(
            normalizedConfig.selectors.responseItems
          ),
          defaultText,
        });

        response = normalizeExtractedResponse(
          extractedResponse,
          fallbackResponse,
          normalizedConfig.name
        );
      }

      if (typeof normalizedConfig.afterResponse === 'function') {
        await normalizedConfig.afterResponse({
          ...context,
          config: normalizedConfig,
          previousResponse,
          responseDetails,
          response,
        });
      }

      return response;
    },
  });
}

module.exports = {
  createSelectorPlugin,
};
