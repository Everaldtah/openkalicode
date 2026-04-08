/**
 * OpenKaliClaude - Anthropic Provider
 *
 * Drives the agent loop using @anthropic-ai/claude-agent-sdk. Authentication
 * is handled by the SDK using the same mechanism as the Claude Code CLI:
 *
 *   1. Subscription / OAuth — if the user has run `claude login` previously,
 *      the SDK reuses the cached credentials and inference is billed against
 *      their Claude (Pro / Team / Enterprise) subscription.
 *   2. ANTHROPIC_API_KEY — if set, the SDK uses pay-as-you-go API billing.
 *
 * No credentials are read or stored by OpenKaliClaude itself.
 */

import { AgentToolContext, buildAnthropicMcpServer, buildAgentSystemPrompt } from './tools.js'

export interface AnthropicAgentOptions {
  prompt: string
  model?: string                // e.g. "claude-sonnet-4-6", "claude-opus-4-6"
  systemPrompt?: string
  maxTurns?: number
  ctx: AgentToolContext
}

export async function runAnthropicAgent(opts: AnthropicAgentOptions): Promise<void> {
  const { query } = await import('@anthropic-ai/claude-agent-sdk')

  const mcpServer = await buildAnthropicMcpServer(opts.ctx)

  // Generate the system prompt from the live tool registry every run, so the
  // model is always told exactly which security tools it has — never a stale
  // hardcoded list.
  const systemPrompt = opts.systemPrompt || buildAgentSystemPrompt(opts.ctx.scope)

  const response = query({
    prompt: opts.prompt,
    options: {
      model: opts.model,                       // SDK falls back to its default if undefined
      systemPrompt,
      maxTurns: opts.maxTurns ?? 20,
      mcpServers: { 'openkaliclaude-security': mcpServer },
      // Allow only our security tools — block file/bash/web fetch from the
      // SDK's built-ins so the model can't shell out around the guard rails.
      allowedTools: [
        'mcp__openkaliclaude-security__nmap',
        'mcp__openkaliclaude-security__nikto',
        'mcp__openkaliclaude-security__sqlmap',
        'mcp__openkaliclaude-security__hashcat',
        'mcp__openkaliclaude-security__metasploit'
      ],
      permissionMode: 'default'
    }
  })

  for await (const message of response) {
    if (message.type === 'assistant') {
      const content = (message as { message?: { content?: Array<{ type: string; text?: string }> } }).message?.content
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'text' && block.text) {
            process.stdout.write(block.text)
          }
        }
        process.stdout.write('\n')
      }
    } else if (message.type === 'result') {
      const result = message as { subtype?: string; total_cost_usd?: number; num_turns?: number }
      if (result.subtype === 'success') {
        console.error(`\n[agent] turns=${result.num_turns} cost=$${result.total_cost_usd?.toFixed(4) ?? '0'}`)
      } else {
        console.error(`\n[agent] finished: ${result.subtype}`)
      }
    }
  }
}
