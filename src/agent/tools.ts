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
export function buildAgentSystemPrompt(scope: ScopeConstraint): string {
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

/**
 * OpenAI-compatible tool definitions (LM Studio, Ollama, etc.)
 */
export function buildOpenAITools() {
  return securityTools.map(t => ({
    type: 'function' as const,
    function: {
      name: toolName(t.name),
      description: `${t.description}\n\nCategory: ${t.config.category}\nPermission: ${t.config.permissionLevel}\n\n${(t.config.legalWarnings || []).join('\n')}`,
      parameters: zodToJsonSchema(t.inputSchema, { target: 'openApi3' }) as Record<string, unknown>
    }
  }))
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
    return JSON.stringify({ error: `Unknown tool: ${name}` })
  }

  let args: Record<string, unknown>
  try {
    args = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : rawArgs
  } catch (e) {
    return JSON.stringify({ error: `Invalid JSON arguments: ${(e as Error).message}` })
  }

  try {
    const result = await tool.call(
      args as never,
      buildToolContext(ctx),
      async () => ({ behavior: 'allow' }),
      null
    )
    if (!result.success) {
      return JSON.stringify({ error: result.error, success: false })
    }
    const report = tool.generateReport(result.data as never)
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
    return JSON.stringify({ error: (e as Error).message })
  }
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
