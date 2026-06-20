[CmdletBinding()]
param(
  [switch]$SkipPlaywright
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scriptDirectory = if ($PSScriptRoot) {
  $PSScriptRoot
} else {
  Split-Path -Parent $MyInvocation.MyCommand.Path
}

$projectRoot = Split-Path -Parent $scriptDirectory

# ---------------------------------------------------------------------------
# Output helpers
# ---------------------------------------------------------------------------

function Write-Step {
  param([string]$Message)
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Write-OK {
  param([string]$Message)
  Write-Host "    [OK]  $Message" -ForegroundColor Green
}

function Write-Warn {
  param([string]$Message)
  Write-Host "    [!!]  $Message" -ForegroundColor Yellow
}

function Write-Fail {
  param([string]$Message)
  Write-Host ""
  Write-Host "    [FAIL]  $Message" -ForegroundColor Red
  Write-Host ""
}

# ---------------------------------------------------------------------------
# Banner
# ---------------------------------------------------------------------------

Write-Host ""
Write-Host "  freeaitokens setup" -ForegroundColor White
Write-Host "  OpenAI-compatible local server backed by Playwright" -ForegroundColor DarkGray
Write-Host ""

# ---------------------------------------------------------------------------
# Step 1: Node.js version
# ---------------------------------------------------------------------------

Write-Step "Checking Node.js (>= 18 required)"

try {
  $nodeOutput = & node --version 2>&1
  if ($LASTEXITCODE -ne 0) { throw "node exited $LASTEXITCODE" }

  $nodeMajor = [int]([regex]::Match($nodeOutput, 'v(\d+)').Groups[1].Value)

  if ($nodeMajor -lt 18) {
    Write-Fail "Node.js $nodeOutput detected. Version 18 or higher is required."
    Write-Host "  Download the latest LTS from https://nodejs.org/" -ForegroundColor Yellow
    exit 1
  }

  Write-OK "Node.js $nodeOutput"
} catch {
  Write-Fail "Node.js is not installed or not on PATH."
  Write-Host "  Download the latest LTS from https://nodejs.org/" -ForegroundColor Yellow
  exit 1
}

# ---------------------------------------------------------------------------
# Step 2: npm
# ---------------------------------------------------------------------------

Write-Step "Checking npm"

try {
  $npmOutput = & npm --version 2>&1
  if ($LASTEXITCODE -ne 0) { throw "npm exited $LASTEXITCODE" }
  Write-OK "npm $npmOutput"
} catch {
  Write-Fail "npm is not available. It should come bundled with Node.js."
  exit 1
}

# ---------------------------------------------------------------------------
# Step 3: Chrome (optional - warn only)
# ---------------------------------------------------------------------------

Write-Step "Checking for Google Chrome"

$chromeFound = $false
$baseDirectories = @(
  $env:ProgramFiles,
  ${env:ProgramFiles(x86)},
  $env:LocalAppData
) | Where-Object { $_ }

foreach ($baseDir in $baseDirectories) {
  $candidate = Join-Path $baseDir "Google\Chrome\Application\chrome.exe"
  if (Test-Path -LiteralPath $candidate) {
    Write-OK "Chrome found at $candidate"
    $chromeFound = $true
    break
  }
}

if (-not $chromeFound) {
  Write-Warn "Chrome not found in standard locations."
  Write-Warn "CDP attach mode (recommended) requires Chrome."
  Write-Warn "Download from https://www.google.com/chrome/"
  Write-Warn "Continuing setup - Playwright Chromium can still be used for headless mode."
}

# ---------------------------------------------------------------------------
# Step 4: npm install
# ---------------------------------------------------------------------------

Write-Step "Installing npm dependencies"

Push-Location $projectRoot
try {
  & npm install
  if ($LASTEXITCODE -ne 0) {
    Write-Fail "npm install failed (exit $LASTEXITCODE)."
    exit 1
  }
} finally {
  Pop-Location
}

Write-OK "Dependencies installed"

# ---------------------------------------------------------------------------
# Step 5: Playwright Chromium browser
# ---------------------------------------------------------------------------

if ($SkipPlaywright) {
  Write-Step "Skipping Playwright Chromium install (-SkipPlaywright passed)"
  Write-Warn "Run  npx playwright install chromium  later if you need headless mode."
} else {
  Write-Step "Installing Playwright Chromium browser"

  Push-Location $projectRoot
  try {
    & npx playwright install chromium
    if ($LASTEXITCODE -ne 0) {
      Write-Fail "Playwright browser install failed (exit $LASTEXITCODE)."
      exit 1
    }
  } finally {
    Pop-Location
  }

  Write-OK "Playwright Chromium installed"
}

# ---------------------------------------------------------------------------
# Step 6: Chrome CDP profile directory
# ---------------------------------------------------------------------------

Write-Step "Creating Chrome CDP profile directory"

$profileDir = Join-Path $projectRoot ".playwright\chrome-cdp-profile"
New-Item -ItemType Directory -Force -Path $profileDir | Out-Null
Write-OK "Profile directory ready at $profileDir"

# ---------------------------------------------------------------------------
# Step 7: Project checks
# ---------------------------------------------------------------------------

Write-Step "Running project checks"

Push-Location $projectRoot
try {
  & npm test
  if ($LASTEXITCODE -ne 0) {
    Write-Fail "Project checks failed. Something may be wrong with the installation."
    exit 1
  }
} finally {
  Pop-Location
}

Write-OK "All checks passed"

# ---------------------------------------------------------------------------
# Done - next steps
# ---------------------------------------------------------------------------

$divider = "-" * 60

Write-Host ""
Write-Host $divider -ForegroundColor Green
Write-Host "  Setup complete. Here is how to start:" -ForegroundColor Green
Write-Host $divider -ForegroundColor Green
Write-Host ""
Write-Host "  Step 1  Launch Chrome with CDP enabled (keep it running):" -ForegroundColor White
Write-Host "          scripts\launch-chrome-cdp.cmd" -ForegroundColor Yellow
Write-Host ""
Write-Host "  Step 2  Log in to ChatGPT in the opened Chrome window." -ForegroundColor White
Write-Host "          Complete any Cloudflare check that appears." -ForegroundColor White
Write-Host ""
Write-Host "  Step 3  Start the server in a second terminal:" -ForegroundColor White
Write-Host "          `$env:CDP_ENDPOINT_URL = `"http://127.0.0.1:9222`"" -ForegroundColor Yellow
Write-Host "          npm start" -ForegroundColor Yellow
Write-Host ""
Write-Host "  Step 4  Call it like any OpenAI endpoint:" -ForegroundColor White
Write-Host "          baseURL : http://localhost:5000/v1" -ForegroundColor Yellow
Write-Host "          apiKey  : any-value" -ForegroundColor Yellow
Write-Host "          model   : chatgpt-web" -ForegroundColor Yellow
Write-Host ""
Write-Host "  Optional flags for this script:" -ForegroundColor DarkGray
Write-Host "          -SkipPlaywright   skip the Playwright browser download" -ForegroundColor DarkGray
Write-Host ""
