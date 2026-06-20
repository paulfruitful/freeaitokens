const { ConfigurationError, PlaywrightDependencyError } = require("./errors");
const { normalizeConnectOverCDPOptions } = require("./chrome-attach");

async function resolvePlaywright(providedPlaywright) {
  if (providedPlaywright) {
    return providedPlaywright;
  }

  try {
    return require("playwright");
  } catch (error) {
    throw new PlaywrightDependencyError(
      "Playwright is not installed. Run `npm install` and `npx playwright install` before starting a browser session.",
      { cause: error },
    );
  }
}

function resolveBrowserFactory(resolvedPlaywright, browserType) {
  const browserFactory = resolvedPlaywright[browserType];

  if (!browserFactory || typeof browserFactory.launch !== "function") {
    throw new PlaywrightDependencyError(
      `Unsupported browser type "${browserType}". Use "chromium", "firefox", or "webkit".`,
    );
  }

  return browserFactory;
}

function hasOwnEntries(value) {
  return (
    Boolean(value) && typeof value === "object" && Object.keys(value).length > 0
  );
}

async function safeClose(handle) {
  if (!handle) {
    return;
  }

  try {
    await handle.close();
  } catch (error) {
    // Ignore cleanup errors while tearing down a failed launch.
  }
}

async function launchBrowser(options = {}) {
  const { playwright, browserType = "chromium", launchOptions = {} } = options;

  const resolvedPlaywright = await resolvePlaywright(playwright);
  const browserFactory = resolveBrowserFactory(resolvedPlaywright, browserType);

  return browserFactory.launch(launchOptions);
}

function resolveClosePageOnClose(connectOverCDP) {
  // Close the tab when the session ends by default.
  // Pass closePageOnSessionClose: false explicitly to keep it open.
  if (connectOverCDP.closePageOnSessionClose === null) {
    return true;
  }

  return connectOverCDP.closePageOnSessionClose;
}

async function resolveAttachedPage(context, connectOverCDP) {
  const existingPages = context.pages();

  if (connectOverCDP.pageMode === "new") {
    return {
      page: await context.newPage(),
      closePageOnClose: resolveClosePageOnClose(connectOverCDP),
    };
  }

  if (existingPages.length) {
    return {
      page:
        connectOverCDP.pageMode === "last"
          ? existingPages[existingPages.length - 1]
          : existingPages[0],
      closePageOnClose: resolveClosePageOnClose(connectOverCDP),
    };
  }

  if (!connectOverCDP.createPageIfMissing) {
    throw new ConfigurationError(
      "The attached Chrome profile does not have any open pages, and `connectOverCDP.createPageIfMissing` is false.",
    );
  }

  return {
    page: await context.newPage(),
    closePageOnClose: resolveClosePageOnClose(connectOverCDP),
  };
}

async function connectSessionOverCDP(options = {}) {
  const { playwright, connectOverCDP } = options;

  const resolvedPlaywright = await resolvePlaywright(playwright);
  const browserFactory = resolveBrowserFactory(resolvedPlaywright, "chromium");

  if (typeof browserFactory.connectOverCDP !== "function") {
    throw new PlaywrightDependencyError(
      "The installed Playwright version does not support `chromium.connectOverCDP()`.",
    );
  }

  const browser = await browserFactory.connectOverCDP(
    connectOverCDP.endpointURL,
    connectOverCDP.connectOptions,
  );

  try {
    const context = browser.contexts()[0] || null;

    if (!context) {
      throw new PlaywrightDependencyError(
        `No browser context was exposed by the attached Chrome instance at ${connectOverCDP.endpointURL}.`,
      );
    }

    const { page, closePageOnClose } = await resolveAttachedPage(
      context,
      connectOverCDP,
    );

    return {
      browser,
      context,
      page,
      closePageOnClose,
      closeContextOnClose: false,
      closeBrowserOnClose: true,
      isConnectedOverCDP: true,
    };
  } catch (error) {
    await safeClose(browser);
    throw error;
  }
}

async function launchSession(options = {}) {
  const {
    playwright,
    browserType = "chromium",
    launchOptions = {},
    contextOptions = {},
    userDataDir = null,
    connectOverCDP = null,
  } = options;
  const normalizedConnectOverCDP =
    normalizeConnectOverCDPOptions(connectOverCDP);

  if (normalizedConnectOverCDP) {
    if (browserType !== "chromium") {
      throw new ConfigurationError(
        '`connectOverCDP` is only supported with `browserType: "chromium"`.',
      );
    }

    if (userDataDir) {
      throw new ConfigurationError(
        "`userDataDir` cannot be used together with `connectOverCDP`. Use one attach mode or one launch mode, not both.",
      );
    }

    if (hasOwnEntries(contextOptions)) {
      throw new ConfigurationError(
        "`contextOptions` are not supported when `connectOverCDP` is used because the target browser context already exists.",
      );
    }

    return connectSessionOverCDP({
      playwright,
      connectOverCDP: normalizedConnectOverCDP,
    });
  }

  const resolvedPlaywright = await resolvePlaywright(playwright);
  const browserFactory = resolveBrowserFactory(resolvedPlaywright, browserType);

  if (userDataDir) {
    if (typeof browserFactory.launchPersistentContext !== "function") {
      throw new PlaywrightDependencyError(
        `Browser type "${browserType}" does not support persistent contexts.`,
      );
    }

    const context = await browserFactory.launchPersistentContext(userDataDir, {
      ...(launchOptions || {}),
      ...(contextOptions || {}),
    });
    const page = context.pages()[0] || (await context.newPage());

    return {
      browser: typeof context.browser === "function" ? context.browser() : null,
      context,
      page,
      closePageOnClose: true,
      closeContextOnClose: true,
      closeBrowserOnClose: true,
      isPersistentContext: true,
    };
  }

  const browser = await browserFactory.launch(launchOptions);
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();

  return {
    browser,
    context,
    page,
    closePageOnClose: true,
    closeContextOnClose: true,
    closeBrowserOnClose: true,
    isPersistentContext: false,
  };
}

module.exports = {
  resolvePlaywright,
  launchBrowser,
  launchSession,
};
