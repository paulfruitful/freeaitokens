const {
  PluginValidationError,
  ResponseTimeoutError,
  NetworkDiagnosticsError,
} = require("../errors");
const { createSelectorPlugin } = require("./generic-chat");

const AISTUDIO_WEB_SELECTORS = Object.freeze({
  promptInput: '.prompt-box-container textarea',
  submitButton: 'button.ctrl-enter-submits.ms-button-primary',
  responseItems: 'ms-cmark-node.cmark-node',
  busyIndicator: 'ms-stop-button, .ms-stop-button, .generating, .loading, button[aria-label*="Stop"], button.ms-stop-button',
  modelSelectorTrigger: 'button.model-selector-card',
  modelOptionsPanel: 'ms-sliding-right-panel .model-options-container, .model-options-container',
  modelButton: 'button.content-button',
  errorIndicator: '.model-error',
});

const DEFAULT_NETWORK_DIAGNOSTIC_PATTERNS = Object.freeze([
  /^https?:\/\/(?:[a-z0-9-]+\.)*aistudio\.google\.com/i,
]);

const DEFAULT_DIAGNOSTIC_HEADERS = Object.freeze([
  "content-type",
  "server",
]);

async function humanDelay(min = 150, max = 350) {
  const ms = Math.floor(Math.random() * (max - min + 1) + min);
  await new Promise(resolve => setTimeout(resolve, ms));
}

async function dispatchMouseEventClick(locator) {
  await locator.evaluate(btn => {
    ['mousedown', 'mouseup', 'click'].forEach(type => {
      btn.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
    });
  });
}

function normalizeText(text) {
  if (typeof text !== "string") {
    return "";
  }
  return text.replace(/\r\n/g, "\n").trim();
}

