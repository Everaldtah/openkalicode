#!/usr/bin/env bash
#
# OpenKaliClaude installer (Linux / macOS / WSL)
#
# Non-interactive. Clones the repo, installs Node deps, and prints the
# next-step commands for logging in with a Claude subscription.
#
#   curl -fsSL https://raw.githubusercontent.com/Everaldtah/openkalicode/main/install.sh | bash
#
# Or from a checkout:
#   ./install.sh
#
# Environment variables:
#   OKAL_INSTALL_DIR   target directory (default: $HOME/openkalicode)
#   OKAL_BRANCH        git branch to check out (default: main)
#   OKAL_SKIP_TOOLS    set to 1 to skip the security-tool installer
#

set -euo pipefail

REPO_URL="https://github.com/Everaldtah/openkalicode.git"
BRANCH="${OKAL_BRANCH:-main}"
INSTALL_DIR="${OKAL_INSTALL_DIR:-$HOME/openkalicode}"

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
info()    { echo -e "${BLUE}[+]${NC} $*"; }
ok()      { echo -e "${GREEN}[✓]${NC} $*"; }
warn()    { echo -e "${YELLOW}[!]${NC} $*"; }
fail()    { echo -e "${RED}[✗]${NC} $*" >&2; exit 1; }

require() {
  command -v "$1" >/dev/null 2>&1 || fail "$1 not found in PATH"
}

main() {
  echo
  info "OpenKaliClaude installer"
  echo

  # ── prerequisites ─────────────────────────────────────────────────────────
  require git
  require node
  require npm

  node_major=$(node -v | sed 's/v//' | cut -d. -f1)
  if [ "$node_major" -lt 18 ]; then
    fail "Node.js 18+ is required (found $(node -v))"
  fi
  ok "node $(node -v), npm $(npm -v)"

  # ── clone or update ───────────────────────────────────────────────────────
  if [ -d "$INSTALL_DIR/.git" ]; then
    info "Updating existing checkout at $INSTALL_DIR"
    git -C "$INSTALL_DIR" fetch --depth 1 origin "$BRANCH"
    git -C "$INSTALL_DIR" reset --hard "origin/$BRANCH"
  else
    info "Cloning $REPO_URL → $INSTALL_DIR"
    git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
  fi
  cd "$INSTALL_DIR"

  # ── npm install ───────────────────────────────────────────────────────────
  # --legacy-peer-deps is required because the Claude Agent SDK currently
  # peer-depends on zod v4 while the rest of the project still uses zod v3.
  # The actual runtime is unaffected.
  info "Installing Node dependencies (this can take a minute)…"
  npm install --legacy-peer-deps

  ok "Dependencies installed"

  # ── make bin/* executable ─────────────────────────────────────────────────
  chmod +x bin/okal-agent bin/okal-login 2>/dev/null || true

  # ── optional: security tools ──────────────────────────────────────────────
  if [ "${OKAL_SKIP_TOOLS:-0}" != "1" ]; then
    if [ -f "$INSTALL_DIR/scripts/install-tools.sh" ]; then
      info "Running security-tool installer (skip with OKAL_SKIP_TOOLS=1)"
      bash "$INSTALL_DIR/scripts/install-tools.sh" || warn "Some tools failed to install"
    else
      warn "No system-level tool installer present — install nmap/nikto/sqlmap/hashcat/msfconsole manually if you plan to run real scans."
    fi
  fi

  # ── default scope ─────────────────────────────────────────────────────────
  mkdir -p "$HOME/.okal/scopes" "$HOME/.okal/logs"
  if [ ! -f "$HOME/.okal/scopes/default.json" ]; then
    cat > "$HOME/.okal/scopes/default.json" <<'JSON'
{
  "allowedNetworks": ["127.0.0.1/8", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"],
  "allowedDomains": ["localhost"],
  "excludedNetworks": [],
  "excludedDomains": [],
  "maxScope": "cidr/24",
  "requireAuthorization": true
}
JSON
    ok "Default scope written to ~/.okal/scopes/default.json"
  fi

  echo
  ok "OpenKaliClaude installed at $INSTALL_DIR"
  echo
  echo -e "${GREEN}Next steps:${NC}"
  echo
  echo "  cd $INSTALL_DIR"
  echo
  echo "  # 1. Log in with your Claude subscription (or set ANTHROPIC_API_KEY)"
  echo "  npm run login"
  echo
  echo "  # 2. Run the agent"
  echo "  npm run agent -- --provider anthropic --model claude-sonnet-4-6 -- \\"
  echo "    \"scan 192.168.1.0/24 and report risky open ports\""
  echo
  echo "  # Local-model alternative (LM Studio):"
  echo "  npm run agent -- --provider lmstudio --model qwen2.5-coder -- \\"
  echo "    \"do a quick nmap scan of 10.0.0.5\""
  echo
  warn "Reminder: only scan systems you have written authorization to test."
  echo
}

main "$@"
