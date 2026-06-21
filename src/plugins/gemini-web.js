const {
  PluginValidationError,
  ResponseTimeoutError,
  NetworkDiagnosticsError,
} = require("../errors");
const { createSelectorPlugin } = require("./generic-chat");

const GEMINI_WEB_SELECTORS = Object.freeze({
  promptInput: 'div.ql-editor.textarea, rich-textarea div.ql-editor, div[contenteditable="true"][aria-label="Enter a prompt for Gemini"]',
  submitButton: 'button[aria-label="Send message"]',
  responseItems: 'div.markdown-main-panel, div.markdown, div[id^="model-response-message-content"]',
  busyIndicator: 'div.markdown-main-panel[aria-busy="true"], div.markdown[aria-busy="true"], div[id^="model-response-message-content"][aria-busy="true"]',
});

const DEFAULT_NETWORK_DIAGNOSTIC_PATTERNS = Object.freeze([
  /assistant\.lamda\.BardFrontendService/i,
  /gemini\.google\.com/i,
]);

const DEFAULT_DIAGNOSTIC_HEADERS = Object.freeze([
  "content-type",
  "server",
]);

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

  if (
    !Number.isFinite(maxLength) ||
    maxLength <= 0 ||
    text.length <= maxLength
  ) {
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
    normalized.includes(
      "please unblock challenges.cloudflare.com to proceed",
    ) ||
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
      "Gemini web plugin `manualVerification` must be a boolean or an object when provided.",
    );
  }

  const {
    enabled = true,
    timeoutMs = 300000,
    pollIntervalMs = 500,
  } = manualVerification;

  if (typeof enabled !== "boolean") {
    throw new PluginValidationError(
      "Gemini web plugin `manualVerification.enabled` must be a boolean when provided.",
    );
  }

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new PluginValidationError(
      "Gemini web plugin `manualVerification.timeoutMs` must be a positive number.",
    );
  }

  if (!Number.isFinite(pollIntervalMs) || pollIntervalMs <= 0) {
    throw new PluginValidationError(
      "Gemini web plugin `manualVerification.pollIntervalMs` must be a positive number.",
    );
  }

  return {
    enabled,
    timeoutMs,
    pollIntervalMs,
  };
}

