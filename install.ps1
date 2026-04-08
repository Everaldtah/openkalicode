# OpenKaliClaude installer (Windows / PowerShell)
#
# Non-interactive. Clones the repo, installs Node deps, and prints the
# next-step commands for logging in with a Claude subscription.
#
#   irm https://raw.githubusercontent.com/Everaldtah/openkalicode/main/install.ps1 | iex
#
# Or from a checkout:
#   .\install.ps1
#
# Environment variables:
#   $env:OKAL_INSTALL_DIR   target directory (default: $HOME\openkalicode)
#   $env:OKAL_BRANCH        git branch to check out (default: main)

$ErrorActionPreference = 'Stop'

$RepoUrl    = 'https://github.com/Everaldtah/openkalicode.git'
$Branch     = if ($env:OKAL_BRANCH)       { $env:OKAL_BRANCH }       else { 'main' }
$InstallDir = if ($env:OKAL_INSTALL_DIR)  { $env:OKAL_INSTALL_DIR }  else { Join-Path $HOME 'openkalicode' }

function Info($msg) { Write-Host "[+] $msg" -ForegroundColor Cyan }
function Ok($msg)   { Write-Host "[OK] $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "[!] $msg" -ForegroundColor Yellow }
function Fail($msg) { Write-Host "[X] $msg" -ForegroundColor Red; exit 1 }

function Require-Cmd($name) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    Fail "$name not found in PATH"
  }
}

Write-Host ''
Info 'OpenKaliClaude installer'
Write-Host ''

# ── prerequisites ────────────────────────────────────────────────────────────
Require-Cmd git
Require-Cmd node
Require-Cmd npm

$nodeVersion = (node -v).TrimStart('v')
$nodeMajor   = [int]($nodeVersion.Split('.')[0])
if ($nodeMajor -lt 18) {
  Fail "Node.js 18+ is required (found v$nodeVersion)"
}
Ok "node v$nodeVersion, npm $(npm -v)"

# ── clone or update ──────────────────────────────────────────────────────────
if (Test-Path (Join-Path $InstallDir '.git')) {
  Info "Updating existing checkout at $InstallDir"
  git -C $InstallDir fetch --depth 1 origin $Branch
  git -C $InstallDir reset --hard "origin/$Branch"
} else {
  Info "Cloning $RepoUrl -> $InstallDir"
  git clone --depth 1 --branch $Branch $RepoUrl $InstallDir
}

Set-Location $InstallDir

# ── npm install ──────────────────────────────────────────────────────────────
# --legacy-peer-deps is required because the Claude Agent SDK currently
# peer-depends on zod v4 while the rest of the project still uses zod v3.
Info 'Installing Node dependencies (this can take a minute)...'
npm install --legacy-peer-deps
if ($LASTEXITCODE -ne 0) { Fail 'npm install failed' }
Ok 'Dependencies installed'

# ── register global commands ─────────────────────────────────────────────────
# `npm link` writes shims for every entry in package.json's "bin" field into
# npm's global bin directory ($env:APPDATA\npm by default, which Node.js
# installers add to PATH automatically). After this, the user can type
# `openkaliclaude` from any PowerShell prompt — same UX as `claude`, `kimi`,
# and other harnessed CLIs.
Info 'Linking global commands (openkaliclaude / okal-agent / okal-login)...'
npm link
if ($LASTEXITCODE -ne 0) {
  Warn 'npm link failed. You can still run from this directory via: npm start'
} else {
  Ok 'Global commands installed'
}

# ── default scope ────────────────────────────────────────────────────────────
$okalHome = Join-Path $HOME '.okal'
New-Item -ItemType Directory -Force -Path (Join-Path $okalHome 'scopes') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $okalHome 'logs')   | Out-Null

$scopeFile = Join-Path $okalHome 'scopes\default.json'
if (-not (Test-Path $scopeFile)) {
  @'
{
  "allowedNetworks": ["127.0.0.1/8", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"],
  "allowedDomains": ["localhost"],
  "excludedNetworks": [],
  "excludedDomains": [],
  "maxScope": "cidr/24",
  "requireAuthorization": true
}
'@ | Set-Content -Path $scopeFile -Encoding UTF8
  Ok "Default scope written to $scopeFile"
}

Write-Host ''
Ok "OpenKaliClaude installed at $InstallDir"
Write-Host ''
Write-Host 'Next steps:' -ForegroundColor Green
Write-Host ''
Write-Host '  # 1. Log in with your Claude subscription (or set $env:ANTHROPIC_API_KEY)'
Write-Host '  okal-login'
Write-Host ''
Write-Host '  # 2. Launch the interactive agent (from any directory)'
Write-Host '  openkaliclaude'
Write-Host ''
Write-Host '  # Or one-shot mode:'
Write-Host '  okal-agent --provider anthropic --model claude-sonnet-4-6 -- `'
Write-Host '    "scan 192.168.1.0/24 and report risky open ports"'
Write-Host ''
Write-Host '  # Local-model alternative (LM Studio):'
Write-Host '  openkaliclaude --provider lmstudio --model qwen2.5-coder'
Write-Host ''
Write-Host 'If `openkaliclaude` is not found after install, ensure that' -ForegroundColor Yellow
Write-Host '  ' (npm config get prefix)
Write-Host 'is on your PATH (Node installer normally adds it automatically).' -ForegroundColor Yellow
Write-Host ''
Warn 'Reminder: only scan systems you have written authorization to test.'
Write-Host ''
