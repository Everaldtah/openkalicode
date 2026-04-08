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
Write-Host "  cd $InstallDir"
Write-Host ''
Write-Host '  # 1. Log in with your Claude subscription (or set $env:ANTHROPIC_API_KEY)'
Write-Host '  npm run login'
Write-Host ''
Write-Host '  # 2. Run the agent'
Write-Host '  npm run agent -- --provider anthropic --model claude-sonnet-4-6 -- `'
Write-Host '    "scan 192.168.1.0/24 and report risky open ports"'
Write-Host ''
Write-Host '  # Local-model alternative (LM Studio):'
Write-Host '  npm run agent -- --provider lmstudio --model qwen2.5-coder -- `'
Write-Host '    "do a quick nmap scan of 10.0.0.5"'
Write-Host ''
Warn 'Reminder: only scan systems you have written authorization to test.'
Write-Host ''
