/**
 * OpenKaliClaude — Kali Universal Runner
 *
 * A single SecurityTool that can execute *any* Kali Linux tool, rather than
 * requiring a hand-written TypeScript wrapper per binary. This is the
 * execution half of the "use all Kali tools" protocol; `catalog.ts` is the
 * knowledge half and `KaliCatalogTool` is the discovery half.
 *
 * Safety model (same guarantees as the purpose-built tools):
 *   - Binary allow-listing. By default only catalogued binaries — or binaries
 *     actually present on the host/container — may run, so the model can't turn
 *     this into an arbitrary shell. Set OKAL_KALI_ALLOW_ANY=1 to lift the
 *     allow-list (still name-guarded) for power users on a dedicated box.
 *   - No shell. Commands run via spawn() with an argv array — there is no shell
 *     interpretation, so metacharacters in args are inert. Args are still
 *     scanned for NUL / newline control characters.
 *   - Scope enforcement. If a `target` is supplied it is validated against the
 *     session ScopeConstraint exactly like every other SecurityTool.
 *   - Risk + confirmation. Derived from the catalogue entry's permission level
 *     and destructiveness; destructive/high-risk runs demand confirmation.
 *   - Docker / sudo rewrite + audit, inherited from the shared utilities.
 */

import { z } from 'zod'
import { SecurityTool, createFinding } from '../base/SecurityTool.js'
import { TargetValidator } from '../base/TargetValidator.js'
import { safeSpawn } from '../../../util/safeSpawn.js'
import { rewriteForDocker } from '../../../util/dockerExec.js'
import { emitExec } from '../../../util/commandLog.js'
import {
  SecurityReport,
  ToolProgress,
  Finding,
  ToolUseContext,
  PermissionResult,
  SecurityToolConfig,
} from '../../../types/security.js'
import { findTool, catalogBinaries, PERMISSION_RISK, KaliToolSpec } from './catalog.js'

const MAX_TIMEOUT_MS = 30 * 60 * 1000  // 30 min hard ceiling
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000

const KaliInputSchema = z.object({
  tool: z.string().min(1).describe('Kali binary to run, e.g. "nmap", "gobuster", "hydra". Use kali_catalog to discover options and usage.'),
  args: z.array(z.string()).default([]).describe('Argument list, one element per token (do NOT include the binary name). Flags are allowed, e.g. ["-sV","--top-ports","100"].'),
  target: z.string().optional().describe('Primary target (IP/host/CIDR/URL). When set it is scope-validated. Also pass it inside args where the tool expects it.'),
  stdin: z.string().optional().describe('Optional data to write to the tool stdin (e.g. a resource script for msfconsole -r -).'),
  timeoutMs: z.number().int().min(1000).max(MAX_TIMEOUT_MS).optional().describe('Kill the process after this many ms (default 5 min, max 30 min).'),
  sudo: z.boolean().default(false).describe('Run under sudo on the host (ignored in docker mode — containers run as root).'),
  dryRun: z.boolean().default(false).describe('Show the exact command that would run without executing it.'),
})

type KaliInput = z.infer<typeof KaliInputSchema>

export interface KaliOutput {
  tool: string
  command: string
  executed: boolean
  exitCode: number | null
  timedOut: boolean
  stdout: string
  stderr: string
  spec?: {
    name: string
    category: string
    permission: string
    summary: string
    destructive: boolean
  }
}

interface KaliProgress {
  stage: 'starting' | 'running' | 'complete'
  bytesOut: number
}

// Obvious non-security system binaries we refuse to proxy even when the
// allow-any escape hatch is on — these are footguns, not pentest tools.
const HARD_DENY = new Set([
  'rm', 'dd', 'mkfs', 'shutdown', 'reboot', 'halt', 'poweroff',
  'passwd', 'useradd', 'userdel', 'chown', 'chmod', ':', 'fork',
])

function normBin(id: string): string {
  const base = id.split(/[/\\]/).pop() || id
  return base.trim().toLowerCase()
}

