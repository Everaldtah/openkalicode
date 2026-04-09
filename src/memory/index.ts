/**
 * OpenKaliClaude — Memory Manager
 *
 * One stop for persistence + compaction. Used by both the REPL and the
 * agent loops: the provider decides how to inject memory into its prompt,
 * but the bookkeeping (load, append, compact, persist) lives here.
 *
 *   const mem = await MemoryManager.load()
 *   mem.recordUser("scan 10.0.0.5")
 *   const preamble = mem.buildPreamble()      // inject into system/user prompt
 *   mem.recordAssistant(responseText)
 *   await mem.maybeCompact(summarizer)         // auto-compaction if over budget
 */

import {
  append,
  loadAll,
  loadSummary,
  writeSummary,
  truncateToTail,
  totalTokens,
  projectKey,
  estimateTokens,
  locationsForDebug,
  type MemoryEntry,
  type MemoryRole
} from './store.js'
import { compact, DEFAULT_MAX_TOKENS, KEEP_RECENT, type Summarizer } from './compactor.js'

export interface MemoryOptions {
  maxTokens?: number
  keepRecent?: number
  cwd?: string
}

export class MemoryManager {
  private entries: MemoryEntry[]
  private summary: string | null
  private key: string
  private opts: Required<Pick<MemoryOptions, 'maxTokens' | 'keepRecent'>>

  private constructor(entries: MemoryEntry[], summary: string | null, key: string, opts: MemoryOptions) {
    this.entries = entries
    this.summary = summary
    this.key = key
    this.opts = {
      maxTokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
      keepRecent: opts.keepRecent ?? KEEP_RECENT
    }
  }

  static async load(opts: MemoryOptions = {}): Promise<MemoryManager> {
    const key = projectKey(opts.cwd)
    const entries = loadAll(key)
    const summary = loadSummary(key)
    return new MemoryManager(entries, summary, key, opts)
  }

  /** Append a turn to disk and in-memory state. */
  record(role: MemoryRole, content: string, meta?: Record<string, unknown>): void {
    if (!content || !content.trim()) return
    const e: MemoryEntry = { ts: new Date().toISOString(), role, content, tokens: estimateTokens(content), meta }
    this.entries.push(e)
    append(e, this.key)
  }

  recordUser(content: string): void { this.record('user', content) }
  recordAssistant(content: string): void { this.record('assistant', content) }
  recordTool(content: string, meta?: Record<string, unknown>): void { this.record('tool', content, meta) }
  recordCode(path: string, content: string): void {
    this.record('code', content, { path })
  }

  /**
   * Build a compact preamble to inject into the next prompt. Contains the
   * rolling summary (if any) plus the most recent turns. Keeps the memory
   * under a generous budget so it never dominates the actual prompt.
   */
  buildPreamble(budgetTokens = 4_000): string {
    const parts: string[] = []
    if (this.summary) {
      parts.push('## Prior session summary\n' + this.summary.trim())
    }
    const tail: MemoryEntry[] = []
    let used = this.summary ? estimateTokens(this.summary) : 0
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const e = this.entries[i]
      const t = e.tokens || estimateTokens(e.content)
      if (used + t > budgetTokens) break
      tail.unshift(e)
      used += t
    }
    if (tail.length) {
      parts.push('## Recent turns')
      for (const e of tail) parts.push(`[${e.role}] ${e.content}`)
    }
    if (parts.length === 0) return ''
    return '--- OpenKaliClaude persistent memory ---\n' + parts.join('\n\n') + '\n--- end memory ---\n'
  }

  /**
   * Run compaction if over budget. Persists the new summary and rewrites
   * the log to just the preserved tail. Safe to call every turn.
   */
  async maybeCompact(summarize: Summarizer): Promise<boolean> {
    const before = totalTokens(this.entries)
    if (before <= this.opts.maxTokens) return false
    const res = await compact(this.entries, summarize, this.opts)
    if (!res.compacted) return false

    this.entries = res.entries
    if (res.summaryText) {
      // Merge into rolling summary so cross-session memory keeps the gist.
      this.summary = this.summary
        ? `${this.summary}\n\n[${new Date().toISOString()}]\n${res.summaryText}`
        : res.summaryText
      writeSummary(this.summary, this.key)
    }
    truncateToTail(this.opts.keepRecent, this.key)
    // Re-append the synthetic summary entry so the log matches in-memory state.
    const summaryEntry = this.entries[0]
    if (summaryEntry?.role === 'summary') append(summaryEntry, this.key)
    return true
  }

  stats(): { turns: number; tokens: number; hasSummary: boolean; locations: ReturnType<typeof locationsForDebug> } {
    return {
      turns: this.entries.length,
      tokens: totalTokens(this.entries),
      hasSummary: !!this.summary,
      locations: locationsForDebug()
    }
  }
}

export { DEFAULT_MAX_TOKENS, KEEP_RECENT } from './compactor.js'
export type { Summarizer } from './compactor.js'
