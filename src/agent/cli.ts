/**
 * OpenKaliClaude - Agent CLI Entry
 *
 * Usage:
 *   okal-agent [--provider anthropic|lmstudio|ollama] [--model NAME]
 *              [--base-url URL] [--api-key KEY] [--scope JSON]
 *              [--max-turns N] [--no-audit] -- <prompt>
 *
 * Examples:
 *   # Anthropic, subscription via prior `claude login`
 *   okal-agent --provider anthropic --model claude-sonnet-4-6 \
 *     -- "scan 192.168.1.0/24 and report risky open ports"
 *
 *   # LM Studio (default localhost:1234)
 *   okal-agent --provider lmstudio --model qwen2.5-coder \
 *     -- "do a quick nmap scan of 10.0.0.5"
 *
 *   # Ollama (default localhost:11434)
 *   okal-agent --provider ollama --model llama3.1:8b \
*     -- "check https://192.168.56.101 for web vulns with nikto"
 */

import { ScopeConstraint } from '../types/security.js'
import { runAnthropicAgent } from './anthropic.js'
import { runLocalAgent, LocalProvider } from './local.js'
import { AgentToolContext } from './tools.js'

const DEFAULT_SCOPE: ScopeConstraint = {
  allowedNetworks: ['127.0.0.1/8', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'],
  allowedDomains: ['localhost'],
  excludedNetworks: [],
  excludedDomains: [],
  maxScope: 'cidr/24',
  requireAuthorization: true
}

interface ParsedArgs {
  provider: 'anthropic' | LocalProvider
  model?: string
  baseUrl?: string
  apiKey?: string
  scope: ScopeConstraint
  maxTurns?: number
  audit: boolean
  prompt: string
}

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {
    provider: 'anthropic',
    scope: DEFAULT_SCOPE,
    audit: true,
    prompt: ''
  }

  const dashDash = argv.indexOf('--')
  const flagArgs = dashDash >= 0 ? argv.slice(0, dashDash) : argv
  const promptArgs = dashDash >= 0 ? argv.slice(dashDash + 1) : []

  for (let i = 0; i < flagArgs.length; i++) {
    const a = flagArgs[i]
    const next = () => flagArgs[++i]
    switch (a) {
      case '--provider':   args.provider = next() as ParsedArgs['provider']; break
      case '--model':      args.model = next(); break
      case '--base-url':   args.baseUrl = next(); break
      case '--api-key':    args.apiKey = next(); break
      case '--max-turns':  args.maxTurns = parseInt(next(), 10); break
      case '--no-audit':   args.audit = false; break
      case '--scope': {
        try { args.scope = JSON.parse(next()) }
        catch { console.error('Invalid --scope JSON, using default'); }
        break
      }
      case '--help':
      case '-h':
        printHelp()
        process.exit(0)
    }
  }

  // Env-var overrides
  if (process.env.OKAL_SCOPE) {
    try { args.scope = JSON.parse(process.env.OKAL_SCOPE) } catch { /* ignore */ }
  }
  if (process.env.OKAL_AUDIT === 'false') args.audit = false

  args.prompt = promptArgs.join(' ').trim()
  if (!args.prompt) {
    console.error('Error: missing prompt. Pass it after `--`.')
    printHelp()
    process.exit(1)
  }

  return args
}

function printHelp(): void {
  console.error(`
OpenKaliClaude Agent

  okal-agent [options] -- <prompt>

Options:
  --provider <name>     anthropic | lmstudio | ollama | custom  (default: anthropic)
  --model <name>        Model name (e.g. claude-sonnet-4-6, llama3.1:8b, qwen2.5-coder)
  --base-url <url>      Override OpenAI-compatible base URL (local providers only)
  --api-key <key>       Optional API key (local providers ignore this)
  --scope <json>        ScopeConstraint JSON; defaults to localhost + RFC1918
  --max-turns <n>       Max agent turns (default: 20)
  --no-audit            Disable audit logging
  -h, --help            Show this help

Authentication:
  anthropic   Uses your existing Claude subscription if you've run \`claude login\`
              previously, otherwise falls back to ANTHROPIC_API_KEY.
  lmstudio    No auth needed. Default URL: http://localhost:1234/v1
  ollama      No auth needed. Default URL: http://localhost:11434/v1
`)
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))

  const ctx: AgentToolContext = {
    scope: args.scope,
    auditLog: args.audit,
    sessionId: `agent-${Date.now()}`,
    dryRun: false
  }

  console.error(`[agent] provider=${args.provider} model=${args.model || '(default)'} scope=${JSON.stringify(args.scope.allowedNetworks)}`)

  if (args.provider === 'anthropic') {
    await runAnthropicAgent({
      prompt: args.prompt,
      model: args.model,
      maxTurns: args.maxTurns,
      ctx
    })
  } else {
    if (!args.model) {
      console.error('Error: --model is required for local providers')
      process.exit(1)
    }
    await runLocalAgent({
      prompt: args.prompt,
      provider: args.provider,
      model: args.model,
      baseUrl: args.baseUrl,
      apiKey: args.apiKey,
      maxTurns: args.maxTurns,
      ctx
    })
  }
}

main().catch(err => {
  console.error(`[agent] fatal: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