export class KaliTool extends SecurityTool<typeof KaliInputSchema, KaliOutput, KaliProgress> {
  name = 'Kali'
  aliases = ['kali', 'run-tool', 'kali-run']
  description =
    'Universal Kali Linux tool runner: execute ANY Kali tool by name with an argument list. ' +
    'Covers reconnaissance, scanning, web, wireless, password, exploitation, forensics and more. ' +
    'Use the kali_catalog tool first to look up the exact binary, flags, and example usage.'
  inputSchema = KaliInputSchema

  config: SecurityToolConfig = {
    category: 'network',
    permissionLevel: 'active-recon',
    requiresSudo: false,
    isDestructive: false,
    legalWarnings: [
      'Only run tools against systems you are explicitly authorized to test.',
      'Many Kali tools are intrusive or destructive — confirm scope and impact first.',
      'Some tools require elevated privileges (sudo) or a wireless monitor interface.',
    ],
    version: '1.0.0',
    references: ['https://www.kali.org/tools/'],
  }

  private allowAny(): boolean {
    return process.env.OKAL_KALI_ALLOW_ANY === '1'
  }

  /** Decide whether a binary may be executed and why not, if refused. */
  private gateBinary(tool: string): { ok: true; spec?: KaliToolSpec } | { ok: false; reason: string } {
    const bin = normBin(tool)
    if (HARD_DENY.has(bin)) {
      return { ok: false, reason: `'${tool}' is a system/administration command and is blocked by the Kali runner.` }
    }
    const spec = findTool(tool)
    if (spec) return { ok: true, spec }
    if (this.allowAny()) return { ok: true }
    if (catalogBinaries().has(bin)) return { ok: true }
    return {
      ok: false,
      reason:
        `'${tool}' is not in the OpenKaliClaude tool catalog. Use kali_catalog to find the right tool, ` +
        `or set OKAL_KALI_ALLOW_ANY=1 to run any binary present on this host.`,
    }
  }

  async execute(
    input: KaliInput,
    onProgress?: (progress: ToolProgress & { data?: KaliProgress }) => void
  ): Promise<KaliOutput> {
    const gate = this.gateBinary(input.tool)
    if (!gate.ok) throw new Error(gate.reason)
    const spec = gate.ok ? gate.spec : undefined

    // Argument-injection guard: no NUL / newline control chars in any token.
    // We deliberately allow leading '-' here (flags are legitimate) because
    // execution is via argv (no shell), so flag injection is the tool's own
    // concern, not a shell-escape risk.
    for (const a of input.args) {
      if (/[\r\n\0]/.test(a)) {
        throw new Error('Argument contains control characters (newline/NUL) and was rejected.')
      }
    }
    TargetValidator.assertSafeArg(input.tool, 'tool')

    const bin = normBin(input.tool)
    const specOut = spec && {
      name: spec.name,
      category: spec.category,
      permission: spec.permission,
      summary: spec.summary,
      destructive: !!spec.destructive,
    }

    const [execCmd, execArgs] = rewriteForDocker(bin, input.args, { sudo: input.sudo, interactive: !!input.stdin })
    const commandStr = [execCmd, ...execArgs].join(' ')

    // Show the fully-resolved command line to the operator's command view.
    emitExec(bin, commandStr, input.dryRun)

    if (input.dryRun) {
      return {
        tool: bin, command: commandStr, executed: false,
        exitCode: null, timedOut: false, stdout: '', stderr: '', spec: specOut,
      }
    }

    onProgress?.({ stage: 'starting', percent: 0, message: `spawning ${bin}`, data: { stage: 'starting', bytesOut: 0 } })

    const { child, spawned } = safeSpawn(execCmd, execArgs)
    await spawned  // rejects with a friendly ENOENT message if the binary is missing

    return await new Promise<KaliOutput>((resolve, reject) => {
      let stdout = ''
      let stderr = ''
      let timedOut = false
      const limit = 2 * 1024 * 1024  // cap captured output at 2 MB each stream

      const timeout = setTimeout(() => {
        timedOut = true
        child.kill('SIGKILL')
      }, input.timeoutMs ?? DEFAULT_TIMEOUT_MS)

      if (input.stdin) {
        child.stdin.write(input.stdin)
        child.stdin.end()
      }

      child.stdout.on('data', (d: Buffer) => {
        if (stdout.length < limit) stdout += d.toString()
        onProgress?.({ stage: 'running', percent: 50, data: { stage: 'running', bytesOut: stdout.length } })
      })
      child.stderr.on('data', (d: Buffer) => {
        if (stderr.length < limit) stderr += d.toString()
      })
      child.on('error', (err) => {
        clearTimeout(timeout)
        reject(err)
      })
      child.on('close', (code) => {
        clearTimeout(timeout)
        onProgress?.({ stage: 'complete', percent: 100, data: { stage: 'complete', bytesOut: stdout.length } })
        resolve({
          tool: bin,
          command: commandStr,
          executed: true,
          exitCode: code,
          timedOut,
          stdout: stdout.slice(0, limit),
          stderr: stderr.slice(0, limit),
          spec: specOut,
        })
      })
    })
  }

