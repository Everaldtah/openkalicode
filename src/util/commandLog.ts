/**
 * OpenKaliClaude — Live Tool-Use Viewer
 *
 * Gives the operator a live, play-by-play view of what the model and the
 * harness are doing while a task runs, instead of a blind "thinking… here's
 * my answer" box. Every provider (Anthropic + local/OpenAI) funnels through
 * the same event stream, so the view is identical regardless of which model
 * is driving.
 *
 * Event kinds:
 *   - 'status' — the harness/model is busy (e.g. "model is thinking"). Drives
 *                an animated spinner with a live elapsed-time counter so the
 *                panel never looks frozen.
 *   - 'call'   — the model invoked a tool with these arguments (emitted from
 *                the universal dispatch choke point).
 *   - 'exec'   — a tool is about to spawn this exact resolved command line
 *                (binary + argv, including any docker/sudo rewrite).
 *   - 'result' — a tool finished: ok/failed, a one-line summary, and how long
 *                it took.
 *
 * `renderCommandsToStderr()` attaches the viewer. It is idempotent, TTY-aware
 * (the spinner only animates on a real terminal; piped/non-TTY output still
 * gets every permanent line), and honours OKAL_HIDE_COMMANDS=1 for users who
 * want the old quiet behaviour.
 */

import { EventEmitter } from 'node:events'
import chalk from 'chalk'

export interface CommandEvent {
  kind: 'call' | 'exec' | 'result' | 'status'
  tool?: string
  detail?: string
  dryRun?: boolean
  ok?: boolean
  ms?: number
  active?: boolean   // for 'status': true = start spinner, false = stop
}

export const commandLog = new EventEmitter()
// The agent may fan out many tool calls; avoid Node's default 10-listener warning.
commandLog.setMaxListeners(0)

/** Emitted at the dispatch layer: the model chose to call `tool` with `input`. */
export function emitToolCall(tool: string, input: unknown): void {
  let detail: string
  try {
    detail = typeof input === 'string' ? input : JSON.stringify(input)
  } catch {
    detail = String(input)
  }
  commandLog.emit('command', { kind: 'call', tool, detail } as CommandEvent)
}

/** Emitted just before a tool spawns a process: the resolved command line. */
export function emitExec(tool: string, command: string, dryRun = false): void {
  commandLog.emit('command', { kind: 'exec', tool, detail: command, dryRun } as CommandEvent)
}

/** Emitted after a tool returns: whether it succeeded, a summary, and timing. */
export function emitToolResult(tool: string, ok: boolean, summary: string, ms?: number): void {
  commandLog.emit('command', { kind: 'result', tool, detail: summary, ok, ms } as CommandEvent)
}

/**
 * Emitted by a provider loop around a model-generation wait. `active:true`
 * starts the "thinking" spinner; `active:false` stops it. Safe to call in
 * non-TTY contexts (it becomes a no-op there).
 */
export function emitStatus(label: string, active: boolean): void {
  commandLog.emit('command', { kind: 'status', detail: label, active } as CommandEvent)
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s
}

let rendering = false

// ─── spinner state (module-level so the single renderer owns it) ──────────────

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
let spinTimer: NodeJS.Timeout | null = null
let spinLabel = ''
let spinStart = 0
let spinFrame = 0

function spinnerActive(): boolean {
  return spinTimer !== null
}

function clearSpinnerLine(): void {
  if (process.stderr.isTTY) process.stderr.write('\r\x1b[2K')
}

function stopSpinner(): void {
  if (spinTimer) {
    clearInterval(spinTimer)
    spinTimer = null
  }
  clearSpinnerLine()
}

function startSpinner(label: string): void {
  // No animation off a real terminal — permanent lines still print, but a
  // rewriting spinner would just spam control codes into a pipe/file.
  if (!process.stderr.isTTY) return
  if (process.env.OKAL_HIDE_COMMANDS === '1') return
  stopSpinner()
  spinLabel = label
  spinStart = Date.now()
  spinFrame = 0
  const dim = chalk.dim
  const accent = chalk.hex('#2EA8FF')
  const paint = () => {
    const secs = ((Date.now() - spinStart) / 1000).toFixed(1)
    const frame = SPINNER_FRAMES[spinFrame = (spinFrame + 1) % SPINNER_FRAMES.length]
    process.stderr.write('\r\x1b[2K' + accent('  ' + frame + ' ') + dim(spinLabel + '  ') + dim(secs + 's'))
  }
  paint()
  spinTimer = setInterval(paint, 120)
  // Never let the spinner keep the event loop alive on its own.
  if (typeof spinTimer.unref === 'function') spinTimer.unref()
}

/**
 * Print one permanent line, cleanly stepping around any running spinner:
 * clear the spinner line, write the message, then (optionally) re-arm the
 * spinner so ongoing work keeps animating below the new line.
 */
function printLine(text: string, resumeSpinner: boolean): void {
  const hadSpinner = spinnerActive()
  const label = spinLabel
  stopSpinner()
  process.stderr.write(text + '\n')
  if (resumeSpinner && hadSpinner) startSpinner(label)
}

/**
 * Subscribe the live viewer to the command event stream. Safe to call multiple
 * times (only the first call attaches). No-op when OKAL_HIDE_COMMANDS=1.
 */
export function renderCommandsToStderr(): void {
  if (rendering) return
  if (process.env.OKAL_HIDE_COMMANDS === '1') return
  rendering = true

  const color = process.stderr.isTTY
  const dim   = color ? chalk.dim : (s: string) => s
  const tool  = color ? chalk.cyanBright.bold : (s: string) => s
  const warn  = color ? chalk.yellow : (s: string) => s
  const ok    = color ? chalk.greenBright : (s: string) => s
  const bad   = color ? chalk.redBright : (s: string) => s

  if (color) {
    process.stderr.write(dim('  ┄┄ live tool view ┄┄  ') + dim('(set OKAL_HIDE_COMMANDS=1 to silence)\n'))
  }

  commandLog.on('command', (e: CommandEvent) => {
    switch (e.kind) {
      case 'status': {
        if (e.active) startSpinner(e.detail || 'working')
        else stopSpinner()
        break
      }
      case 'call': {
        // A fresh tool call — keep the spinner running afterwards to show the
        // tool executing until its 'result' lands.
        printLine(dim('  ▶ ') + tool(e.tool || 'tool') + dim('  ' + truncate(e.detail || '', 500)), false)
        startSpinner(`${e.tool || 'tool'} · running`)
        break
      }
      case 'exec': {
        const tag = e.dryRun ? warn('[dry-run] ') : ''
        printLine(dim('    $ ') + tag + truncate(e.detail || '', 800), true)
        break
      }
      case 'result': {
        stopSpinner()
        const mark = e.ok ? ok('  ✓ ') : bad('  ✗ ')
        const time = e.ms != null ? dim(` · ${e.ms}ms`) : ''
        const name = e.ok ? dim(e.tool || 'tool') : bad(e.tool || 'tool')
        printLine(mark + name + time + (e.detail ? dim(' · ' + truncate(e.detail, 400)) : ''), false)
        break
      }
    }
  })
}

/** For tests / embedders: detach the viewer and stop any spinner. */
export function resetCommandRenderer(): void {
  stopSpinner()
  commandLog.removeAllListeners('command')
  rendering = false
}
