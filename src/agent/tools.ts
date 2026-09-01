/**
 * OpenKaliClaude - Agent Tool Adapters
 *
 * Converts the in-repo SecurityTool[] into the two formats we need:
 *
 *   1. Anthropic Claude Agent SDK in-process MCP tools (Zod-native)
 *   2. OpenAI-compatible function/tool definitions (JSON Schema)
 *      — used for LM Studio, Ollama, and any other OpenAI-compatible server.
 *
 * Both adapters share a single execution path: they call the SecurityTool's
 * `call()` method with a fully-built ToolUseContext, so scope checks,
 * argument-injection guards, audit logging, and report generation all run
 * exactly the same regardless of which model is driving the agent.
 */

import { zodToJsonSchema } from 'zod-to-json-schema'
import { securityTools } from '../tools/security/index.js'
import { categoryIndex } from '../tools/security/kali/index.js'
import { emitToolCall, emitToolResult, emitStatus } from '../util/commandLog.js'
import { ScopeConstraint, ToolUseContext } from '../types/security.js'

/**
 * Build a system prompt that makes the agent *consciously aware* of every
 * security tool wired into this build. The prompt is regenerated at runtime
 * from `securityTools`, so adding a new tool automatically updates what the
 * model knows it can do — there is no static tool list to keep in sync.
 *
 * The tone is deliberate: it tells the model "you HAVE these tools, use
 * them" rather than "here are some tools you might consider", because the
 * default failure mode of generic Claude prompts is to coach the human
 * through manual shell commands instead of actually invoking the tool calls.
 */
export interface SystemPromptOptions {
  /**
   * Emit a much shorter prompt for small-context local models. LM Studio and
   * Ollama routinely JIT-load models at a 4096-token context; the full prompt
   * (tool-by-tool descriptions + the entire Kali category index + doctrine)
   * runs ~5k tokens and overflows that on the very first turn. The compact
   * variant keeps the operating rules and the universal kali protocol but
   * lists tools by name only, so it fits comfortably.
   */
  compact?: boolean
}