  async validatePermissions(input: KaliInput, context: ToolUseContext): Promise<PermissionResult> {
    if (context.dryRun || input.dryRun) {
      return { granted: true, reason: 'Dry run — no execution', requiresConfirmation: false }
    }

    const gate = this.gateBinary(input.tool)
    if (!gate.ok) {
      return { granted: false, reason: gate.reason, riskScore: 10 }
    }

    // Scope-check an explicit target, matching the other SecurityTools.
    if (input.target) {
      await this.validateTarget(input.target, context)
    }

    const riskScore = this.calculateRiskScore(input)
    const spec = gate.ok ? gate.spec : undefined
    const destructive = !!spec?.destructive

    return {
      granted: true,
      requiresConfirmation: destructive || riskScore >= 7,
      riskScore,
      estimatedImpact: this.estimateImpact(input),
      confirmationMessage: `Run '${input.tool} ${input.args.join(' ')}'` +
        (input.target ? ` against ${input.target}` : '') +
        `? (risk ${riskScore}/10${destructive ? ', DESTRUCTIVE' : ''})`,
    }
  }

  generateReport(output: KaliOutput): SecurityReport {
    const findings: Finding[] = []

    if (!output.executed) {
      findings.push(createFinding(
        `Dry run: ${output.tool}`,
        `Command previewed but not executed: ${output.command}`,
        'info', 'Execution', { evidence: output.command }))
      return this.reportGenerator.generate(findings, { title: `Kali dry run — ${output.tool}` })
    }

    const ok = output.exitCode === 0 && !output.timedOut
    findings.push(createFinding(
      `${output.tool} ${ok ? 'completed' : output.timedOut ? 'timed out' : `exited ${output.exitCode}`}`,
      output.spec?.summary || `Ran ${output.command}`,
      ok ? 'info' : 'low',
      output.spec?.category || 'Execution',
      {
        evidence: (output.stdout || output.stderr || '').slice(0, 4000),
        remediation: output.timedOut
          ? 'The tool exceeded the timeout; narrow the scope or raise timeoutMs.'
          : undefined,
      }))

    return this.reportGenerator.generate(findings, { title: `Kali run — ${output.tool}` })
  }

  protected calculateRiskScore(input: KaliInput): number {
    const spec = findTool(input.tool)
    let score = spec ? PERMISSION_RISK[spec.permission] : 5
    if (spec?.destructive) score += 1
    if (input.sudo) score += 1
    return Math.min(10, score)
  }

  protected estimateImpact(input: KaliInput): string {
    const spec = findTool(input.tool)
    if (!spec) return 'Unknown — binary not catalogued.'
    const base = `${spec.category} / ${spec.permission}`
    return spec.destructive ? `${base} — DESTRUCTIVE, may alter or disrupt the target.` : base
  }
}

export const kaliTool = new KaliTool()