function createNetworkDiagnosticsConfig(networkDiagnostics = {}) {
  if (!isPlainObject(networkDiagnostics)) {
    throw new PluginValidationError(
      "Gemini web plugin `networkDiagnostics` must be an object when provided.",
    );
  }

  const {
    enabled = true,
    urlPatterns = DEFAULT_NETWORK_DIAGNOSTIC_PATTERNS,
    includeHeaders = DEFAULT_DIAGNOSTIC_HEADERS,
    maxEntries = 5,
    bodySnippetLimit = 2000,
  } = networkDiagnostics;

  if (!Array.isArray(urlPatterns) || !urlPatterns.length) {
    throw new PluginValidationError(
      "Gemini web plugin `networkDiagnostics.urlPatterns` must be a non-empty array.",
    );
  }

  if (
    !urlPatterns.every(
      (pattern) =>
          pattern instanceof RegExp ||
          typeof pattern === "string" ||
          typeof pattern === "function",
    )
  ) {
    throw new PluginValidationError(
      "Gemini web plugin `networkDiagnostics.urlPatterns` entries must be strings, regular expressions, or functions.",
    );
  }

  if (!Array.isArray(includeHeaders)) {
    throw new PluginValidationError(
      "Gemini web plugin `networkDiagnostics.includeHeaders` must be an array when provided.",
    );
  }

  if (!Number.isFinite(maxEntries) || maxEntries <= 0) {
    throw new PluginValidationError(
      "Gemini web plugin `networkDiagnostics.maxEntries` must be a positive number.",
    );
  }

  if (!Number.isFinite(bodySnippetLimit) || bodySnippetLimit <= 0) {
    throw new PluginValidationError(
      "Gemini web plugin `networkDiagnostics.bodySnippetLimit` must be a positive number.",
    );
  }

  return {
    enabled,
    urlPatterns: [...urlPatterns],
    includeHeaders: includeHeaders.map((header) =>
      String(header).toLowerCase(),
    ),
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
      return Boolean(element) && element.isContentEditable === true;
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
        const bodyText = document.body
          ? (document.body.innerText || "").slice(0, snippetLimit)
          : "";
        const html = document.documentElement
          ? (document.documentElement.innerHTML || "").slice(0, snippetLimit)
          : "";

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

function buildChallengePageError(
  pluginName,
  page,
  bodySnippet,
  manualVerificationEnabled,
) {
  const message = manualVerificationEnabled
    ? `Managed challenge is still blocking ${page.url()} while using plugin "${pluginName}". Complete the verification in the opened browser, then retry the prompt.`
    : `Detected a managed challenge page at ${page.url()} while using plugin "${pluginName}". Run headful with a persistent user data directory, complete the verification manually, then reuse that profile.`;

  return new NetworkDiagnosticsError(message, {
    diagnostics: buildChallengePageDiagnostics(page, bodySnippet),
  });
}

async function handleCookieBanner(page) {
  const acceptButtonSelector = 'button[data-test-id="accept-button"]';
  try {
    const button = page.locator(acceptButtonSelector);
    if (await button.isVisible({ timeout: 1000 }).catch(() => false)) {
      await button.click();
      // Wait for it to become detached or hidden
      await page.waitForSelector(acceptButtonSelector, { state: 'detached', timeout: 5000 }).catch(() => {});
    }
  } catch (error) {
    // Ignore error if not found or if click fails
  }
}

async function waitForComposer(page, selectors, options = {}) {
  const {
    timeoutMs = 120000,
    pollIntervalMs = 300,
    pluginName = "gemini-web",
    manualVerification = {
      enabled: false,
      timeoutMs: 300000,
      pollIntervalMs: 500,
    },
    bodySnippetLimit = 2000,
  } = options;
  const input = page.locator(selectors.promptInput).first();
  const effectiveTimeoutMs = manualVerification.enabled
    ? Math.max(timeoutMs, manualVerification.timeoutMs)
    : timeoutMs;
  const deadline = Date.now() + effectiveTimeoutMs;
  let lastChallengeSnippet = "";

  while (Date.now() < deadline) {
    // Handle cookie banner if it appears
    await handleCookieBanner(page);

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
    throw buildChallengePageError(
      pluginName,
      page,
      lastChallengeSnippet,
      manualVerification.enabled,
    );
  }

  throw new ResponseTimeoutError(
    `Timed out after ${effectiveTimeoutMs}ms waiting for the chat composer in plugin "${pluginName}".`,
  );
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
    lastText: texts.length ? texts[texts.length - 1] : "",
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

      const text = (input.innerText || input.textContent || "").trim();

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
          styles.display !== "none" &&
          styles.visibility !== "hidden"
        );
      });
    },
    {
      inputSelector: selectors.promptInput,
      buttonSelector: selectors.submitButton,
    },
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
    config.selectors.submitButton,
  );

  if (submitButton) {
    await submitButton.click();
    return;
  }

  await inputLocator.press("Enter");
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

      if (!shouldInspectUrl(url, diagnosticsConfig)) {
        return;
      }

      const request = response.request();
      const headers = normalizeHeaders(response.headers());
      const contentType = headers["content-type"] || "";
      let bodySnippet = "";

      if (
        response.status() >= 400 ||
        contentType.toLowerCase().includes("text/html")
      ) {
        try {
          bodySnippet = truncateText(
            await response.text(),
            diagnosticsConfig.bodySnippetLimit,
          );
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
        isCloudflareChallenge: looksLikeCloudflareChallenge(
          bodySnippet,
          headers,
        ),
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

    if (!shouldInspectUrl(url, diagnosticsConfig)) {
      return;
    }

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
      if (!pendingTasks.size) {
        return;
      }

      await Promise.allSettled(Array.from(pendingTasks));
    },
    summarizeSince(snapshot = null) {
      const normalizedSnapshot = snapshot || {
        monitoredResponseIndex: 0,
        suspiciousResponseIndex: 0,
        requestFailureIndex: 0,
      };
      const monitoredResponses = state.monitoredResponses.slice(
        normalizedSnapshot.monitoredResponseIndex,
      );
      const suspiciousResponses = state.suspiciousResponses.slice(
        normalizedSnapshot.suspiciousResponseIndex,
      );
      const requestFailures = state.requestFailures.slice(
        normalizedSnapshot.requestFailureIndex,
      );
      const blockingResponse =
        suspiciousResponses.find(
          (response) =>
            response.status === 403 || response.isCloudflareChallenge,
        ) || null;

      return {
        monitoredResponseCount: monitoredResponses.length,
        suspiciousResponseCount: suspiciousResponses.length,
        requestFailureCount: requestFailures.length,
        blockingResponse,
        monitoredResponses: monitoredResponses.slice(
          -diagnosticsConfig.maxEntries,
        ),
        suspiciousResponses: suspiciousResponses.slice(
          -diagnosticsConfig.maxEntries,
        ),
        requestFailures: requestFailures.slice(-diagnosticsConfig.maxEntries),
      };
    },
    dispose,
  };
}