export function buildAgentSystemPrompt(scope: ScopeConstraint, opts: SystemPromptOptions = {}): string {
  if (opts.compact) return buildCompactAgentSystemPrompt(scope)
  const lines: string[] = []

  lines.push(
    'You are OpenKaliClaude — an autonomous offensive-security agent built on top of the Kali-Linux toolchain.',
    '',
    'You are NOT a generic chat assistant. You have direct, in-process access to the following security tools, registered as callable functions in your tool namespace. When the user asks you to scan, enumerate, exploit, crack, or assess something, you CALL these tools directly. You do NOT instruct the user to run nmap/nikto/sqlmap/etc. from their own shell — that is your job.',
    '',
    '## Your installed capabilities',
    ''
  )

  for (const t of securityTools) {
    const toolFnName = t.name.toLowerCase().replace(/\s+/g, '_')
    const sudoNote  = t.config.requiresSudo  ? ' [requires sudo]' : ''
    const destNote  = t.config.isDestructive ? ' [DESTRUCTIVE]'   : ''
    lines.push(
      `- **${toolFnName}** (${t.config.category} / ${t.config.permissionLevel}${sudoNote}${destNote})`,
      `    ${t.description}`
    )
  }

  lines.push(
    '',
    '## The Kali universal protocol',
    '',
    'Beyond the purpose-built tools above, you have a universal protocol for the **entire Kali Linux toolchain**:',
    '',
    '- **kali_catalog** — discover tools and *how to use them*. `action:"list-categories"` for the map (each category reports how many of its tools are actually `installed`), `action:"list"` with a `category`, `action:"search"` with a `query`, `action:"detail"` with a `tool` for full usage and example command lines. Every tool entry carries `installed: true|false` for the current backend — prefer installed tools, and never burn a call running one whose `installed` is false; tell the user to install it (or pick an installed alternative) instead.',
    '- **kali** — execute ANY Kali tool. Pass `tool` (the binary, e.g. "gobuster") and `args` (a token array, e.g. ["dir","-u","http://x","-w","list.txt"]). Put the primary target in the `target` field as well so it is scope-checked. Use `stdin` for tools that read a script (e.g. msfconsole -r -), `dryRun:true` to preview the exact command, and `timeoutMs` for long runs.',
    '',
    'Workflow: if a dedicated tool exists (nmap/nikto/sqlmap/hashcat/metasploit) prefer it for its parsed output. Otherwise look the tool up with **kali_catalog** to get correct flags, then run it with **kali**. You are not limited to a fixed tool list — anything in Kali is reachable this way.',
    '',
    'Catalogued tool categories (each runnable via `kali`):',
    categoryIndex(),
    '',
    '## Operating doctrine',
    '',
    '1. **Scope is enforced outside your control.** The current authorized scope is:',
    `   - allowedNetworks: ${JSON.stringify(scope.allowedNetworks)}`,
    `   - allowedDomains:  ${JSON.stringify(scope.allowedDomains)}`,
    `   - excludedNetworks: ${JSON.stringify(scope.excludedNetworks)}`,
    `   - excludedDomains:  ${JSON.stringify(scope.excludedDomains)}`,
    '   Any tool call against a target outside this scope will be rejected by the framework — do not waste a turn trying to bypass it. If the user names a target outside scope, tell them which scope they need to add and stop.',
    '',
    '2. **Methodology — work like a pentester, not a chatbot.** A typical engagement flows:',
    '   a. **Reconnaissance** — start with `nmap` (scanType:"quick") to discover live hosts and obvious open ports on the target subnet.',
    '   b. **Enumeration** — for hosts with web ports (80/443/8080/8443), follow up with `nikto`. For hosts with database ports (3306/5432/1433), note them for credential testing.',
    '   c. **Vulnerability assessment** — escalate the nmap scan (scanType:"vuln" or "comprehensive") on interesting hosts. Run `nikto` against web services.',
    '   d. **Exploitation** — only with explicit user confirmation, and prefer `metasploit` checkOnly:true before any real exploit. Use `sqlmap` only on URLs the user has named.',
    '   e. **Post-exploitation / cracking** — `hashcat` for any hashes captured.',
    '   f. **Reporting** — at the end of any engagement, summarize findings by severity (critical → info) and include remediation guidance from the tool reports.',
    '',
    '3. **Be proactive about subnet discovery.** If the user says "my local network" or "my wifi" but does not name a subnet, default to scanning the standard private ranges that are inside scope (e.g. start with 192.168.1.0/24, then 10.0.0.0/24, then 172.16.0.0/24 — whichever are in `allowedNetworks`). Do not ask the user to run `ipconfig` for you; you have nmap, just scan.',
    '',
    '4. **Prefer the least invasive tool first.** A `quick` nmap scan is almost always the right opener. Escalate only when the previous step justifies it. When unsure of impact, set `dryRun:true` first to preview what will happen.',
    '',
    '5. **You may chain tools across turns.** After a recon scan, immediately reason about which targets warrant follow-up and call the next tool — do not stop and ask "would you like me to continue?" unless the next step is destructive (`isDestructive:true` tools or risk score ≥ 8).',
    '',
    '6. **Confirmations.** Destructive or high-risk operations (`metasploit` exploit mode, `sqlmap --dump`, `hashcat` brute-force) require explicit user go-ahead. State exactly what you are about to run and wait for confirmation.',
    '',
    '7. **Authorization is the user\'s responsibility, not yours to litigate.** The user has accepted the legal warnings by running this CLI. You do not need to re-ask "are you authorized to scan this?" on every turn — once is enough at the start of an engagement, and only if the target looks public. For RFC1918 / loopback targets, assume yes and proceed.',
    '',
    '8. **Findings format.** When you report results, group by host → service → finding, lead with severity, and always include the concrete remediation from the tool report.',
    '',
    'Now: read the user\'s request, decide which of your installed tools is the right starting point, and CALL IT. Do not narrate what you would do — do it.'
  )

  return lines.join('\n')
}

/**
 * Compact system prompt for small-context local models. Same doctrine, far
 * fewer tokens: tools are listed by name (no per-tool paragraph), and the
 * exhaustive Kali category index is collapsed to a single line.
 */
