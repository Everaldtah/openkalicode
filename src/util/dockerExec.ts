/**
 * Backend exec rewriter (Docker container OR WSL distro).
 *
 * OpenKaliClaude runs as a Node process. On a real Kali box the security tools
 * are on PATH and spawn directly. On Windows/macOS they are not — so tool
 * spawns are transparently rewritten to run inside a backend that DOES have the
 * Kali toolchain:
 *
 *   OKAL_DOCKER_EXEC=<container>   → `docker exec <container> <tool> …`
 *   OKAL_WSL_DISTRO=<distro>       → `wsl.exe -d <distro> -- <tool> …`
 *
 * Docker takes precedence if both are set. On Windows, if neither is set, the
 * REPL calls `autoConfigureWslBackend()` at startup to detect an installed Kali
 * WSL distro and route into it automatically — so a Windows user with
 * `wsl --install -d kali-linux` gets a working toolchain with zero config.
 *
 * Every SecurityTool goes through `rewriteForDocker()` / `rewriteProbe()`, so
 * adding WSL support here fixes execution for the whole toolchain at once.
 */

import { spawn } from 'node:child_process'

export interface DockerExecOpts {
  /** Whether the caller was going to sudo the command on the host. */
  sudo?: boolean
  /** Whether the child will need stdin (e.g. msfconsole -r -). */
  interactive?: boolean
}

/** Docker container name, or null if docker-exec mode is off. */
export function dockerContainer(): string | null {
  const v = process.env.OKAL_DOCKER_EXEC
  return v && v.trim() ? v.trim() : null
}

/** WSL distro name, or null if WSL mode is off. */
export function wslDistro(): string | null {
  const v = process.env.OKAL_WSL_DISTRO
  return v && v.trim() ? v.trim() : null
}

/** True iff docker-exec mode is active. */
export function isDockerMode(): boolean {
  return dockerContainer() !== null
}

/** True iff WSL mode is active (and docker is not — docker wins). */
export function isWslMode(): boolean {
  return !isDockerMode() && wslDistro() !== null
}

/** True iff tool spawns are routed through a remote backend (docker or WSL). */
export function isRemoteExec(): boolean {
  return isDockerMode() || isWslMode()
}

/**
 * Rewrite a (cmd, args) pair to run inside the configured backend.
 * When no backend is set, returns the inputs unchanged (plus a sudo prefix if
 * requested), so call sites can use this unconditionally.
 */
export function rewriteForDocker(
  cmd: string,
  args: string[],
  opts: DockerExecOpts = {}
): [string, string[]] {
  const container = dockerContainer()
  if (container) {
    // Docker mode — ignore sudo (container is already root).
    const dockerArgs = ['exec']
    if (opts.interactive) dockerArgs.push('-i')
    dockerArgs.push(container, cmd, ...args)
    return ['docker', dockerArgs]
  }

  const distro = wslDistro()
  if (distro) {
    // WSL mode. `sudo` maps to running as root, which is passwordless from
    // Windows — cleaner than an in-distro `sudo` that may prompt. Args are
    // passed as an argv array (no shell), so no quoting/escaping is needed.
    const wslArgs = ['-d', distro]
    if (opts.sudo) wslArgs.push('-u', 'root')
    wslArgs.push('--', cmd, ...args)
    return ['wsl.exe', wslArgs]
  }

  // Host mode — preserve existing sudo behavior.
  if (opts.sudo) return ['sudo', [cmd, ...args]]
  return [cmd, args]
}

/**
 * Build the command used to probe for a binary's existence — used by the
 * tool-availability preflight. On the host that's `<bin> --version`; inside a
 * backend it's a `command -v <bin>` check, which is cheaper and doesn't pollute
 * the probe with --version output.
 */
export function rewriteProbe(bin: string): [string, string[]] {
  const container = dockerContainer()
  if (container) return ['docker', ['exec', container, 'sh', '-c', `command -v ${bin}`]]
  const distro = wslDistro()
  if (distro) return ['wsl.exe', ['-d', distro, '--', 'sh', '-lc', `command -v ${bin}`]]
  return [bin, ['--version']]
}

/** Human-readable label for banners. */
export function dockerLabel(): string {
  const c = dockerContainer()
  if (c) return `docker:${c}`
  const d = wslDistro()
  if (d) return `wsl:${d}`
  return 'host'
}

/**
 * List installed WSL distro names (Windows only, best-effort). WSL emits its
 * listing as UTF-16LE, so we decode accordingly and strip the header row.
 */
export async function listWslDistros(): Promise<string[]> {
  if (process.platform !== 'win32') return []
  return new Promise(resolve => {
    try {
      const p = spawn('wsl.exe', ['-l', '-q'])
      const chunks: Buffer[] = []
      p.stdout.on('data', (d: Buffer) => chunks.push(d))
      p.on('error', () => resolve([]))
      p.on('close', () => {
        const text = Buffer.concat(chunks).toString('utf16le')
        const names = text
          .split(/\r?\n/)
          .map(s => s.replace(/\0/g, '').trim())
          .filter(Boolean)
        resolve(names)
      })
    } catch {
      resolve([])
    }
  })
}

/**
 * On Windows with no explicit backend, auto-select an installed Kali WSL distro
 * and route tool spawns into it by setting OKAL_WSL_DISTRO. Returns the chosen
 * distro (or null if none/opt-out). Set OKAL_WSL_AUTO=0 to disable.
 */
export async function autoConfigureWslBackend(): Promise<string | null> {
  if (process.platform !== 'win32') return null
  if (isDockerMode() || wslDistro()) return null
  if (process.env.OKAL_WSL_AUTO === '0') return null

  const distros = await listWslDistros()
  // Prefer a Kali distro; that's the one guaranteed to carry the toolchain.
  const kali = distros.find(d => /kali/i.test(d))
  if (!kali) return null
  process.env.OKAL_WSL_DISTRO = kali
  return kali
}
