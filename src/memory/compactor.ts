/**
 * OpenKaliClaude — Context Compactor
 *
 * Claude-Code-style automatic context compaction: when the running token
 * budget for the conversation exceeds a threshold, summarize the older
 * half of the conversation into a short "[context summary]" block and
 * drop the originals. Recent turns stay verbatim so the model keeps sharp
 * local context; older turns collapse into a single summary entry.
 *
 * The summarizer is pluggable — for Anthropic we delegate to a one-shot
 * `query()` call; for local OpenAI-compatible providers we call
 * chat.completions.create. Both paths are wrapped so the caller just sees
 * `summarize(text) -> string`.
 */

import type { MemoryEntry } from './store.js'
import { estimateTokens } from './store.js'

/** Default budget: compact when running conversation exceeds this. */
export const DEFAULT_MAX_TOKENS = 40_000
/** Keep at least this many most-recent entries verbatim. */
export const KEEP_RECENT = 10

export type Summarizer = (text: string) => Promise<string>

/**
 * Decide whether compaction should run and, if so, return the
 * (head, tail) split: `head` will be summarized, `tail` will be kept.
 */
export function planCompaction(
  entries: MemoryEntry[],
  maxTokens = DEFAULT_MAX_TOKENS,
  keepRecent = KEEP_RECENT
): { shouldCompact: boolean; head: MemoryEntry[]; tail: MemoryEntry[] } {
  let total = 0
  for (const e of entries) total += e.tokens || estimateTokens(e.content)
  if (total <= maxTokens || entries.length <= keepRecent) {
    return { shouldCompact: false, head: [], tail: entries }
  }
  const head = entries.slice(0, entries.length - keepRecent)
  const tail = entries.slice(entries.length - keepRecent)
  return { shouldCompact: true, head, tail }
}

/** Format entries into a single block of text for the summarizer prompt. */
export function flattenForSummary(entries: MemoryEntry[]): string {
  return entries.map(e => `[${e.role}] ${e.content}`).join('\n\n')
}

export const SUMMARY_PROMPT = `You are compacting the context of an offensive-security CLI session for re-injection into a future conversation. Produce a TERSE structured summary capturing:

1. Goal / task the operator is pursuing
2. Targets in scope (hosts, URLs, CIDRs) — NEVER invent any
3. Findings so far (open ports, vulns, creds, file paths) as a bullet list
4. Tools already run and their key results
5. Decisions / constraints the operator has stated
6. Open questions / next steps

Keep it under 600 tokens. Do not include pleasantries, do not repeat the transcript verbatim, do not speculate. If a section has nothing, omit it.`

/**
 * Run the full compaction cycle. Returns a new entry list that replaces
 * the old one: one `summary` entry followed by the preserved tail.
 */
export async function compact(
  entries: MemoryEntry[],
  summarize: Summarizer,
  opts: { maxTokens?: number; keepRecent?: number } = {}
): Promise<{ compacted: boolean; entries: MemoryEntry[]; summaryText?: string }> {
  const plan = planCompaction(entries, opts.maxTokens, opts.keepRecent)
  if (!plan.shouldCompact) return { compacted: false, entries }

  const flat = flattenForSummary(plan.head)
  const prompt = `${SUMMARY_PROMPT}\n\n---\n${flat}\n---`
  let summaryText: string
  try {
    summaryText = await summarize(prompt)
  } catch (e) {
    // If summarization fails, fall back to keeping just the tail so we
    // don't block the session on a provider hiccup.
    summaryText = `[compaction failed: ${(e as Error).message}] — dropping ${plan.head.length} older turns`
  }

  const summaryEntry: MemoryEntry = {
    ts: new Date().toISOString(),
    role: 'summary',
    content: summaryText,
    tokens: estimateTokens(summaryText),
    meta: { compactedCount: plan.head.length }
  }
  return { compacted: true, entries: [summaryEntry, ...plan.tail], summaryText }
}