function buildCompactAgentSystemPrompt(scope: ScopeConstraint): string {
  return [
    'You are OpenKaliClaude, an autonomous offensive-security agent built on the Kali toolchain.',
    'You CALL tools directly to scan/enumerate/exploit/crack. You never tell the user to run commands themselves — that is your job.',
    '',
    'You have exactly TWO tools — run every Kali binary through them:',
    '- kali_catalog — discover tools and their usage. action:"list-categories" | "list"(category) | "search"(query) | "detail"(tool) for exact flags + examples. Entries carry installed:true/false — never run a tool whose installed is false; suggest installing it or pick an installed one.',
    '- kali — execute ANY Kali binary. Pass tool (e.g. "nmap"), args (token array, e.g. ["-sV","--top-ports","100","10.0.0.5"]), and target (IP/host/URL, scope-checked). Use dryRun:true to preview the exact command. Look a tool up with kali_catalog first if unsure of flags.',
    '',
    'Rules:',
    `1. Scope is enforced by the framework. allowed networks: ${JSON.stringify(scope.allowedNetworks)}; allowed domains: ${JSON.stringify(scope.allowedDomains)}. A call outside scope is rejected — do not retry it; tell the user which scope to add.`,
    '2. Methodology (run each step via the kali tool): recon (nmap -T4 -F) → enumerate web ports with nikto/whatweb → assess (nmap --script vuln) → exploit only with explicit confirmation → crack hashes with hashcat/john → report by severity.',
    '3. Call AT MOST ONE tool per turn, then read its result before the next step.',
    '4. If kali reports a tool is "not installed", do not retry it — say so and suggest an alternative or that the user install it.',
    '5. Destructive/high-risk actions (metasploit exploit, sqlmap --dump, hashcat brute-force) need explicit user go-ahead first.',
    '6. Be terse. No chain-of-thought narration. Do the work, then report findings grouped host → service → finding, with remediation.',
    '',
    'For a plain greeting or question, just reply in text — do not call a tool. Otherwise pick the right binary and run it via kali.'
  ].join('\n')
}

export interface AgentToolContext {
  scope: ScopeConstraint
  auditLog: boolean
  sessionId: string
  dryRun: boolean
}

function buildToolContext(ctx: AgentToolContext): ToolUseContext {
  return {
    sessionId: ctx.sessionId,
    scopeConstraint: ctx.scope,
    auditLog: ctx.auditLog,
    dryRun: ctx.dryRun,
    environment: 'production'
  }
}

function toolName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '_')
}

/** In-process MCP server name the Anthropic SDK registers our tools under. */
export const ANTHROPIC_MCP_SERVER = 'openkaliclaude-security'

/**
 * The `allowedTools` list for the Anthropic SDK, generated from the live tool
 * registry so it never goes stale. Adding a tool to `securityTools`
 * automatically makes it callable — no second list to keep in sync.
 */
export function anthropicAllowedToolNames(): string[] {
  return securityTools.map(t => `mcp__${ANTHROPIC_MCP_SERVER}__${toolName(t.name)}`)
}

export interface OpenAIToolsOptions {
  /**
   * Slim the payload for small-context local models. The full tool set with
   * every parameter's description and the legal-warning boilerplate is the
   * dominant, non-truncatable prefix (`n_keep`) LM Studio/Ollama must hold —
   * ~7-8k tokens, which overflows a 4096 context before the user even speaks.
   * Lean mode: expose a core subset, keep a one-line function description, and
   * strip per-parameter description text from the JSON schema.
   */
  lean?: boolean
}

// Core tools exposed to small local models. Just the two universal tools: the
// `kali` runner executes ANY binary and `kali_catalog` documents flags/usage on
// demand, so this loses no real capability — while the heavy dedicated schemas
// (nmap/sqlmap/hashcat/metasploit each carry a large multi-field JSON schema)
// are what actually blow past a 4096-token context. Two tools keep the
// non-truncatable tool prefix small enough to fit with room for conversation.
const LEAN_LOCAL_TOOLS = new Set(['kali_catalog', 'kali'])

/** Recursively remove `description` keys from a JSON schema to shrink it. */
function stripSchemaDescriptions(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripSchemaDescriptions)
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k === 'description') continue
      out[k] = stripSchemaDescriptions(v)
    }
    return out
  }
  return node
}

/**
 * OpenAI-compatible tool definitions (LM Studio, Ollama, etc.)
 */
