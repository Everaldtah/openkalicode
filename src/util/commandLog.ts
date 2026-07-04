/**
 * OpenKaliClaude — Command Visibility Log
 *
 * Gives the operator a live view of what the agent is actually doing, instead
 * of a blind "thinking… here's my answer" experience. Two kinds of events flow
 * through a single emitter:
 *
 *   - 'call'  — the agent invoked a tool with these arguments (emitted from the
 *               universal dispatch choke point, so it fires for every tool and
 *               for both the Anthropic and local/OpenAI providers).
 *   - 'exec'  — a tool is about to run this exact shell command (emitted by the
 *               Kali runner right before spawn, so you see the fully-resolved
 *               binary + argv, including any docker/sudo rewrite).
 *
 * `renderCommandsToStderr()` attaches a formatted console renderer. It is
 * idempotent and honours OKAL_HIDE_COMMANDS=1 for users who want the old quiet
 * behaviour.
 */

import { EventEmitter } from 'node:events'
import chalk from 'chalk'

export interface CommandEvent {
  kind: 'call' | 'exec'
  tool: string
  detail: string
  dryRun?: boolean
}

export const commandLog = new EventEmitter()
// The agent may fan out many tool calls; avoid Node's default 10-listener warning.
commandLog.setMaxListeners(0)

/** Emitted at the dispatch layer: the agent chose to call `tool` with `input`. */
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

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s
}

let rendering = false

/**
 * Subscribe a human-readable renderer that writes each command event to stderr.
 * Safe to call multiple times (only the first call attaches a listener) and
 * from any provider. No-op when OKAL_HIDE_COMMANDS=1.
 */
export function renderCommandsToStderr(): void {
  if (rendering) return
  if (process.env.OKAL_HIDE_COMMANDS === '1') return
  rendering = true

  const color = process.stderr.isTTY
  const dim = color ? chalk.dim : (s: string) => s
  const tool = color ? chalk.cyanBright.bold : (s: string) => s
  const warn = color ? chalk.yellow : (s: string) => s

  commandLog.on('command', (e: CommandEvent) => {
    if (e.kind === 'call') {
      process.stderr.write(dim('  ▶ ') + tool(e.tool) + dim('  ' + truncate(e.detail, 500)) + '\n')
    } else {
      const tag = e.dryRun ? warn('[dry-run] ') : ''
      process.stderr.write(dim('    $ ') + tag + truncate(e.detail, 800) + '\n')
    }
  })
}

/** For tests / embedders: detach the console renderer. */
export function resetCommandRenderer(): void {
  commandLog.removeAllListeners('command')
  rendering = false
}
