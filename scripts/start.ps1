[CmdletBinding()]
param(
  [string]$ChromePath,

  [ValidateRange(1, 65535)]
  [int]$Port = 9222,

  [string]$ProfileDir = "",

  [int]$ChromeReadyTimeoutSeconds = 20,

  [int]$ServerPort = 5000
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scriptDirectory = if ($PSScriptRoot) {
  $PSScriptRoot
} else {
  Split-Path -Parent $MyInvocation.MyCommand.Path
}

$projectRoot = Split-Path -Parent $scriptDirectory

if (-not $ProfileDir) {
  $ProfileDir = Join-Path $projectRoot ".playwright\chrome-cdp-profile"
}

$cdpEndpoint = "http://127.0.0.1:$Port"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

function Write-Info {
  param([string]$Message)
  Write-Host $Message -ForegroundColor Cyan
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

function Find-Chrome {
  param([string]$ProvidedPath)

  if ($ProvidedPath) {
    return (Resolve-Path -LiteralPath $ProvidedPath -ErrorAction Stop).Path
  }

  $baseDirectories = @(
    $env:ProgramFiles,
    ${env:ProgramFiles(x86)},
    $env:LocalAppData
  ) | Where-Object { $_ }

  foreach ($baseDir in $baseDirectories) {
    $candidate = Join-Path $baseDir "Google\Chrome\Application\chrome.exe"
    if (Test-Path -LiteralPath $candidate) {
      return $candidate
    }
  }

  return $null
}

function Test-CDPReady {
  param([string]$Endpoint)

  try {
    $response = Invoke-WebRequest -Uri "$Endpoint/json/version" `
      -TimeoutSec 2 -UseBasicParsing -ErrorAction Stop
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

function Wait-CDPReady {
  param([string]$Endpoint, [int]$TimeoutSeconds)

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)

  while ((Get-Date) -lt $deadline) {
    if (Test-CDPReady -Endpoint $Endpoint) {
      return $true
    }
    Start-Sleep -Milliseconds 500
  }

  return $false
}

# ---------------------------------------------------------------------------
# Step 1: Check if Chrome is already running with CDP
# ---------------------------------------------------------------------------

Write-Host ""
Write-Info "freeaitokens  |  starting..."
Write-Host ""
Write-Info "==> Checking for Chrome CDP at $cdpEndpoint"

if (Test-CDPReady -Endpoint $cdpEndpoint) {
  Write-OK "Chrome already running with CDP at $cdpEndpoint"
} else {
  # ---------------------------------------------------------------------------
  # Step 2: Launch Chrome
  # ---------------------------------------------------------------------------

  Write-Info "==> Launching Chrome with CDP"

  $resolvedChromePath = Find-Chrome -ProvidedPath $ChromePath

  if (-not $resolvedChromePath) {
    Write-Fail "Chrome not found. Install Chrome or pass -ChromePath."
    Write-Host "  Download from https://www.google.com/chrome/" -ForegroundColor Yellow
    exit 1
  }

  if (-not (Test-Path -LiteralPath $ProfileDir)) {
    New-Item -ItemType Directory -Force -Path $ProfileDir | Out-Null
  }

  $chromeArguments = @(
    "--remote-debugging-port=$Port",
    "--user-data-dir=`"$ProfileDir`"",
    "--no-first-run",
    "--no-default-browser-check",
    "https://chatgpt.com/"
  )

  Start-Process -FilePath $resolvedChromePath -ArgumentList $chromeArguments | Out-Null

  Write-Host "    Chrome launched."
  Write-Host "    Profile : $ProfileDir"
  Write-Host "    CDP     : $cdpEndpoint"
  Write-Host ""
  Write-Warn "If this is your first time, log in to ChatGPT and complete"
  Write-Warn "any Cloudflare check in the opened Chrome window, then"
  Write-Warn "re-run this script (or wait here - the server will start"
  Write-Warn "automatically once the CDP endpoint becomes available)."
  Write-Host ""

  # ---------------------------------------------------------------------------
  # Step 3: Wait for CDP to become available
  # ---------------------------------------------------------------------------

  Write-Info "==> Waiting for Chrome to be ready (up to ${ChromeReadyTimeoutSeconds}s)..."

  if (-not (Wait-CDPReady -Endpoint $cdpEndpoint -TimeoutSeconds $ChromeReadyTimeoutSeconds)) {
    Write-Fail "Chrome did not expose the CDP endpoint within ${ChromeReadyTimeoutSeconds} seconds."
    Write-Host "  Check that no firewall is blocking port $Port." -ForegroundColor Yellow
    Write-Host "  You can also run scripts\launch-chrome-cdp.cmd manually." -ForegroundColor Yellow
    exit 1
  }

  Write-OK "Chrome is ready"
}

# ---------------------------------------------------------------------------
# Step 4: Start the Node.js server
# ---------------------------------------------------------------------------

Write-Host ""
Write-Info "==> Starting freeaitokens server on port $ServerPort"
Write-Host ""

$env:CDP_ENDPOINT_URL = $cdpEndpoint
$env:CDP_TAB_MODE = if ($env:CDP_TAB_MODE) { $env:CDP_TAB_MODE } else { "new" }
$env:PORT = $ServerPort

Push-Location $projectRoot
try {
  & node server.js
} finally {
  Pop-Location
}
