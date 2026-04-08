/**
 * OpenKaliClaude — Interactive REPL
 *
 * Custom branded interactive front-end. Replaces the generic Claude Code
 * CLI chrome with the OpenKaliClaude banner + welcome box + chat loop,
 * and dispatches every user prompt into the in-process agent runner
 * (Anthropic by default, or a local OpenAI-compatible model).
 *
 * Renders with chalk + figlet + box-drawing chars on plain readline —
 * no Ink/JSX, so it works through tsx without touching tsconfig.
 */

import readline from 'node:readline'
import chalk from 'chalk'
import figlet from 'figlet'
import { ScopeConstraint } from '../types/security.js'
import { runAnthropicAgent } from '../agent/anthropic.js'
import { runLocalAgent, LocalProvider } from '../agent/local.js'
import { AgentToolContext } from '../agent/tools.js'

// ─── config from env / argv ──────────────────────────────────────────────────

interface ReplConfig {
  provider: 'anthropic' | LocalProvider
  model: string
  baseUrl?: string
  apiKey?: string
  scope: ScopeConstraint
  audit: boolean
  username: string
}

const DEFAULT_SCOPE: ScopeConstraint = {
  allowedNetworks: ['127.0.0.1/8', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'],
  allowedDomains: ['localhost'],
  excludedNetworks: [],
  excludedDomains: [],
  maxScope: 'cidr/24',
  requireAuthorization: true
}

function parseConfig(): ReplConfig {
  const argv = process.argv.slice(2)
  const cfg: ReplConfig = {
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    scope: DEFAULT_SCOPE,
    audit: true,
    username: process.env.USER || process.env.USERNAME || 'operator'
  }

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => argv[++i]
    switch (a) {
      case '--provider':  cfg.provider = next() as ReplConfig['provider']; break
      case '--model':     cfg.model = next(); break
      case '--base-url':  cfg.baseUrl = next(); break
      case '--api-key':   cfg.apiKey = next(); break
      case '--no-audit':  cfg.audit = false; break
      case '--scope':
        try { cfg.scope = JSON.parse(next()) } catch { /* ignore */ }
        break
      case '--help':
      case '-h':
        printHelp(); process.exit(0)
    }
  }

  if (process.env.OKAL_SCOPE) {
    try { cfg.scope = JSON.parse(process.env.OKAL_SCOPE) } catch { /* ignore */ }
  }
  if (process.env.OKAL_AUDIT === 'false') cfg.audit = false

  return cfg
}

function printHelp(): void {
  console.error(`
OpenKaliClaude — Interactive Security Agent

  openkaliclaude [options]

Options:
  --provider <name>   anthropic | lmstudio | ollama | custom  (default: anthropic)
  --model <name>      Model to use (default: claude-sonnet-4-6)
  --base-url <url>    Override base URL for local providers
  --scope <json>      ScopeConstraint JSON (defaults to localhost + RFC1918)
  --no-audit          Disable audit logging
  -h, --help          Show this help

Slash commands (inside the REPL):
  /help               Show available slash commands
  /tools              List installed security tools
  /scope              Show current scope policy
  /clear              Clear the screen
  /exit               Quit
`)
}

// ─── rendering ───────────────────────────────────────────────────────────────

const C = {
  brand:   chalk.hex('#2EA8FF').bold,
  brandDim:chalk.hex('#1B6FB8'),
  border:  chalk.hex('#1B6FB8'),
  label:   chalk.hex('#2EA8FF'),
  text:    chalk.whiteBright,
  dim:     chalk.gray,
  ok:      chalk.greenBright,
  warn:    chalk.yellow,
  err:     chalk.redBright,
  prompt:  chalk.hex('#2EA8FF').bold,
  user:    chalk.cyanBright
}