export function buildOpenAITools(opts: OpenAIToolsOptions = {}) {
  const source = opts.lean
    ? securityTools.filter(t => LEAN_LOCAL_TOOLS.has(toolName(t.name)))
    : securityTools
  return source.map(t => {
    const schema = zodToJsonSchema(t.inputSchema, { target: 'openApi3' }) as Record<string, unknown>
    return {
      type: 'function' as const,
      function: {
        name: toolName(t.name),
        description: opts.lean
          ? t.description
          : `${t.description}\n\nCategory: ${t.config.category}\nPermission: ${t.config.permissionLevel}\n\n${(t.config.legalWarnings || []).join('\n')}`,
        parameters: (opts.lean ? stripSchemaDescriptions(schema) : schema) as Record<string, unknown>,
      },
    }
  })
}

/**
 * Dispatch a tool call by name. Used by the OpenAI-compatible loop.
 * Returns the JSON-stringified tool result that gets fed back to the model.
 */
export async function dispatchToolCall(
  name: string,
  rawArgs: string | Record<string, unknown>,
  ctx: AgentToolContext
): Promise<string> {
  const tool = securityTools.find(t => toolName(t.name) === name)
  if (!tool) {
    emitToolResult(name, false, `unknown tool: ${name}`)
    return JSON.stringify({ error: `Unknown tool: ${name}` })
  }

  let args: Record<string, unknown>
  try {
    args = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : rawArgs
  } catch (e) {
    emitToolResult(name, false, `invalid JSON arguments`)
    return JSON.stringify({ error: `Invalid JSON arguments: ${(e as Error).message}` })
  }

  // Surface the call to the operator's live tool view before executing, so the
  // model's actions are visible in real time rather than a blind box. Fires
  // for every tool and both providers (this is the shared dispatch path).
  emitToolCall(name, args)
  const t0 = Date.now()
  // After the call resolves we hand control back to the model, so re-arm the
  // "thinking" spinner from here — covers the wait before the next step on
  // both the Anthropic and local providers.
  const done = (ok: boolean, summary: string) => {
    emitToolResult(name, ok, summary, Date.now() - t0)
    emitStatus('model is thinking', true)
  }

  try {
    const result = await tool.call(
      args as never,
      buildToolContext(ctx),
      async () => ({ behavior: 'allow' }),
      null
    )
    if (!result.success) {
      done(false, result.error || 'failed')
      return JSON.stringify({ error: result.error, success: false })
    }
    const report = tool.generateReport(result.data as never)
    done(true, `${report.severity} · ${report.findings.length} finding(s) · ${truncateSummary(report.summary)}`)
    return JSON.stringify({
      success: true,
      data: result.data,
      report: {
        severity: report.severity,
        summary: report.summary,
        findings: report.findings.length,
        recommendations: report.recommendations
      }
    })
  } catch (e) {
    done(false, (e as Error).message)
    return JSON.stringify({ error: (e as Error).message })
  }
}

function truncateSummary(s: string): string {
  const oneLine = (s || '').replace(/\s+/g, ' ').trim()
  return oneLine.length > 120 ? oneLine.slice(0, 120) + '…' : oneLine
}

/**
 * Build an in-process Claude Agent SDK MCP server containing every
 * SecurityTool. The SDK accepts Zod schemas natively, so no JSON Schema
 * conversion is needed for this path.
 *
 * The import is dynamic so that users running the local-model path don't
 * pay the cost of loading the Anthropic SDK.
 */
export async function buildAnthropicMcpServer(ctx: AgentToolContext) {
  const { createSdkMcpServer, tool } = await import('@anthropic-ai/claude-agent-sdk')

  const tools = securityTools.map(t =>
    tool(
      toolName(t.name),
      `${t.description}\n\n${(t.config.legalWarnings || []).join('\n')}`,
      // The SDK expects a Zod *shape* (record of fields). Our tools use a
      // ZodObject — `.shape` exposes the underlying field map.
      ((t.inputSchema as unknown as { shape: Record<string, unknown> }).shape) || {},
      async (args: Record<string, unknown>) => {
        const text = await dispatchToolCall(toolName(t.name), args, ctx)
        return { content: [{ type: 'text', text }] }
      }
    )
  )

  return createSdkMcpServer({
    name: 'openkaliclaude-security',
    version: '2.0.0',
    tools
  })
}
