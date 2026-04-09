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

import { AgentToolContext, buildOpenAITools, dispatchToolCall, buildAgentSystemPrompt } from './tools.js'
import { ThinkingStreamFilter, stripThinking } from '../util/thinkingFilter.js'

/**
 * Extra guardrails specifically for small OSS models (Qwen, Llama, DeepSeek…).
 * Prepended to the normal system prompt. Fixes the top failure modes we've
 * seen in practice:
 *
 *   - `<think>` reasoning leaking into the final answer and into memory
 *   - calling tool names that don't exist ("test", "recon", etc.)
 *   - retrying the same rejected call with trivial variations
 *   - chain-calling 6 tools in a single turn
 */
const LOCAL_MODEL_RULES = `
You are running on a local open-source LLM. Follow these rules STRICTLY:

1. Never emit <think>, <reasoning>, or <thought> tags in your final output.
   Do any internal reasoning silently. The user only sees your final answer.
2. Only call tools whose names appear in the provided tool list. If the tool
   you want does not exist, say so in text — do not invent tool names.
3. Call AT MOST ONE tool per turn, then stop and wait for the result. Read the
   result carefully before deciding the next step.
4. If a tool returns a scope / authorization error, do NOT retry with the same
   family of targets (10.x, 172.16.x, 192.168.x). Read the error message —
   it tells you exactly which networks are allowed. Pick a target that is
   contained in one of them, or ask the user to widen scope.
5. If a tool reports "not installed", do NOT retry it. Tell the user and
   suggest the install command, or fall back to a different tool.
6. Be terse. No preamble, no chain-of-thought narration, no trailing recap.
`.trim()


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

export async function runLocalAgent(opts: LocalAgentOptions): Promise<void> {
  const { default: OpenAI } = await import('openai')

  const baseURL = opts.baseUrl || DEFAULT_BASE_URLS[opts.provider]
  const client = new OpenAI({
    baseURL,
    apiKey: opts.apiKey || 'not-needed'
  })

  const tools = buildOpenAITools()
  // Prepend local-model guardrails to the normal system prompt so small OSS
  // models don't leak <think> blocks, hallucinate tool names, or hammer the
  // scope validator in a retry loop.
  const baseSystem = opts.systemPrompt || buildAgentSystemPrompt(opts.ctx.scope)
  const systemPrompt = `${LOCAL_MODEL_RULES}\n\n${baseSystem}`
  const messages: Array<Record<string, unknown>> = [
    { role: 'system', content: systemPrompt },
    { role: 'user',   content: opts.prompt }
  ]

  // Local models loop more than Claude when confused. 8 turns is plenty for
  // a focused task; anything more and the model is almost certainly lost.
  const maxTurns = opts.maxTurns ?? 8

  // One filter per invocation: strip reasoning tags from any assistant text
  // before it hits the user's terminal OR the persistent memory log.
  const thinkFilter = new ThinkingStreamFilter()

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
      // Strip <think> blocks before display and rewrite the message in the
      // transcript so future turns don't re-include the reasoning.
      const cleaned = stripThinking(thinkFilter.feed(msg.content) + thinkFilter.flush())
      if (cleaned) process.stdout.write(cleaned + '\n')
      ;(msg as { content?: string }).content = cleaned
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
