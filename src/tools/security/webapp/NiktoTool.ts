/**
 * OpenKaliClaude - Nikto Tool
 * Web vulnerability scanner integration
 */

import { z } from 'zod'
import { spawn } from 'child_process'
import { SecurityTool, createFinding } from '../base/SecurityTool.js'
import { TargetValidator } from '../base/TargetValidator.js'
import { SecurityReport, Finding, ToolProgress } from '../../../types/security.js'

const NiktoInputSchema = z.object({
  target: z.string().describe('Target URL or host'),
  port: z.number().default(80),
  ssl: z.boolean().default(false),
  plugins: z.array(z.string()).optional().describe('Plugins to enable'),
  tuning: z.string().optional().describe('Scan tuning (1-9)'),
  mutate: z.boolean().default(false).describe('Enable mutation tests'),
  cgidirs: z.array(z.string()).optional().describe('CGI directories to scan'),
  maxTime: z.string().optional().describe('Maximum scan time'),
  outputFormat: z.enum(['txt', 'html', 'csv', 'xml', 'json']).default('json'),
  dryRun: z.boolean().default(false)
})

const NiktoOutputSchema = z.object({
  host: z.string(),
  port: z.number(),
  ssl: z.boolean(),
  findings: z.array(z.object({
    id: z.string(),
    method: z.string(),
    url: z.string(),
    message: z.string(),
    severity: z.enum(['info', 'low', 'medium', 'high', 'critical'])
  })),
  scanInfo: z.object({
    startTime: z.string(),
    endTime: z.string(),
    totalChecks: z.number(),
    itemsFound: z.number()
  })
})

type NiktoInput = z.infer<typeof NiktoInputSchema>
type NiktoOutput = z.infer<typeof NiktoOutputSchema>

interface NiktoProgress {
  stage: 'connecting' | 'scanning' | 'analyzing' | 'complete'
  percent: number
  currentCheck: string
  itemsFound: number
}

export class NiktoTool extends SecurityTool<typeof NiktoInputSchema, NiktoOutput, NiktoProgress> {
  name = 'Nikto'
  aliases = ['nikto', 'webscan']
  description = 'Web server vulnerability scanner - detects dangerous files, outdated software, and misconfigurations'
  inputSchema = NiktoInputSchema
  
  config = {
    category: 'webapp' as const,
    permissionLevel: 'web-scanning' as const,
    requiresSudo: false,
    isDestructive: false,
    legalWarnings: [
      'Only scan web applications you have explicit permission to test',
      'Web scanning may trigger WAF/IPS systems',
      'Some tests may modify application state'
    ],
    version: '2.5.0+',
    references: ['https://cirt.net/Nikto2']
  }
  
  async execute(
    input: NiktoInput,
    onProgress?: (progress: ToolProgress & { data?: NiktoProgress }) => void
  ): Promise<NiktoOutput> {
    const args = this.buildArgs(input)
    
    if (input.dryRun) {
      console.log(`[DRY RUN] nikto ${args.join(' ')}`)
      return this.getDryRunOutput(input)
    }
    
    return new Promise((resolve, reject) => {
      const process = spawn('nikto', args)
      process.on('error', (err: NodeJS.ErrnoException) => {
        reject(new Error(err.code === 'ENOENT'
          ? 'nikto is not installed on this host.'
          : `failed to spawn nikto: ${err.message}`))
      })
      let output = ''
      let stderr = ''
      let progress: NiktoProgress = {
        stage: 'connecting',
        percent: 0,
        currentCheck: '',
        itemsFound: 0
      }
      
      process.stdout.on('data', (data) => {
        const chunk = data.toString()
        output += chunk
        this.parseProgress(chunk, progress, onProgress)
      })
      
      process.stderr.on('data', (data) => {
        stderr += data.toString()
      })
      
      process.on('close', (code) => {
        if (code !== 0 && code !== null) {
          reject(new Error(`nikto exited with code ${code}: ${stderr}`))
        } else {
          try {
            const parsed = this.parseOutput(output, input)
            resolve(parsed)
          } catch (e) {
            reject(new Error(`Failed to parse nikto output: ${e}`))
          }
        }
      })
    })
  }
  
