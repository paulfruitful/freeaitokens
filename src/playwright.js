const { PlaywrightDependencyError } = require('./errors');

async function resolvePlaywright(providedPlaywright) {
  if (providedPlaywright) {
    return providedPlaywright;
  }

  try {
    return require('playwright');
  } catch (error) {
    throw new PlaywrightDependencyError(
      'Playwright is not installed. Run `npm install` and `npx playwright install` before starting a browser session.',
      { cause: error }
    );
  }
}

async function launchBrowser(options = {}) {
  const {
    playwright,
    browserType = 'chromium',
    launchOptions = {},
  } = options;

  const resolvedPlaywright = await resolvePlaywright(playwright);
  const browserFactory = resolvedPlaywright[browserType];

  if (!browserFactory || typeof browserFactory.launch !== 'function') {
    throw new PlaywrightDependencyError(
      `Unsupported browser type "${browserType}". Use "chromium", "firefox", or "webkit".`
    );
  }

  return browserFactory.launch(launchOptions);
}

module.exports = {
  resolvePlaywright,
  launchBrowser,
};
