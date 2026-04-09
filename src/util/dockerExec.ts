/**
 * Docker-exec rewriter.
 *
 * When `OKAL_DOCKER_EXEC=<container>` is set, every security-tool invocation
 * is transparently rewritten to run inside the named container instead of
 * on the host. This lets a Windows/Mac user keep their normal shell and
 * still drive a full Kali toolchain — the host has no nmap/nikto/sqlmap,
 * but the container does.
 *
 * Usage inside a tool wrapper:
 *
 *   import { rewriteForDocker } from '../../../util/dockerExec.js'
 *   const [cmd, finalArgs] = rewriteForDocker('nmap', args, { sudo: input.sudo })
 *   const process = spawn(cmd, finalArgs)
 *
 * Design notes:
 *   - `sudo` is stripped in docker mode — containers default to root.
 *   - We pass `-T` (no TTY allocation) so spawned processes don't stall
 *     waiting for a terminal, and use stdin pass-through for tools like
 *     msfconsole that read a resource script off stdin.
 *   - Container must be already running (`docker run -d --name <container>`).
 *     We don't auto-start; that's the user's job.
 */

export interface DockerExecOpts {
  /** Whether the caller was going to sudo the command on the host. */
  sudo?: boolean
  /** Whether the child will need stdin (e.g. msfconsole -r -). */
  interactive?: boolean
}

/** Container name, or null if docker-exec mode is off. */
export function dockerContainer(): string | null {
  const v = process.env.OKAL_DOCKER_EXEC
  return v && v.trim() ? v.trim() : null
}

/** True iff OKAL_DOCKER_EXEC is set to a non-empty value. */
export function isDockerMode(): boolean {
  return dockerContainer() !== null
}

/**
 * Rewrite a (cmd, args) pair to run inside the configured container.
 * When docker mode is off, returns the inputs unchanged (plus sudo prefix
 * if requested), so call sites can use this unconditionally.
 */
export function rewriteForDocker(
  cmd: string,
  args: string[],
  opts: DockerExecOpts = {}
): [string, string[]] {
  const container = dockerContainer()
  if (!container) {
    // Host mode — preserve existing sudo behavior.
    if (opts.sudo) return ['sudo', [cmd, ...args]]
    return [cmd, args]
  }

  // Docker mode — ignore sudo (container is already root) and prepend
  // `docker exec [-i] <container>` to the command.
  const dockerArgs = ['exec']
  if (opts.interactive) dockerArgs.push('-i')
  dockerArgs.push(container, cmd, ...args)
  return ['docker', dockerArgs]
}

/**
 * Build the command used to probe for a binary's existence — used by the
 * tool-availability preflight. On the host that's `<bin> --version`; inside
 * docker it's `docker exec <container> which <bin>`, which is cheaper and
 * doesn't pollute the probe cache with --version output.
 */
export function rewriteProbe(bin: string): [string, string[]] {
  const container = dockerContainer()
  if (!container) return [bin, ['--version']]
  return ['docker', ['exec', container, 'sh', '-c', `command -v ${bin}`]]
}

/** Human-readable label for banners. */
export function dockerLabel(): string {
  const c = dockerContainer()
  return c ? `docker:${c}` : 'host'
}