  private buildArgs(input: NiktoInput): string[] {
    // Argument-injection guards
    TargetValidator.assertSafeArg(input.target, 'target')
    if (input.tuning) TargetValidator.assertSafeArg(input.tuning, 'tuning')
    if (input.maxTime) TargetValidator.assertSafeArg(input.maxTime, 'maxTime')
    if (input.plugins) input.plugins.forEach(p => TargetValidator.assertSafeArg(p, 'plugins'))
    if (input.cgidirs) input.cgidirs.forEach(c => TargetValidator.assertSafeArg(c, 'cgidirs'))

    const args: string[] = ['-h', input.target]
    
    if (input.port !== 80 && input.port !== 443) {
      args.push('-p', input.port.toString())
    }
    
    if (input.ssl) {
      args.push('-ssl')
    }
    
    if (input.plugins && input.plugins.length > 0) {
      args.push('-Plugin', input.plugins.join(','))
    }
    
    if (input.tuning) {
      args.push('-Tuning', input.tuning)
    }
    
    if (input.mutate) {
      args.push('-mutate', '1')
    }
    
    if (input.cgidirs && input.cgidirs.length > 0) {
      args.push('-Cgidirs', input.cgidirs.join(','))
    }
    
    if (input.maxTime) {
      args.push('-maxtime', input.maxTime)
    }
    
    // Output format
    args.push('-Format', input.outputFormat)
    
    return args
  }
  
  private parseOutput(output: string, input: NiktoInput): NiktoOutput {
    const findings: NiktoOutput['findings'] = []
    const lines = output.split('\n')
    
    // Parse Nikto's standard output format
    for (const line of lines) {
      // Match pattern: + /path - Message
      const match = line.match(/^\+\s+(.+?)\s+-\s+(.+)$/)
      if (match) {
        const [, url, message] = match
        findings.push({
          id: `NIKTO-${findings.length + 1}`,
          method: 'GET',
          url: url.trim(),
          message: message.trim(),
          severity: this.inferSeverity(message)
        })
      }
    }
    
    return {
      host: input.target,
      port: input.port,
      ssl: input.ssl,
      findings,
      scanInfo: {
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        totalChecks: findings.length,
        itemsFound: findings.length
      }
    }
  }
  
  private inferSeverity(message: string): Finding['severity'] {
    const lower = message.toLowerCase()
    
    if (lower.includes('sql injection') || lower.includes('rce') || lower.includes('remote code')) {
      return 'critical'
    }
    if (lower.includes('xss') || lower.includes('cross-site') || lower.includes('csrf')) {
      return 'high'
    }
    if (lower.includes('information disclosure') || lower.includes('verbose')) {
      return 'medium'
    }
    if (lower.includes('outdated') || lower.includes('deprecated')) {
      return 'low'
    }
    
    return 'info'
  }
  
  private parseProgress(
    data: string,
    progress: NiktoProgress,
    onProgress?: (progress: ToolProgress & { data?: NiktoProgress }) => void
  ): void {
    const lines = data.split('\n')
    
    for (const line of lines) {
      if (line.includes('Target IP:')) {
        progress.stage = 'scanning'
        progress.percent = 10
      }
      if (line.includes('+')) {
        progress.itemsFound++
        progress.percent = Math.min(95, progress.percent + 2)
      }
      if (line.includes('Scan completed')) {
        progress.stage = 'complete'
        progress.percent = 100
      }
      
      if (onProgress) {
        onProgress({
          stage: progress.stage,
          percent: progress.percent,
          message: line.trim(),
          data: progress
        })
      }
    }
  }
  
  generateReport(output: NiktoOutput): SecurityReport {
    const findings: Finding[] = output.findings.map(f => 
      createFinding(
        f.message,
        `Found at: ${f.url}`,
        f.severity,
        'Web Application',
        {
          evidence: `Method: ${f.method}`,
          remediation: this.getRemediation(f.message)
        }
      )
    )
    
    return this.reportGenerator.generate(findings, {
      title: `Nikto Web Scan Results for ${output.host}:${output.port}`
    })
  }
  
  private getRemediation(message: string): string | undefined {
    const lower = message.toLowerCase()
    
    if (lower.includes('outdated')) {
      return 'Update the software to the latest version'
    }
    if (lower.includes('information disclosure')) {
      return 'Remove or restrict access to files that leak sensitive information'
    }
    if (lower.includes('xss')) {
      return 'Implement proper input validation and output encoding'
    }
    if (lower.includes('sql injection')) {
      return 'Use parameterized queries and prepared statements'
    }
    
    return undefined
  }
  
  protected calculateRiskScore(input: NiktoInput): number {
    let score = 4 // Base score for web scanning
    
    if (input.mutate) score += 2
    if (input.plugins?.includes('all')) score += 1
    
    return Math.min(10, score)
  }
  
  protected estimateImpact(input: NiktoInput): string {
    return 'Moderate - May generate significant HTTP traffic and trigger security systems'
  }
  
  private getDryRunOutput(input: NiktoInput): NiktoOutput {
    return {
      host: input.target,
      port: input.port,
      ssl: input.ssl,
      findings: [],
      scanInfo: {
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        totalChecks: 0,
        itemsFound: 0
      }
    }
  }
}

export const niktoTool = new NiktoTool()
