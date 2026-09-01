/**
 * OpenKaliClaude — Kali Catalog (discovery)
 *
 * A read-only companion to `KaliTool`. It lets the agent discover which Kali
 * tools exist and, crucially, *how to use them* — categories, purpose, and
 * concrete example command lines — without every tool's schema having to live
 * permanently in the system prompt. The model queries this on demand, then
 * runs the chosen tool via the `kali` runner.
 *
 * It never executes anything, so it takes no target and needs no scope check.
 */

import { z } from 'zod'
import { SecurityTool, createFinding } from '../base/SecurityTool.js'
import {
  SecurityReport,
  Finding,
  ToolUseContext,
  PermissionResult,
  SecurityToolConfig,
} from '../../../types/security.js'
import {
  KALI_CATEGORIES,
  KaliCategory,
  findTool,
  searchCatalog,
  toolsInCategory,
  catalogBinaries,
  KaliToolSpec,
} from './catalog.js'
import { probeInstalledBinaries } from '../../../util/toolInstalled.js'
import { dockerLabel } from '../../../util/dockerExec.js'

const KaliCatalogInputSchema = z.object({
  action: z.enum(['list-categories', 'list', 'search', 'detail']).default('list-categories')
    .describe('list-categories: all categories with counts. list: tools in a category. search: free-text. detail: full usage for one tool.'),
  category: z.string().optional().describe('Category name for the "list" action (e.g. "web-application").'),
  query: z.string().optional().describe('Search text for the "search" action.'),
  tool: z.string().optional().describe('Binary name for the "detail" action (e.g. "hydra").'),
})

type KaliCatalogInput = z.infer<typeof KaliCatalogInputSchema>

export interface KaliCatalogOutput {
  action: string
  categories?: Array<{ category: string; count: number; installed: number; tools: string[] }>
  tools?: Array<Pick<KaliToolSpec, 'binary' | 'name' | 'category' | 'permission' | 'summary'> & { destructive: boolean; installed?: boolean }>
  detail?: KaliToolSpec & { installed?: boolean }
  /** How install state was resolved. false → unknown (no POSIX backend to probe). */
  installStateKnown?: boolean
  backend?: string
  message?: string
}

export class KaliCatalogTool extends SecurityTool<typeof KaliCatalogInputSchema, KaliCatalogOutput> {
  name = 'Kali Catalog'
  aliases = ['kali_catalog', 'kali-catalog', 'kali-list', 'tools']
  description =
    'Discover Kali Linux tools and how to use them. Actions: list-categories, list (by category), ' +
    'search (free text), detail (full usage + examples for one tool). Read-only — pair it with the ' +
    '"kali" runner to actually execute a tool.'
  inputSchema = KaliCatalogInputSchema

  config: SecurityToolConfig = {
    category: 'reconnaissance',
    permissionLevel: 'passive-recon',
    requiresSudo: false,
    isDestructive: false,
    legalWarnings: [],
    version: '1.0.0',
    references: ['https://www.kali.org/tools/'],
  }

  async execute(input: KaliCatalogInput): Promise<KaliCatalogOutput> {
    // Resolve real install state up front so every action can report which
    // catalogued tools are actually present in the active backend. Best-effort:
    // `installed` stays undefined when the backend can't be probed.
    const installed = await probeInstalledBinaries(Array.from(catalogBinaries()))
    const known = installed !== null
    const isInstalled = (bin: string): boolean | undefined =>
      installed ? installed.has(bin.toLowerCase()) : undefined
    const meta = { installStateKnown: known, backend: dockerLabel() }

    switch (input.action) {
      case 'list-categories':
        return {
          action: input.action,
          ...meta,
          categories: KALI_CATEGORIES.map(cat => {
            const tools = toolsInCategory(cat)
            const bins = Array.from(new Set(tools.map(t => t.binary)))
            const installedCount = installed ? bins.filter(b => installed.has(b.toLowerCase())).length : 0
            return { category: cat, count: bins.length, installed: installedCount, tools: bins }
          }),
          message: known
            ? undefined
            : 'Install state unknown (no POSIX backend to probe) — counts show catalogued tools only.',
        }

      case 'list': {
        const cat = (input.category || '').trim().toLowerCase() as KaliCategory
        if (!KALI_CATEGORIES.includes(cat)) {
          return { action: input.action, ...meta, message: `Unknown category '${input.category}'. Valid: ${KALI_CATEGORIES.join(', ')}` }
        }
        return { action: input.action, ...meta, tools: this.summaries(toolsInCategory(cat), isInstalled) }
      }

      case 'search': {
        const hits = searchCatalog(input.query || '')
        return {
          action: input.action,
          ...meta,
          tools: this.summaries(hits, isInstalled),
          message: hits.length ? undefined : `No tools matched '${input.query}'.`,
        }
      }

      case 'detail': {
        const spec = input.tool ? findTool(input.tool) : undefined
        if (!spec) {
          return { action: input.action, ...meta, message: `'${input.tool}' is not catalogued. Try the search action, or run it anyway via the kali tool.` }
        }
        return { action: input.action, ...meta, detail: { ...spec, installed: isInstalled(spec.binary) } }
      }

      default:
        return { action: input.action, ...meta, message: 'Unknown action.' }
    }
  }

  private summaries(
    specs: KaliToolSpec[],
    isInstalled: (bin: string) => boolean | undefined
  ): KaliCatalogOutput['tools'] {
    // De-dup by binary (some binaries appear under multiple categories).
    const seen = new Set<string>()
    const out: NonNullable<KaliCatalogOutput['tools']> = []
    for (const t of specs) {
      if (seen.has(t.binary)) continue
      seen.add(t.binary)
      out.push({
        binary: t.binary, name: t.name, category: t.category,
        permission: t.permission, summary: t.summary, destructive: !!t.destructive,
        installed: isInstalled(t.binary),
      })
    }
    return out
  }

  async validatePermissions(_input: KaliCatalogInput, _context: ToolUseContext): Promise<PermissionResult> {
    return { granted: true, requiresConfirmation: false, riskScore: 0 }
  }

  generateReport(output: KaliCatalogOutput): SecurityReport {
    const findings: Finding[] = [createFinding(
      `Catalog: ${output.action}`,
      output.message || `Returned catalog data for action '${output.action}'.`,
      'info', 'Reconnaissance')]
    return this.reportGenerator.generate(findings, { title: 'Kali catalog lookup' })
  }

  protected calculateRiskScore(): number {
    return 0
  }

  protected estimateImpact(): string {
    return 'None — read-only catalog lookup.'
  }
}

export const kaliCatalogTool = new KaliCatalogTool()
