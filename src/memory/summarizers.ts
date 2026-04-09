/**
 * Summarizer factories for the memory compactor.
 *
 * Both provider families (Anthropic + OpenAI-compatible) get a one-shot
 * summarization path that reuses the user's already-configured auth /
 * base URL, so compaction never requires a separate key or model choice.
 */

import type { Summarizer } from './compactor.js'

export function makeAnthropicSummarizer(model = 'claude-haiku-4-5'): Summarizer {
  return async (text: string) => {
    const { query } = await import('@anthropic-ai/claude-agent-sdk')
    const response = query({
      prompt: text,
      options: { model, maxTurns: 1, permissionMode: 'default' }
    })
    let out = ''
    for await (const message of response) {
      if (message.type === 'assistant') {
        const content = (message as { message?: { content?: Array<{ type: string; text?: string }> } }).message?.content
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'text' && block.text) out += block.text
          }
        }
      }
    }
    return out.trim() || '[summary unavailable]'
  }
}

export function makeOpenAISummarizer(opts: { baseUrl: string; apiKey?: string; model: string }): Summarizer {
  return async (text: string) => {
    const { default: OpenAI } = await import('openai')
    const client = new OpenAI({ baseURL: opts.baseUrl, apiKey: opts.apiKey || 'not-needed' })
    const res = await client.chat.completions.create({
      model: opts.model,
      messages: [{ role: 'user', content: text }]
    })
    return res.choices[0]?.message?.content?.trim() || '[summary unavailable]'
  }
}
