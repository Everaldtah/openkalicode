/**
 * Wrapper around child_process.spawn that turns ENOENT ("binary not found")
 * into a clean rejection instead of an unhandled 'error' event on the
 * ChildProcess — which otherwise crashes the entire REPL.
 *
 * Every SecurityTool should use this instead of calling spawn() directly.
 */

import { spawn, ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from 'child_process'

export interface SafeChild {
  child: ChildProcessWithoutNullStreams
  /** Resolves with exit info; rejects only on spawn errors (not non-zero exits). */
  spawned: Promise<void>
}

/**
 * Spawn a child process and return a handle. The `spawned` promise rejects
 * with a friendly message if the binary is missing (ENOENT) or another
 * spawn error fires. It resolves as soon as the child is confirmed running.
 *
 * Non-zero exit codes are NOT treated as spawn errors — callers handle those
 * via the `close` / `exit` events on `child` as usual.
 */
export function safeSpawn(
  cmd: string,
  args: string[] = [],
  opts: SpawnOptionsWithoutStdio = {}
): SafeChild {
  const child = spawn(cmd, args, opts)
  const spawned = new Promise<void>((resolve, reject) => {
    let settled = false
    child.once('spawn', () => {
      if (settled) return
      settled = true
      resolve()
    })
    child.once('error', (err: NodeJS.ErrnoException) => {
      if (settled) return
      settled = true
      if (err.code === 'ENOENT') {
        reject(new Error(`${cmd} is not installed or not on PATH. Install it or switch to a host (Kali / WSL) where it is available.`))
      } else {
        reject(new Error(`failed to spawn ${cmd}: ${err.message}`))
      }
    })
  })
  // Prevent "Unhandled 'error' event" from crashing the REPL if no one
  // awaits `spawned`. Attaching a noop listener is enough — Node only
  // throws when the event has zero listeners.
  child.on('error', () => { /* handled by spawned promise */ })
  return { child, spawned }
}
