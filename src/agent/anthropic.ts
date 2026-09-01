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

import { AgentToolContext, buildAnthropicMcpServer, buildAgentSystemPrompt, anthropicAllowedToolNames } from './tools.js'
import { renderCommandsToStderr, emitStatus } from '../util/commandLog.js'

export interface AnthropicAgentOptions {
  prompt: string
  model?: string                // e.g. "claude-fable-5-1", "claude-sonnet-5"
  systemPrompt?: string
  maxTurns?: number
  ctx: AgentToolContext
}

export async function runAnthropicAgent(opts: AnthropicAgentOptions): Promise<void> {
  const { query } = await import('@anthropic-ai/claude-agent-sdk')

  // Live command visibility — print each tool call / resolved command as the
  // agent runs it, so the operator isn't staring at a blind box.
  renderCommandsToStderr()

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
      // Generated from the live registry so new tools (kali, kali_catalog, …)
      // are enabled automatically instead of silently blocked.
      allowedTools: anthropicAllowedToolNames(),
      permissionMode: 'default'
    }
  })

  // Live view: Claude is thinking until the first message streams back. Tool
  // calls/results inside the run are surfaced by the shared dispatch layer,
  // which also re-arms this spinner after each tool returns.
  emitStatus('Claude is thinking', true)

  for await (const message of response) {
    if (message.type === 'assistant') {
      emitStatus('', false)   // clear the spinner before printing the reply
      const content = (message as { message?: { content?: Array<{ type: string; text?: string }> } }).message?.content
      if (Array.isArray(content)) {
        let wroteText = false
        for (const block of content) {
          if (block.type === 'text' && block.text) {
            process.stdout.write(block.text)
            wroteText = true
          }
        }
        if (wroteText) process.stdout.write('\n')
      }
    } else if (message.type === 'result') {
      emitStatus('', false)
      const result = message as { subtype?: string; total_cost_usd?: number; num_turns?: number }
      if (result.subtype === 'success') {
        console.error(`\n[agent] turns=${result.num_turns} cost=$${result.total_cost_usd?.toFixed(4) ?? '0'}`)
      } else {
        console.error(`\n[agent] finished: ${result.subtype}`)
      }
    }
  }

  // Belt and braces: never leave a spinner running after the stream ends.
  emitStatus('', false)
}
