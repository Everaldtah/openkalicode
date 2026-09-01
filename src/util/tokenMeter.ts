/**
 * OpenKaliClaude — Session Token Meter
 *
 * Tracks token usage across a session the way the Claude Code status line does:
 * per-turn tokens and throughput (tokens/sec), plus a running session total.
 * Both providers report usage — the OpenAI-compatible local path via
 * `response.usage`, the Anthropic path via the final `result` message — and
 * feed it here through a single `recordTurn()` call.
 */

export interface TurnUsage {
  inputTokens: number
  outputTokens: number
  /** Wall-clock generation time for the turn, in ms (for tokens/sec). */
  ms: number
  /** Optional cost in USD, if the provider reports it (Anthropic). */
  costUsd?: number
}

export interface SessionTotals {
  turns: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  genMs: number
  costUsd: number
}

class TokenMeter {
  private totals: SessionTotals = {
    turns: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, genMs: 0, costUsd: 0,
  }
  private last: TurnUsage | null = null

  /** Record one completed turn's usage and roll it into the session totals. */
  recordTurn(u: TurnUsage): void {
    if (!u || (!u.inputTokens && !u.outputTokens)) return
    this.last = u
    this.totals.turns += 1
    this.totals.inputTokens += u.inputTokens
    this.totals.outputTokens += u.outputTokens
    this.totals.totalTokens += u.inputTokens + u.outputTokens
    this.totals.genMs += u.ms
    this.totals.costUsd += u.costUsd || 0
  }

  session(): SessionTotals {
    return { ...this.totals }
  }

  lastTurn(): TurnUsage | null {
    return this.last
  }

  /** tokens/sec for a turn = output tokens / generation seconds. */
  static tokensPerSec(outputTokens: number, ms: number): number {
    if (ms <= 0) return 0
    return outputTokens / (ms / 1000)
  }

  /** One-line summary for after a turn, e.g. in the REPL. */
  formatTurnLine(): string {
    if (!this.last) return ''
    const tps = TokenMeter.tokensPerSec(this.last.outputTokens, this.last.ms)
    const t = this.totals
    const cost = t.costUsd > 0 ? `  ·  $${t.costUsd.toFixed(4)}` : ''
    return `⚡ ${fmt(this.last.inputTokens)} in / ${fmt(this.last.outputTokens)} out  ·  ${tps.toFixed(1)} tok/s` +
           `  ·  session ${fmt(t.totalTokens)} tok (${t.turns} turn${t.turns === 1 ? '' : 's'})${cost}`
  }

  /** Multi-line detail for a `/tokens` command. */
  formatSession(): string {
    const t = this.totals
    const avgTps = TokenMeter.tokensPerSec(t.outputTokens, t.genMs)
    const lines = [
      `  turns:          ${t.turns}`,
      `  input tokens:   ${fmt(t.inputTokens)}`,
      `  output tokens:  ${fmt(t.outputTokens)}`,
      `  total tokens:   ${fmt(t.totalTokens)}`,
      `  avg throughput: ${avgTps.toFixed(1)} tok/s (output)`,
    ]
    if (t.costUsd > 0) lines.push(`  cost:           $${t.costUsd.toFixed(4)}`)
    return lines.join('\n')
  }

  reset(): void {
    this.totals = { turns: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, genMs: 0, costUsd: 0 }
    this.last = null
  }
}

function fmt(n: number): string {
  return n.toLocaleString('en-US')
}

/** Process-wide session meter. */
export const tokenMeter = new TokenMeter()
export { TokenMeter }