function truncateText(text, maxLength) {
  if (typeof text !== "string") {
    return "";
  }
  if (!Number.isFinite(maxLength) || maxLength <= 0 || text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}\n...[truncated ${text.length - maxLength} chars]`;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeHeaders(headers) {
  const normalized = {};
  for (const [name, value] of Object.entries(headers || {})) {
    normalized[name.toLowerCase()] = value;
  }
  return normalized;
}

function pickHeaders(headers, names) {
  const normalized = normalizeHeaders(headers);
  const result = {};
  for (const name of names) {
    if (typeof normalized[name] !== "undefined") {
      result[name] = normalized[name];
    }
  }
  return result;
}

function matchesUrlPattern(url, pattern) {
  if (pattern instanceof RegExp) {
    return pattern.test(url);
  }
  if (typeof pattern === "string") {
    return url.includes(pattern);
  }
  if (typeof pattern === "function") {
    return Boolean(pattern(url));
  }
  return false;
}

async function resolveValue(value, context) {
  if (typeof value === "function") {
    return value(context);
  }
  return value;
}

function looksLikeCloudflareChallenge(bodySnippet, headers) {
  const text = (bodySnippet || "").toLowerCase();
  return (
    text.includes("enable javascript and cookies to continue") ||
    text.includes("window._cf_chl_opt") ||
    text.includes("/cdn-cgi/challenge-platform/") ||
    text.includes("challenge-error-text") ||
    Boolean(headers["cf-mitigated"])
  );
}

function looksLikeCloudflareInterstitialText(text) {
  const normalized = (text || "").toLowerCase();
  return (
    looksLikeCloudflareChallenge(normalized, {}) ||
    normalized.includes("verify you are human") ||
    normalized.includes("checking your browser before accessing") ||
    normalized.includes("just a moment") ||
    normalized.includes("please unblock challenges.cloudflare.com to proceed") ||
    normalized.includes("attention required") ||
    normalized.includes("sorry, you have been blocked")
  );
}

function createManualVerificationConfig(manualVerification = false) {
  if (typeof manualVerification === "boolean") {
    return {
      enabled: manualVerification,
      timeoutMs: 300000,
      pollIntervalMs: 500,
    };
  }
  if (!isPlainObject(manualVerification)) {
    throw new PluginValidationError(
      "AI Studio web plugin `manualVerification` must be a boolean or an object when provided.",
    );
  }
  const {
    enabled = true,
    timeoutMs = 300000,
    pollIntervalMs = 500,
  } = manualVerification;
  return {
    enabled,
    timeoutMs,
    pollIntervalMs,
  };
}

function createNetworkDiagnosticsConfig(networkDiagnostics = {}) {
  if (!isPlainObject(networkDiagnostics)) {
    throw new PluginValidationError(
      "AI Studio web plugin `networkDiagnostics` must be an object when provided.",
    );
  }
  const {
    enabled = true,
    urlPatterns = DEFAULT_NETWORK_DIAGNOSTIC_PATTERNS,
    includeHeaders = DEFAULT_DIAGNOSTIC_HEADERS,
    maxEntries = 5,
    bodySnippetLimit = 2000,
  } = networkDiagnostics;
  return {
    enabled,
    urlPatterns: [...urlPatterns],
    includeHeaders: includeHeaders.map((header) => String(header).toLowerCase()),
    maxEntries,
    bodySnippetLimit,
  };
}

function shouldInspectUrl(url, diagnosticsConfig) {
  if (!diagnosticsConfig.enabled) {
    return false;
  }
  return diagnosticsConfig.urlPatterns.some((pattern) =>
    matchesUrlPattern(url, pattern),
  );
}

async function readLocatorText(locator) {
  try {
    return normalizeText(await locator.innerText());
  } catch (error) {
    return normalizeText((await locator.textContent()) || "");
  }
}

async function isComposerReady(page, selectors) {
  const input = page.locator(selectors.promptInput).first();
  try {
    if (!(await input.isVisible())) {
      return false;
    }
  } catch (error) {
    return false;
  }
  try {
    return await page.evaluate((selector) => {
      const element = document.querySelector(selector);
      return Boolean(element);
    }, selectors.promptInput);
  } catch (error) {
    return false;
  }
}

async function readPageChallengeSnippet(page, maxLength) {
  try {
    const pageText = await page.evaluate(
      (snippetLimit) => {
        const title = document.title || "";
        const bodyText = document.body ? (document.body.innerText || "").slice(0, snippetLimit) : "";
        const html = document.documentElement ? (document.documentElement.innerHTML || "").slice(0, snippetLimit) : "";
        return [title, bodyText, html].filter(Boolean).join("\n\n");
      },
      Math.max(maxLength * 2, 4000),
    );
    return truncateText(normalizeText(pageText), maxLength);
  } catch (error) {
    return `[page content unavailable: ${error.message}]`;
  }
}

function buildChallengePageDiagnostics(page, bodySnippet) {
  const entry = {
    url: page.url(),
    method: "GET",
    resourceType: "document",
    status: 0,
    statusText: "Challenge page",
    contentType: "text/html",
    headers: {},
    bodySnippet,
    isCloudflareChallenge: true,
    timestamp: new Date().toISOString(),
  };
  return {
    monitoredResponseCount: 0,
    suspiciousResponseCount: 1,
    requestFailureCount: 0,
    blockingResponse: entry,
    monitoredResponses: [],
    suspiciousResponses: [entry],
    requestFailures: [],
  };
}

function buildChallengePageError(pluginName, page, bodySnippet, manualVerificationEnabled) {
  const message = manualVerificationEnabled
    ? `Managed challenge is still blocking ${page.url()} while using plugin "${pluginName}". Complete the verification in the browser, then retry.`
    : `Detected a managed challenge page at ${page.url()} while using plugin "${pluginName}". Run headful with a persistent user data directory to complete verification manually.`;
  return new NetworkDiagnosticsError(message, {
    diagnostics: buildChallengePageDiagnostics(page, bodySnippet),
  });
}

async function waitForComposer(page, selectors, options = {}) {
  const {
    timeoutMs = 120000,
    pollIntervalMs = 300,
    pluginName = "aistudio-web",
    manualVerification = { enabled: false, timeoutMs: 300000, pollIntervalMs: 500 },
    bodySnippetLimit = 2000,
  } = options;
  const input = page.locator(selectors.promptInput).first();
  const effectiveTimeoutMs = manualVerification.enabled
    ? Math.max(timeoutMs, manualVerification.timeoutMs)
    : timeoutMs;
  const deadline = Date.now() + effectiveTimeoutMs;
  let lastChallengeSnippet = "";

  while (Date.now() < deadline) {
    if (await isComposerReady(page, selectors)) {
      return input;
    }
    const pageSnippet = await readPageChallengeSnippet(page, bodySnippetLimit);
    const challengeDetected = looksLikeCloudflareInterstitialText(pageSnippet);
    if (challengeDetected) {
      lastChallengeSnippet = pageSnippet;
      if (!manualVerification.enabled) {
        throw buildChallengePageError(pluginName, page, pageSnippet, false);
      }
    }
    await page.waitForTimeout(
      challengeDetected && manualVerification.enabled
        ? manualVerification.pollIntervalMs
        : pollIntervalMs,
    );
  }
  if (lastChallengeSnippet) {
    throw buildChallengePageError(pluginName, page, lastChallengeSnippet, manualVerification.enabled);
  }
  throw new ResponseTimeoutError(
    `Timed out after ${effectiveTimeoutMs}ms waiting for the AI Studio chat composer in plugin "${pluginName}".`,
  );
}

function createCollector(page, diagnosticsConfig) {
  const state = {
    monitoredResponses: [],
    suspiciousResponses: [],
    requestFailures: [],
  };
  const pendingTasks = new Set();

  const onResponse = (response) => {
    const task = (async () => {
      const url = response.url();
      if (!shouldInspectUrl(url, diagnosticsConfig)) return;
      const request = response.request();
      const headers = normalizeHeaders(response.headers());
      const contentType = headers["content-type"] || "";
      let bodySnippet = "";
      if (response.status() >= 400 || contentType.toLowerCase().includes("text/html")) {
        try {
          bodySnippet = truncateText(await response.text(), diagnosticsConfig.bodySnippetLimit);
        } catch (error) {
          bodySnippet = `[body unavailable: ${error.message}]`;
        }
      }
      const entry = {
        url,
        method: request.method(),
        resourceType: request.resourceType(),
        status: response.status(),
        statusText: response.statusText(),
        contentType,
        headers: pickHeaders(headers, diagnosticsConfig.includeHeaders),
        bodySnippet,
        isCloudflareChallenge: looksLikeCloudflareChallenge(bodySnippet, headers),
        timestamp: new Date().toISOString(),
      };
      state.monitoredResponses.push({
        url: entry.url,
        method: entry.method,
        resourceType: entry.resourceType,
        status: entry.status,
        statusText: entry.statusText,
        contentType: entry.contentType,
        timestamp: entry.timestamp,
      });
      if (entry.status >= 400 || entry.isCloudflareChallenge) {
        state.suspiciousResponses.push(entry);
      }
    })();
    pendingTasks.add(task);
    task.finally(() => pendingTasks.delete(task));
  };

  const onRequestFailed = (request) => {
    const url = request.url();
    if (!shouldInspectUrl(url, diagnosticsConfig)) return;
    state.requestFailures.push({
      url,
      method: request.method(),
      resourceType: request.resourceType(),
      failureText: request.failure() ? request.failure().errorText : "unknown",
      timestamp: new Date().toISOString(),
    });
  };

  const dispose = () => {
    page.off("response", onResponse);
    page.off("requestfailed", onRequestFailed);
  };

  page.on("response", onResponse);
  page.on("requestfailed", onRequestFailed);
  page.once("close", dispose);

  return {
    createSnapshot() {
      return {
        monitoredResponseIndex: state.monitoredResponses.length,
        suspiciousResponseIndex: state.suspiciousResponses.length,
        requestFailureIndex: state.requestFailures.length,
      };
    },
    async flush() {
      if (!pendingTasks.size) return;
      await Promise.allSettled(Array.from(pendingTasks));
    },
    summarizeSince(snapshot = null) {
      const normalizedSnapshot = snapshot || {
        monitoredResponseIndex: 0,
        suspiciousResponseIndex: 0,
        requestFailureIndex: 0,
      };
      const monitoredResponses = state.monitoredResponses.slice(normalizedSnapshot.monitoredResponseIndex);
      const suspiciousResponses = state.suspiciousResponses.slice(normalizedSnapshot.suspiciousResponseIndex);
      const requestFailures = state.requestFailures.slice(normalizedSnapshot.requestFailureIndex);
      const blockingResponse = suspiciousResponses.find(r => r.status === 403 || r.isCloudflareChallenge) || null;
      return {
        monitoredResponseCount: monitoredResponses.length,
        suspiciousResponseCount: suspiciousResponses.length,
        requestFailureCount: requestFailures.length,
        blockingResponse,
        monitoredResponses: monitoredResponses.slice(-diagnosticsConfig.maxEntries),
        suspiciousResponses: suspiciousResponses.slice(-diagnosticsConfig.maxEntries),
        requestFailures: requestFailures.slice(-diagnosticsConfig.maxEntries),
      };
    },
    dispose,
  };
}

function buildNetworkDiagnosticsError(pluginName, diagnostics, fallbackMessage, cause) {
  const blocking = diagnostics.blockingResponse;
  let message = fallbackMessage || `Monitored network requests failed while using plugin "${pluginName}".`;
  if (blocking) {
    if (blocking.isCloudflareChallenge) {
      message = `Received a challenge response from ${blocking.url} while using plugin "${pluginName}".`;
    } else {
      message = `Received HTTP ${blocking.status} from ${blocking.url} while using plugin "${pluginName}".`;
    }
  } else if (diagnostics.requestFailureCount) {
    const failure = diagnostics.requestFailures[diagnostics.requestFailures.length - 1];
    message = `A monitored network request failed while using plugin "${pluginName}" (${failure.method} ${failure.url}).`;
  }
  return new NetworkDiagnosticsError(message, { cause, diagnostics });
}

function cleanModelName(name) {
  if (typeof name !== 'string') return '';
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

async function selectModel(page, targetModel, selectors, isDefaultModel = false) {
  if (!targetModel) return;

  const trigger = page.locator(selectors.modelSelectorTrigger).first();
  await trigger.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
  if (!(await trigger.isVisible())) {
    console.warn("[FAI] AI Studio model selector trigger button not found.");
    return;
  }

  // Check currently selected model using trigger innerText or span.title
  const titleSpan = trigger.locator('span.title').first();
  const titleText = (await titleSpan.isVisible().catch(() => false))
    ? await titleSpan.innerText().catch(() => '')
    : await trigger.innerText().catch(() => '');

  // Clean names for matching
  const cleanedTitle = cleanModelName(titleText);
  const cleanedTarget = cleanModelName(targetModel);

  // 1. If it's already the exact target model
  if (cleanedTitle.includes(cleanedTarget) || cleanedTarget.includes(cleanedTitle)) {
    return;
  }

  // 2. Default/generic mode check: If target model is a generic gemini request,
  // and the currently selected title is already any Gemini model, skip selection.
  if (isDefaultModel) {
    const isTargetGenericGemini = targetModel.toLowerCase().includes('gemini');
    const isAlreadyGemini = titleText.toLowerCase().includes('gemini');
    if (isTargetGenericGemini && isAlreadyGemini) {
      console.log(`[FAI] Already set on a Gemini model: "${titleText}". Skipping selection.`);
      return;
    }
  }

  console.log(`[FAI] Selecting AI Studio model: ${targetModel}`);
  await dispatchMouseEventClick(trigger);

  const panel = page.locator(selectors.modelOptionsPanel).first();
  await panel.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
  if (!(await panel.isVisible())) {
    console.warn("[FAI] AI Studio model options panel failed to show up.");
    return;
  }

  // Find target button by ID prefix/suffix
  let button = page.locator(`button.content-button[id*="${targetModel}"]`).first();
  if (await button.count() === 0) {
    // Fallback 1: Match button's text content
    const buttons = page.locator('button.content-button');
    const count = await buttons.count();
    for (let i = 0; i < count; i++) {
      const btn = buttons.nth(i);
      const text = await btn.innerText();
      if (text.toLowerCase().includes(targetModel.toLowerCase())) {
        button = btn;
        break;
      }
    }
  }

  // Fallback 2: If model is not found, try to search for it using the filter input
  if (await button.count() === 0) {
    const searchInput = page.locator('ms-sliding-right-panel input, ms-model-selector input, input[placeholder*="Search"]').first();
    if (await searchInput.count() > 0 && await searchInput.isVisible()) {
      console.log(`[FAI] Model "${targetModel}" not immediately found. Using search filter...`);
      await searchInput.click().catch(() => {});
      await searchInput.fill(targetModel).catch(() => {});
      await page.waitForTimeout(1000); // Wait for filtering to complete
      
      // Re-query target button
      button = page.locator(`button.content-button[id*="${targetModel}"]`).first();
      if (await button.count() === 0) {
        const buttons = page.locator('button.content-button');
        const count = await buttons.count();
        for (let i = 0; i < count; i++) {
          const btn = buttons.nth(i);
          const text = await btn.innerText();
          if (text.toLowerCase().includes(targetModel.toLowerCase())) {
            button = btn;
            break;
          }
        }
      }
    }
  }

  // Fallback 3: Select first available Gemini model if target still not found
  if (await button.count() === 0) {
    const buttons = page.locator('button.content-button');
    const count = await buttons.count();
    for (let i = 0; i < count; i++) {
      const btn = buttons.nth(i);
      const id = await btn.getAttribute('id').catch(() => '');
      const text = await btn.innerText();
      if (id.toLowerCase().includes('gemini') || text.toLowerCase().includes('gemini')) {
        button = btn;
        break;
      }
    }
  }

  if (await button.count() > 0) {
    const isSelected = await button.evaluate(btn => {
      const row = btn.closest('ms-model-carousel-row');
      return row ? row.classList.contains('selected') : false;
    });

    if (!isSelected) {
      // Scroll the button into view if it is out of the scroll window viewport
      await button.scrollIntoViewIfNeeded().catch(() => {});
      // Use standard click event dispatch sequence (mousedown, mouseup, click)
      // to ensure it isn't ignored/intercepted by the Angular router.
      await dispatchMouseEventClick(button);
      // Wait for panel auto-close
      await panel.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
    } else {
      // Close panel manually if already selected
      if (await panel.isVisible()) {
        await dispatchMouseEventClick(trigger);
        await panel.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
      }
    }
  } else {
    // Close panel manually
    if (await panel.isVisible()) {
      await dispatchMouseEventClick(trigger);
      await panel.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
    }
    console.warn(`[FAI] Target AI Studio model "${targetModel}" could not be selected.`);
  }
}

function extractLatestUserMessage(messages, fallbackPrompt) {
  if (!messages || !Array.isArray(messages)) {
    return fallbackPrompt;
  }
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      const content = messages[i].content;
      if (typeof content === 'string') {
        return content;
      }
      if (Array.isArray(content)) {
        return content
          .filter(part => part && part.type === 'text')
          .map(part => String(part.text || ''))
          .join('\n')
          .trim();
      }
    }
  }
  return fallbackPrompt;
}

function createAIStudioWebPlugin(options = {}) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new PluginValidationError("AI Studio web plugin options must be an object.");
  }

  const {
    name = "aistudio-web",
    url = "https://aistudio.google.com/prompts/new_chat",
    modelName = "gemini-3.5-flash",
    selectors = {},
    responseTimeoutMs = 180000,
    responseStabilityMs = 1800,
    pollIntervalMs = 300,
    networkDiagnostics = {},
    manualVerification = false,
    isDefaultModel = false,
  } = options;

  const mergedSelectors = {
    ...AISTUDIO_WEB_SELECTORS,
    ...(selectors || {}),
  };

  const diagnosticsConfig = createNetworkDiagnosticsConfig(networkDiagnostics);
  const manualVerificationConfig = createManualVerificationConfig(manualVerification);
  const collectorsByPage = new WeakMap();
  const turnSnapshotsByPage = new WeakMap();
  const isNewChatByPage = new WeakMap();

  function ensureCollector(page) {
    let collector = collectorsByPage.get(page);
    if (!collector) {
      collector = createCollector(page, diagnosticsConfig);
      collectorsByPage.set(page, collector);
    }
    return collector;
  }

  return createSelectorPlugin({
    name,
    url,
    navigateOnStart: false,
    navigateEveryTurn: false,
    gotoOptions: {
      waitUntil: "domcontentloaded",
    },
    inputMode: "keyboard",
    fallbackToKeyboard: true,
    responseTimeoutMs,
    responseStabilityMs,
    pollIntervalMs,
    selectors: mergedSelectors,
    async setup(context) {
      const page = context.page;
      const collector = ensureCollector(page);
      const startupSnapshot = collector.createSnapshot();

      try {
        const currentUrl = page.url();
        const isOnAIStudio = currentUrl.includes("aistudio.google.com/prompts/");

        if (!isOnAIStudio) {
          console.log(`[FAI] Navigating page to AI Studio URL: ${url}`);
          await page.goto(url, { waitUntil: "domcontentloaded" });
        }
        isNewChatByPage.set(page, true);

        await waitForComposer(page, mergedSelectors, {
          timeoutMs: context.session ? context.session.defaultTimeoutMs : 120000,
          pollIntervalMs,
          pluginName: name,
          manualVerification: manualVerificationConfig,
          bodySnippetLimit: diagnosticsConfig.bodySnippetLimit,
        });

        await selectModel(page, modelName, mergedSelectors, isDefaultModel);
      } catch (error) {
        await collector.flush();
        const diagnostics = collector.summarizeSince(startupSnapshot);
        if (diagnostics.suspiciousResponseCount || diagnostics.requestFailureCount) {
          throw buildNetworkDiagnosticsError(name, diagnostics, `Failed to initialize plugin "${name}".`, error);
        }
        throw error;
      }
    },
    async beforeSend(context) {
      const page = context.page;
      const collector = ensureCollector(page);
      const turnSnapshot = collector.createSnapshot();
      turnSnapshotsByPage.set(page, turnSnapshot);

      const messages = context.sendOptions.messages || [];
      const hasAssistantMessage = messages.some(m => m.role === 'assistant');
      const explicitNewChat = context.sendOptions.new_chat || context.sendOptions.new_tab;
      const forceNewChat = explicitNewChat || !hasAssistantMessage;

      try {
        const currentUrl = page.url();
        const isOnAIStudio = currentUrl.includes("aistudio.google.com/prompts/");

        if (!isOnAIStudio || forceNewChat) {
          console.log(`[FAI] Initializing new AI Studio chat/tab...`);
          await page.goto(url, { waitUntil: "domcontentloaded" });
          isNewChatByPage.set(page, true);

          await waitForComposer(page, mergedSelectors, {
            timeoutMs: context.session ? context.session.defaultTimeoutMs : 120000,
            pollIntervalMs,
            pluginName: name,
            manualVerification: manualVerificationConfig,
            bodySnippetLimit: diagnosticsConfig.bodySnippetLimit,
          });

          await selectModel(page, modelName, mergedSelectors, isDefaultModel);
        } else {
          isNewChatByPage.set(page, false);
          await waitForComposer(page, mergedSelectors, {
            timeoutMs: context.session ? context.session.defaultTimeoutMs : 120000,
            pollIntervalMs,
            pluginName: name,
            manualVerification: manualVerificationConfig,
            bodySnippetLimit: diagnosticsConfig.bodySnippetLimit,
          });
        }
      } catch (error) {
        await collector.flush();
        const diagnostics = collector.summarizeSince(turnSnapshot);
        if (diagnostics.suspiciousResponseCount || diagnostics.requestFailureCount) {
          throw buildNetworkDiagnosticsError(name, diagnostics, `Failed before sending prompt in plugin "${name}".`, error);
        }
        throw error;
      }
    },
    submit: {
      strategy: "custom",
      async run(context) {
        const page = context.page;
        const inputLocator = context.inputLocator;
        const messages = context.sendOptions.messages || [];
        const isNewChat = isNewChatByPage.get(page) !== false;

        let textToSend = context.prompt;
        if (!isNewChat && messages.length > 0) {
          textToSend = extractLatestUserMessage(messages, context.prompt);
        }

        // Fill prompt
        await inputLocator.waitFor({ state: 'visible', timeout: 5000 });
        await page.evaluate(({ selector, text }) => {
          const textarea = document.querySelector(selector);
          if (textarea) {
            textarea.value = text;
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }, { selector: mergedSelectors.promptInput, text: textToSend });

        await humanDelay(350, 750);

        // Submit via MouseEvent sequence
        const submitSelector = mergedSelectors.submitButton;
        const submitButton = page.locator(submitSelector).first();
        await submitButton.waitFor({ state: 'visible', timeout: 5000 });
        await dispatchMouseEventClick(submitButton);

        isNewChatByPage.set(page, false);
      },
    },
    async extractResponse({ page }) {
      const locator = page.locator(mergedSelectors.responseItems);
      const count = await locator.count();
      let text = "";
      if (count > 0) {
        text = normalizeText(await readLocatorText(locator.nth(count - 1)));
      }

      const diagnosticsCollector = collectorsByPage.get(page) || null;
      const diagnosticsSnapshot = turnSnapshotsByPage.get(page) || null;
      let networkDiagnostics = null;

      if (diagnosticsCollector) {
        await diagnosticsCollector.flush();
        networkDiagnostics = diagnosticsCollector.summarizeSince(diagnosticsSnapshot);
      }

      return {
        text,
        segments: [text],
        lastSegment: text,
        networkDiagnostics,
      };
    },
  });
}

module.exports = {
  AISTUDIO_WEB_SELECTORS,
  createAIStudioWebPlugin,
};
