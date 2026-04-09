/**
 * Preflight check for external security binaries.
 *
 * Runs once on REPL startup (with a cached result on disk), surfaces which
 * tools are actually installed on this host, and lets SecurityTool wrappers
 * short-circuit with a clean "not installed" error instead of crashing on
 * ENOENT mid-agent-loop.
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { safeSpawn } from './safeSpawn.js'

export interface ToolAvailability {
  nmap: boolean
  nikto: boolean
  sqlmap: boolean
  hashcat: boolean
  msfconsole: boolean
  checkedAt: string
  platform: string
}

const CACHE_PATH = path.join(os.homedir(), '.config', 'openkaliclaude', 'tools.json')
const CACHE_TTL_MS = 24 * 60 * 60 * 1000  // 24 h — installs don't change often

async function which(bin: string): Promise<boolean> {
  // `--version` is the cheapest cross-tool probe that exists on all five.
  // If the binary is missing, safeSpawn rejects; otherwise we don't care
  // about the exit code.
  try {
    const { child, spawned } = safeSpawn(bin, ['--version'])
    // Drain stdio so the pipes don't fill and block the child.
    child.stdout.on('data', () => { /* drain */ })
    child.stderr.on('data', () => { /* drain */ })
    await spawned
    child.kill()
    return true
  } catch {
    return false
  }
}

export async function probeTools(force = false): Promise<ToolAvailability> {
  if (!force) {
    const cached = readCache()
    if (cached) return cached
  }
  const [nmap, nikto, sqlmap, hashcat, msfconsole] = await Promise.all([
    which('nmap'),
    which('nikto'),
    which('sqlmap'),
    which('hashcat'),
    which('msfconsole')
  ])
  const out: ToolAvailability = {
    nmap, nikto, sqlmap, hashcat, msfconsole,
    checkedAt: new Date().toISOString(),
    platform: `${os.platform()}-${os.arch()}`
  }
  writeCache(out)
  return out
}

function readCache(): ToolAvailability | null {
  try {
    if (!fs.existsSync(CACHE_PATH)) return null
    const data = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8')) as ToolAvailability
    if (Date.now() - Date.parse(data.checkedAt) > CACHE_TTL_MS) return null
    if (data.platform !== `${os.platform()}-${os.arch()}`) return null
    return data
  } catch { return null }
}

function writeCache(a: ToolAvailability): void {
  try {
    fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true })
    fs.writeFileSync(CACHE_PATH, JSON.stringify(a, null, 2), 'utf8')
  } catch { /* best-effort */ }
}

export function formatBanner(a: ToolAvailability): string {
  const mark = (ok: boolean) => ok ? '✓' : '✗'
  return `tools: nmap${mark(a.nmap)}  nikto${mark(a.nikto)}  sqlmap${mark(a.sqlmap)}  hashcat${mark(a.hashcat)}  msfconsole${mark(a.msfconsole)}`
}

/** Throw a friendly error if a required binary is missing. */
export function assertAvailable(a: ToolAvailability, key: keyof Omit<ToolAvailability, 'checkedAt' | 'platform'>): void {
  if (!a[key]) {
    throw new Error(`${key} is not installed on this host. Install it first or switch to a Kali/WSL environment. (run '/tools' to re-probe after installing)`)
  }
}
