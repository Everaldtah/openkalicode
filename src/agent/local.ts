/**
 * OpenKaliClaude - Local Provider (LM Studio / Ollama / any OpenAI-compatible)
 *
 * Both LM Studio and Ollama expose an OpenAI-compatible /v1 endpoint with
 * tool-calling support, so we can drive them with the official `openai` SDK
 * by overriding `baseURL`.
 *
 *   LM Studio  → http://localhost:1234/v1
 *   Ollama     → http://localhost:11434/v1
 *
 * No API key is required by either, but the SDK demands a non-empty string,
 * so we pass a dummy.
 *
 * The agent loop is implemented manually:
 *   - send messages + tool definitions
 *   - if the assistant returns tool_calls, dispatch each into the SecurityTool
 *     pipeline and append the result as a `tool` role message
 *   - loop until the assistant returns a message with no tool_calls
 *     (or maxTurns is reached)
 */

import { AgentToolContext, buildOpenAITools, dispatchToolCall } from './tools.js'

export type LocalProvider = 'lmstudio' | 'ollama' | 'custom'

export interface LocalAgentOptions {
  prompt: string
  provider: LocalProvider
  model: string                        // e.g. "qwen2.5-coder", "llama3.1:8b"
  baseUrl?: string                     // overrides provider default
  apiKey?: string                      // optional, defaults to "not-needed"
  systemPrompt?: string
  maxTurns?: number
  ctx: AgentToolContext
}

const DEFAULT_BASE_URLS: Record<LocalProvider, string> = {
  lmstudio: 'http://localhost:1234/v1',
  ollama:   'http://localhost:11434/v1',
  custom:   'http://localhost:8000/v1'
}

const DEFAULT_SYSTEM_PROMPT = `You are OpenKaliClaude, an authorized security testing assistant. \
You have access to vetted Kali-Linux security tools (nmap, nikto, sqlmap, hashcat, metasploit). \
Targets are restricted by a scope policy enforced outside your control — do not try to bypass it. \
Prefer the least invasive tool first, and use dryRun when unsure.`

export async function runLocalAgent(opts: LocalAgentOptions): Promise<void> {
  const { default: OpenAI } = await import('openai')

  const baseURL = opts.baseUrl || DEFAULT_BASE_URLS[opts.provider]
  const client = new OpenAI({
    baseURL,
    apiKey: opts.apiKey || 'not-needed'
  })

  const tools = buildOpenAITools()
  const messages: Array<Record<string, unknown>> = [
    { role: 'system', content: opts.systemPrompt || DEFAULT_SYSTEM_PROMPT },
    { role: 'user',   content: opts.prompt }
  ]

  const maxTurns = opts.maxTurns ?? 20

  for (let turn = 0; turn < maxTurns; turn++) {
    const response = await client.chat.completions.create({
      model: opts.model,
      messages: messages as never,
      tools: tools as never,
      tool_choice: 'auto'
    })

    const choice = response.choices[0]
    const msg = choice.message
    messages.push(msg as never)

    if (msg.content) {
      process.stdout.write(msg.content + '\n')
    }

    const toolCalls = (msg as { tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> }).tool_calls
    if (!toolCalls || toolCalls.length === 0) {
      // Model produced a plain answer — we're done.
      console.error(`\n[agent] turns=${turn + 1} provider=${opts.provider} model=${opts.model}`)
      return
    }

    for (const call of toolCalls) {
      console.error(`[agent] -> ${call.function.name}(${call.function.arguments})`)
      const result = await dispatchToolCall(call.function.name, call.function.arguments, opts.ctx)
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: result
      })
    }
  }

  console.error(`\n[agent] hit maxTurns=${maxTurns} without resolution`)
}
