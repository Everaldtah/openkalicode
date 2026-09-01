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

async function runProbe(bins: string[]): Promise<Set<string> | null> {
  const list = Array.from(new Set(bins.filter(safeBin)))
  if (list.length === 0) return new Set<string>()

  // Probe in chunks so each call stays small, and run the chunks in PARALLEL:
  // every `wsl.exe` invocation pays its own distro-startup latency, so running
  // them concurrently keeps the whole probe to roughly one round trip instead
  // of N. If ANY chunk fails outright (backend unreachable), the whole probe is
  // "unknown" (null) rather than a misleading partial.
  const CHUNK = 40
  const chunks: string[][] = []
  for (let i = 0; i < list.length; i += CHUNK) chunks.push(list.slice(i, i + CHUNK))

  const results = await Promise.all(chunks.map(runWhichChunk))
  if (results.some(r => r === null)) return null
  const found = new Set<string>()
  for (const r of results) for (const b of r as Set<string>) found.add(b)
  return found
}

function runWhichChunk(list: string[]): Promise<Set<string> | null> {
  // `which <bin1> <bin2> …`, each binary as its OWN argv token. This survives
  // the Windows→WSL argument marshaling intact (a `sh -lc "for …"` script gets
  // mangled crossing that boundary and silently finds nothing). `which` prints
  // the path of each installed binary to stdout and omits the missing ones.
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
      // CRITICAL: ignore stderr at the OS level. WSL prints a "Failed to start
      // the systemd user session" line to stderr; if we leave it as an
      // unread pipe the child can block on the write and never exit, hanging
      // the probe until timeout. `ignore` sends it to the null device.
      const child = spawn(cmd, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
      const killer = setTimeout(() => { try { child.kill('SIGKILL') } catch { /* noop */ } done(null) }, 15000)
      child.stdout?.on('data', (d: Buffer) => { out += d.toString() })
      child.on('error', () => { clearTimeout(killer); done(null) })
      child.on('close', () => {
        clearTimeout(killer)
        // Each line is a resolved path like `/usr/bin/nmap`; reduce to the
        // lower-cased basename so it matches catalogue binary names.
        const hits = new Set(
          out.split(/\r?\n/)
            .map(s => s.trim())
            .filter(Boolean)
            .map(p => (p.split(/[/\\]/).pop() || p).toLowerCase())
        )
        done(hits)
      })
    } catch {
      done(null)
    }
  })
}