function renderBanner(): string {
  // Figlet may throw on Windows for some fonts; fall back to a static ASCII.
  try {
    const text = figlet.textSync('OPENKALICLAUDE', {
      font: 'ANSI Shadow',
      horizontalLayout: 'fitted',
      width: process.stdout.columns || 120
    })
    return text.split('\n').map(l => C.brand(l)).join('\n')
  } catch {
    return C.brand('  O P E N K A L I C L A U D E')
  }
}

/**
 * Draw a two-column rounded box. Each column is an array of plain (un-ANSI'd)
 * lines; we measure widths from the plain text and apply colors after.
 */
function renderTwoColumnBox(left: string[], right: string[]): string {
  const termW = Math.min(process.stdout.columns || 120, 140)
  const inner = termW - 4                  // 2 chars border each side
  const leftW = Math.floor(inner * 0.40)
  const rightW = inner - leftW - 3          // 3 chars for the divider " │ "

  const pad = (s: string, w: number) => {
    const visible = s.replace(/\u001b\[[0-9;]*m/g, '')
    if (visible.length >= w) return s.slice(0, w)
    return s + ' '.repeat(w - visible.length)
  }

  const rows: string[] = []
  const maxRows = Math.max(left.length, right.length)
  for (let i = 0; i < maxRows; i++) {
    const l = pad(left[i]  || '', leftW)
    const r = pad(right[i] || '', rightW)
    rows.push(`${C.border('│')} ${l} ${C.border('│')} ${r} ${C.border('│')}`)
  }

  const top    = C.border('╭' + '─'.repeat(leftW + 2) + '┬' + '─'.repeat(rightW + 2) + '╮')
  const bottom = C.border('╰' + '─'.repeat(leftW + 2) + '┴' + '─'.repeat(rightW + 2) + '╯')
  return [top, ...rows, bottom].join('\n')
}

function center(s: string, w: number): string {
  const visible = s.replace(/\u001b\[[0-9;]*m/g, '')
  if (visible.length >= w) return s
  const left = Math.floor((w - visible.length) / 2)
  return ' '.repeat(left) + s
}

function renderWelcome(cfg: ReplConfig): string {
  const inner = Math.min(process.stdout.columns || 120, 140) - 4
  const leftW = Math.floor(inner * 0.40)

  // The pixel-axolotl in your screenshot — drawn with block characters so it
  // renders in any terminal that supports basic Unicode + 24-bit color.
  const axolotl = [
    '   ▄▄▄▄▄▄   ',
    '  █  ██  █  ',
    ' █ ██  ██ █ ',
    '█  ▀▀  ▀▀  █',
    '█  ╲▁▁▁▁╱  █',
    ' █▄▄▄▄▄▄▄▄█ ',
    '   █    █   '
  ]

  const left: string[] = []
  left.push('')
  left.push(center(C.text.bold('Welcome back!'), leftW))
  left.push('')
  for (const row of axolotl) left.push(center(C.brand(row), leftW))
  left.push('')
  left.push(center(C.dim(`${cfg.model}  ·  ${cfg.provider === 'anthropic' ? 'Claude subscription' : cfg.provider}`), leftW))
  left.push(center(C.dim(process.cwd()), leftW))
  left.push('')

  const right: string[] = []
  right.push('')
  right.push(C.label('Tips for getting started'))
  right.push(C.text('Ask in natural language — the agent picks the right tool.'))
  right.push(C.text('Try: ') + C.user('"scan my local wifi network and find vulns"'))
  right.push(C.text('Slash commands: ') + C.dim('/help  /tools  /scope  /clear  /exit'))
  right.push('')
  right.push(C.label('Recent activity'))
  right.push(C.dim('No recent activity'))
  right.push('')
  right.push(C.label('Scope'))
  right.push(C.dim('allow: ') + C.text(cfg.scope.allowedNetworks.join(', ') || '(none)'))
  if (cfg.scope.excludedNetworks.length) {
    right.push(C.dim('deny:  ') + C.text(cfg.scope.excludedNetworks.join(', ')))
  }
  right.push('')

  return renderTwoColumnBox(left, right)
}

function renderHeader(cfg: ReplConfig): void {
  console.log()
  console.log(renderBanner())
  console.log()
  console.log(renderWelcome(cfg))
  console.log()
  console.log(C.dim('  Type your prompt and press Enter. ') + C.dim('Ctrl+C twice to quit.'))
  console.log()
}

// ─── slash commands ──────────────────────────────────────────────────────────

function handleSlash(line: string, cfg: ReplConfig): boolean {
  const [cmd, ...rest] = line.trim().slice(1).split(/\s+/)
  switch (cmd) {
    case 'help':
      console.log(C.label('\nSlash commands:'))
      console.log('  /help    Show this help')
      console.log('  /tools   List installed security tools')
      console.log('  /scope   Show current scope policy')
      console.log('  /clear   Clear the screen')
      console.log('  /exit    Quit\n')
      return true
    case 'tools': {
      // Lazy-import so this command works even before the SDKs warm up.
      import('../tools/security/index.js').then(({ securityTools }) => {
        console.log(C.label('\nInstalled security tools:'))
        for (const t of securityTools) {
          const flags = [
            t.config.requiresSudo  ? C.warn('sudo')        : '',
            t.config.isDestructive ? C.err('destructive') : ''
          ].filter(Boolean).join(' ')
          console.log(`  ${C.user(t.name.toLowerCase())}  ${C.dim('· ' + t.config.category)}  ${flags}`)
          console.log(`    ${C.dim(t.description)}`)
        }
        console.log()
      })
      return true
    }
    case 'scope':
      console.log(C.label('\nCurrent scope:'))
      console.log(JSON.stringify(cfg.scope, null, 2))
      console.log()
      return true
    case 'clear':
      console.clear()
      renderHeader(cfg)
      return true
    case 'exit':
    case 'quit':
      console.log(C.dim('\nBye.\n'))
      process.exit(0)
    // eslint-disable-next-line no-fallthrough
    default:
      console.log(C.warn(`Unknown command: /${cmd}. Try /help.`))
      return true
  }
}

// ─── main loop ───────────────────────────────────────────────────────────────

async function dispatchPrompt(prompt: string, cfg: ReplConfig): Promise<void> {
  const ctx: AgentToolContext = {
    scope: cfg.scope,
    auditLog: cfg.audit,
    sessionId: `repl-${Date.now()}`,
    dryRun: false
  }

  try {
    if (cfg.provider === 'anthropic') {
      await runAnthropicAgent({ prompt, model: cfg.model, ctx })
    } else {
      await runLocalAgent({
        prompt,
        provider: cfg.provider,
        model: cfg.model,
        baseUrl: cfg.baseUrl,
        apiKey: cfg.apiKey,
        ctx
      })
    }
  } catch (e) {
    console.error(C.err(`\n[error] ${(e as Error).message}\n`))
  }
}

async function main(): Promise<void> {
  const cfg = parseConfig()
  console.clear()
  renderHeader(cfg)

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: C.prompt('❯ '),
    terminal: true
  })

  let pendingExit = false
  rl.on('SIGINT', () => {
    if (pendingExit) {
      console.log(C.dim('\nBye.\n'))
      process.exit(0)
    }
    pendingExit = true
    process.stdout.write(C.dim('\n(press Ctrl+C again to exit)\n'))
    rl.prompt()
    setTimeout(() => { pendingExit = false }, 1500)
  })

  rl.prompt()
  for await (const rawLine of rl) {
    const line = rawLine.trim()
    if (!line) { rl.prompt(); continue }

    if (line.startsWith('/')) {
      handleSlash(line, cfg)
      rl.prompt()
      continue
    }

    console.log()                     // spacer before agent output
    rl.pause()
    await dispatchPrompt(line, cfg)
    rl.resume()
    console.log()
    rl.prompt()
  }
}

main().catch(err => {
  console.error(C.err(`\n[fatal] ${err instanceof Error ? err.message : String(err)}\n`))
  process.exit(1)
})
