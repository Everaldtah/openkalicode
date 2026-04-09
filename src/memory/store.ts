/**
 * OpenKaliClaude — Persistent Memory Store
 *
 * Append-only JSONL store under ~/.config/openkaliclaude/memory/.
 *
 * Layout:
 *   ~/.config/openkaliclaude/memory/
 *     <projectKey>.jsonl     ← per-project conversation log
 *     <projectKey>.summary   ← rolling compacted summary (plain text)
 *     global.jsonl           ← cross-project memories the user pinned
 *
 * projectKey = first 12 chars of sha1(cwd). Keeps one memory per working
 * directory, so `okal` in different repos doesn't cross-contaminate.
 *
 * Each line is a MemoryEntry. We never rewrite; compaction writes a new
 * summary file and truncates the log by filename rotation — simple, crash-safe.
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'

export type MemoryRole = 'system' | 'user' | 'assistant' | 'tool' | 'summary' | 'code'

export interface MemoryEntry {
  ts: string                 // ISO timestamp
  role: MemoryRole
  content: string
  tokens?: number            // cached estimate (chars/4)
  meta?: Record<string, unknown>
}

const BASE_DIR =
  process.env.OKAL_MEMORY_DIR ||
  path.join(os.homedir(), '.config', 'openkaliclaude', 'memory')

function ensureDir(): void {
  fs.mkdirSync(BASE_DIR, { recursive: true })
}

export function projectKey(cwd = process.cwd()): string {
  return crypto.createHash('sha1').update(cwd).digest('hex').slice(0, 12)
}

function logPath(key: string): string {
  return path.join(BASE_DIR, `${key}.jsonl`)
}

function summaryPath(key: string): string {
  return path.join(BASE_DIR, `${key}.summary`)
}

/** Rough token estimate — good enough for budget decisions. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export function append(entry: MemoryEntry, key = projectKey()): void {
  ensureDir()
  const e: MemoryEntry = {
    ...entry,
    ts: entry.ts || new Date().toISOString(),
    tokens: entry.tokens ?? estimateTokens(entry.content)
  }
  fs.appendFileSync(logPath(key), JSON.stringify(e) + '\n', 'utf8')
}

export function loadAll(key = projectKey()): MemoryEntry[] {
  ensureDir()
  const p = logPath(key)
  if (!fs.existsSync(p)) return []
  const out: MemoryEntry[] = []
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    if (!line.trim()) continue
    try { out.push(JSON.parse(line)) } catch { /* skip corrupt line */ }
  }
  return out
}

export function loadSummary(key = projectKey()): string | null {
  const p = summaryPath(key)
  if (!fs.existsSync(p)) return null
  return fs.readFileSync(p, 'utf8')
}

export function writeSummary(summary: string, key = projectKey()): void {
  ensureDir()
  fs.writeFileSync(summaryPath(key), summary, 'utf8')
}

/**
 * Replace the log with only the tail of `keepLastN` entries. Called after a
 * successful compaction so we never mutate a file in place (old log is
 * overwritten atomically via temp file + rename).
 */
export function truncateToTail(keepLastN: number, key = projectKey()): void {
  const all = loadAll(key)
  const tail = all.slice(-keepLastN)
  const tmp = logPath(key) + '.tmp'
  fs.writeFileSync(tmp, tail.map(e => JSON.stringify(e)).join('\n') + (tail.length ? '\n' : ''), 'utf8')
  fs.renameSync(tmp, logPath(key))
}

export function totalTokens(entries: MemoryEntry[]): number {
  let t = 0
  for (const e of entries) t += e.tokens || estimateTokens(e.content)
  return t
}

export function locationsForDebug(): { base: string; key: string; log: string; summary: string } {
  const k = projectKey()
  return { base: BASE_DIR, key: k, log: logPath(k), summary: summaryPath(k) }
}