function buildNetworkDiagnosticsError(
  pluginName,
  diagnostics,
  fallbackMessage,
  cause,
) {
  const blocking = diagnostics.blockingResponse;
  let message =
    fallbackMessage ||
    `Monitored network requests failed while using plugin "${pluginName}".`;

  if (blocking) {
    if (blocking.isCloudflareChallenge) {
      message =
        `Received a challenge response from ${blocking.url} ` +
        `while using plugin "${pluginName}".`;
    } else {
      message =
        `Received HTTP ${blocking.status} from ${blocking.url} while using ` +
        `plugin "${pluginName}".`;
    }
  } else if (diagnostics.requestFailureCount) {
    const failure =
      diagnostics.requestFailures[diagnostics.requestFailures.length - 1];
    message =
      `A monitored network request failed while using plugin "${pluginName}" ` +
      `(${failure.method} ${failure.url}).`;
  } else if (diagnostics.suspiciousResponseCount) {
    const response =
      diagnostics.suspiciousResponses[
        diagnostics.suspiciousResponses.length - 1
      ];
    message =
      `A monitored network response looked suspicious while using plugin ` +
      `"${pluginName}" (${response.status} ${response.url}).`;
  }

  return new NetworkDiagnosticsError(message, {
    cause,
    diagnostics,
  });
}

async function maybeNavigate(page, url, gotoOptions, context) {
  const resolvedUrl = await resolveValue(url, context);

  if (!resolvedUrl) {
    return;
  }

  await page.goto(resolvedUrl, gotoOptions);
}

