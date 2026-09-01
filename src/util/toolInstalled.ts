/**
 * OpenKaliClaude — Installed-binary probe
 *
 * The Kali catalog documents ~140 tools, but a given backend (a WSL distro, a
 * Docker image, or the host) usually has only a subset actually installed. The
 * catalog used to advertise everything with no notion of what's present, so the
 * model had to burn a tool call to discover a binary was missing (exit 127).
 *
 * This probe answers "which of these binaries exist in the active backend?" in
 * a single subprocess, and caches the answer per-backend for the process
 * lifetime. `KaliCatalogTool` uses it to tag every catalogue entry with its
 * real install state.
 */

import { spawn } from 'node:child_process'
import { dockerContainer, wslDistro, dockerLabel } from './dockerExec.js'

// One in-flight probe per backend label, memoised for the process lifetime.
const cache = new Map<string, Promise<Set<string> | null>>()

/** Only allow safe binary names into the shell script we build. */
function safeBin(b: string): boolean {
  return /^[a-zA-Z0-9._-]+$/.test(b)
}

/**
 * Return the subset of `bins` that resolve to an executable in the active
 * backend, or `null` if the install state can't be determined (e.g. host mode
 * on a machine with no POSIX `sh`). Result is cached per backend.
 */
export function probeInstalledBinaries(bins: string[]): Promise<Set<string> | null> {
  const label = dockerLabel()
  const cached = cache.get(label)
  if (cached) return cached
  const p = runProbe(bins)
  cache.set(label, p)
  return p
}

/** Drop the cache (used when the backend is switched at runtime, e.g. /docker). */
export function resetInstalledProbe(): void {
  cache.clear()
}

function runProbe(bins: string[]): Promise<Set<string> | null> {
  const list = Array.from(new Set(bins.filter(safeBin)))
  if (list.length === 0) return Promise.resolve(new Set<string>())

  // Use `which <bin1> <bin2> …`, passing each binary as its OWN argv token.
  // This resolves every binary in one round trip and — unlike a `sh -lc "for …"`
  // script — survives the Windows→WSL argument marshaling intact (a shell loop
  // string gets mangled crossing that boundary and silently finds nothing).
  // `which` prints the full path of each installed binary to stdout and simply
  // omits the missing ones (exiting non-zero, which we ignore).
  let cmd: string
  let args: string[]
  const container = dockerContainer()
  const distro = wslDistro()
  if (container) {
    cmd = 'docker'; args = ['exec', container, 'which', ...list]
  } else if (distro) {
    cmd = 'wsl.exe'; args = ['-d', distro, '--', 'which', ...list]
  } else if (process.platform === 'win32') {
    // Host is Windows with no backend — we can't run POSIX `which`, so install
    // state is unknown rather than "all missing".
    return Promise.resolve(null)
  } else {
    cmd = 'which'; args = list
  }

  return new Promise<Set<string> | null>(resolve => {
    let out = ''
    let settled = false
    const done = (v: Set<string> | null) => { if (!settled) { settled = true; resolve(v) } }
    try {
      const child = spawn(cmd, args, { windowsHide: true })
      const killer = setTimeout(() => { try { child.kill('SIGKILL') } catch { /* noop */ } done(null) }, 8000)
      child.stdout.on('data', (d: Buffer) => { out += d.toString() })
      child.on('error', () => { clearTimeout(killer); done(null) })
      child.on('close', () => {
        clearTimeout(killer)
        // Each line is a resolved path like `/usr/bin/nmap`; reduce to the
        // lower-cased basename so it matches catalogue binary names.
        const found = new Set(
          out.split(/\r?\n/)
            .map(s => s.trim())
            .filter(Boolean)
            .map(p => (p.split(/[/\\]/).pop() || p).toLowerCase())
        )
        done(found)
      })
    } catch {
      done(null)
    }
  })
}