async function waitForAssistantResponse({
  page,
  previousResponse,
  config,
  diagnosticsCollector,
  diagnosticsSnapshot,
  lastSeenTextByPage,
}) {
  const deadline = Date.now() + config.responseTimeoutMs;
  let sawStreaming = false;
  let sawChange = false;
  let lastCandidate = "";
  let stableSince = 0;

  while (Date.now() < deadline) {
    if (diagnosticsCollector) {
      const diagnostics =
        diagnosticsCollector.summarizeSince(diagnosticsSnapshot);

      if (diagnostics.blockingResponse) {
        await diagnosticsCollector.flush();
        throw buildNetworkDiagnosticsError(
          config.name,
          diagnosticsCollector.summarizeSince(diagnosticsSnapshot),
          null,
          null,
        );
      }
    }

    const snapshot = await getAssistantSnapshot(
      page,
      config.selectors.responseItems,
    );
    const busy = await hasVisibleElement(page, config.selectors.busyIndicator);
    const newTexts = snapshot.texts
      .slice(previousResponse.count)
      .filter(Boolean);
    const candidate = newTexts.length
      ? newTexts.join("\n\n")
      : snapshot.lastText && snapshot.lastText !== previousResponse.lastText
        ? snapshot.lastText
        : "";

    if (busy) {
      sawStreaming = true;
    }

    if (snapshot.count > previousResponse.count || candidate) {
      sawChange = true;
    }

    if (candidate) {
      const cleaned = candidate.trim();
      if (cleaned.length > 0 && lastSeenTextByPage) {
        lastSeenTextByPage.set(page, candidate);
      }

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

  if (diagnosticsCollector) {
    await diagnosticsCollector.flush();
    const diagnostics =
      diagnosticsCollector.summarizeSince(diagnosticsSnapshot);

    if (
      diagnostics.blockingResponse ||
      diagnostics.suspiciousResponseCount ||
      diagnostics.requestFailureCount
    ) {
      throw buildNetworkDiagnosticsError(
        config.name,
        diagnostics,
        `Timed out waiting for an assistant response in plugin "${config.name}" after suspicious network activity.`,
        null,
      );
    }
  }

  throw new ResponseTimeoutError(
    `Timed out after ${config.responseTimeoutMs}ms waiting for a completed assistant response from plugin "${config.name}".`,
  );
}

function createGeminiWebPlugin(options = {}) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new PluginValidationError(
      "Gemini web plugin options must be an object.",
    );
  }

  const {
    name = "gemini-web",
    url = "https://gemini.google.com/",
    selectors = {},
    waitForReady = null,
    navigateEveryTurn = false,
    gotoOptions = {},
    responseTimeoutMs = 180000,
    responseStabilityMs = 1800,
    pollIntervalMs = 300,
    networkDiagnostics = {},
    manualVerification = false,
  } = options;

  if (waitForReady && typeof waitForReady !== "function") {
    throw new PluginValidationError(
      "Gemini web plugin `waitForReady` must be a function when provided.",
    );
  }

  const mergedSelectors = {
    ...GEMINI_WEB_SELECTORS,
    ...(selectors || {}),
  };
  const diagnosticsConfig = createNetworkDiagnosticsConfig(networkDiagnostics);
  const manualVerificationConfig =
    createManualVerificationConfig(manualVerification);
  const collectorsByPage = new WeakMap();
  const turnSnapshotsByPage = new WeakMap();
  const lastSeenTextByPage = new WeakMap();

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
      ...(gotoOptions || {}),
    },
    inputMode: "keyboard",
    fallbackToKeyboard: true,
    responseTimeoutMs,
    responseStabilityMs,
    pollIntervalMs,
    selectors: mergedSelectors,
    async setup(context) {
      const collector = ensureCollector(context.page);
      const startupSnapshot = collector.createSnapshot();

      try {
        await maybeNavigate(context.page, url, gotoOptions, context);
        await waitForComposer(context.page, mergedSelectors, {
          timeoutMs: context.session
            ? context.session.defaultTimeoutMs
            : 120000,
          pollIntervalMs,
          pluginName: name,
          manualVerification: manualVerificationConfig,
          bodySnippetLimit: diagnosticsConfig.bodySnippetLimit,
        });

        if (typeof waitForReady === "function") {
          await waitForReady({
            ...context,
            selectors: mergedSelectors,
          });
        }
      } catch (error) {
        await collector.flush();
        const diagnostics = collector.summarizeSince(startupSnapshot);

        if (
          diagnostics.suspiciousResponseCount ||
          diagnostics.requestFailureCount
        ) {
          throw buildNetworkDiagnosticsError(
            name,
            diagnostics,
            `Failed to initialize plugin "${name}".`,
            error,
          );
        }

        throw error;
      }
    },
    async beforeSend(context) {
      lastSeenTextByPage.delete(context.page);

      const collector = ensureCollector(context.page);
      const existingDiagnostics = collector.summarizeSince();
      const turnSnapshot = existingDiagnostics.blockingResponse
        ? null
        : collector.createSnapshot();

      turnSnapshotsByPage.set(context.page, turnSnapshot);

      try {
        if (navigateEveryTurn) {
          await maybeNavigate(context.page, url, gotoOptions, context);
        }

        await waitForComposer(context.page, mergedSelectors, {
          timeoutMs: context.session
            ? context.session.defaultTimeoutMs
            : 120000,
          pollIntervalMs,
          pluginName: name,
          manualVerification: manualVerificationConfig,
          bodySnippetLimit: diagnosticsConfig.bodySnippetLimit,
        });
      } catch (error) {
        await collector.flush();
        const diagnostics = collector.summarizeSince(turnSnapshot);

        if (
          diagnostics.suspiciousResponseCount ||
          diagnostics.requestFailureCount
        ) {
          throw buildNetworkDiagnosticsError(
            name,
            diagnostics,
            `Failed before sending a prompt with plugin "${name}".`,
            error,
          );
        }

        throw error;
      }
    },
    submit: {
      strategy: "custom",
      async run(context) {
        await submitPrompt(context);
      },
    },
    async waitForResponse(context) {
      const diagnosticsCollector = collectorsByPage.get(context.page) || null;
      const diagnosticsSnapshot = turnSnapshotsByPage.get(context.page) || null;

      await waitForAssistantResponse({
        ...context,
        diagnosticsCollector,
        diagnosticsSnapshot,
        lastSeenTextByPage,
      });
    },
    async extractResponse({ page, responseDetails, defaultText }) {
      const segments = responseDetails.newTexts
        .map(normalizeText)
        .filter(Boolean);
      let text = segments.length
        ? segments.join("\n\n")
        : normalizeText(defaultText);

      const lastSeenText = lastSeenTextByPage.get(page);
      if (lastSeenText && (!text || text.trim().length === 0)) {
        text = normalizeText(lastSeenText);
      }
      lastSeenTextByPage.delete(page);

      const diagnosticsCollector = collectorsByPage.get(page) || null;
      const diagnosticsSnapshot = turnSnapshotsByPage.get(page) || null;
      let networkDiagnostics = null;

      if (diagnosticsCollector) {
        await diagnosticsCollector.flush();
        networkDiagnostics =
          diagnosticsCollector.summarizeSince(diagnosticsSnapshot);
      }

      return {
        text,
        segments,
        lastSegment: segments.length ? segments[segments.length - 1] : text,
        networkDiagnostics,
      };
    },
  });
}

module.exports = {
  GEMINI_WEB_SELECTORS,
  createGeminiWebPlugin,
};
