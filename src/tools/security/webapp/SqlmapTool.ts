/**
 * OpenKaliClaude - SQLMap Tool
 * Automated SQL injection detection and exploitation
 */

import { z } from 'zod'
import { spawn } from 'child_process'
import { rewriteForDocker } from '../../../util/dockerExec.js'
import { SecurityTool, createFinding } from '../base/SecurityTool.js'
import { TargetValidator } from '../base/TargetValidator.js'
import { SecurityReport, Finding, ToolProgress } from '../../../types/security.js'

const SqlmapInputSchema = z.object({
  target: z.string().describe('Target URL with parameters'),
  method: z.enum(['GET', 'POST']).default('GET'),
  data: z.string().optional().describe('POST data'),
  cookie: z.string().optional().describe('Cookie header'),
  headers: z.record(z.string()).optional().describe('Additional headers'),
  level: z.number().min(1).max(5).default(1).describe('Test level (1-5)'),
  risk: z.number().min(1).max(3).default(1).describe('Risk level (1-3)'),
  techniques: z.string().default('BEUSTQ').describe('SQLi techniques to test'),
  dbs: z.boolean().default(false).describe('Enumerate databases'),
  tables: z.boolean().default(false).describe('Enumerate tables'),
  columns: z.boolean().default(false).describe('Enumerate columns'),
  dump: z.boolean().default(false).describe('Dump database entries'),
  threads: z.number().min(1).max(10).default(1),
  timeout: z.number().default(30),
  dryRun: z.boolean().default(false)
})

const SqlmapOutputSchema = z.object({
  target: z.string(),
  vulnerable: z.boolean(),
  injectionPoints: z.array(z.object({
    parameter: z.string(),
    type: z.string(),
    title: z.string(),
    payload: z.string()
  })),
  databases: z.array(z.string()).optional(),
  tables: z.record(z.array(z.string())).optional(),
  scanInfo: z.object({
    startTime: z.string(),
    endTime: z.string(),
    testsPerformed: z.number()
  })
})

type SqlmapInput = z.infer<typeof SqlmapInputSchema>
type SqlmapOutput = z.infer<typeof SqlmapOutputSchema>

interface SqlmapProgress {
  stage: 'testing' | 'detecting' | 'enumerating' | 'complete'
  percent: number
  currentTest: string
  testsCompleted: number
  testsTotal: number
}

export class SqlmapTool extends SecurityTool<typeof SqlmapInputSchema, SqlmapOutput, SqlmapProgress> {
  name = 'SQLMap'
  aliases = ['sqlmap', 'sqli']
  description = 'Automated SQL injection and database takeover tool'
  inputSchema = SqlmapInputSchema
  
  config = {
    category: 'webapp' as const,
    permissionLevel: 'exploitation' as const,
    requiresSudo: false,
    isDestructive: true,
    legalWarnings: [
      'SQL injection testing can modify database contents',
      'Only test applications you have explicit written permission to assess',
      'Data extraction may violate privacy laws',
      'Use --dry-run first to see what would be tested'
    ],
    version: '1.7+',
    references: ['https://sqlmap.org/']
  }
  
  async execute(
    input: SqlmapInput,
    onProgress?: (progress: ToolProgress & { data?: SqlmapProgress }) => void
  ): Promise<SqlmapOutput> {
    const args = this.buildArgs(input)
    
    if (input.dryRun) {
      console.log(`[DRY RUN] sqlmap ${args.join(' ')}`)
      return this.getDryRunOutput(input)
    }
    
    return new Promise((resolve, reject) => {
      const [execCmd, execArgs] = rewriteForDocker('sqlmap', args)
      const process = spawn(execCmd, execArgs)
      process.on('error', (err: NodeJS.ErrnoException) => {
        reject(new Error(err.code === 'ENOENT'
          ? 'sqlmap is not installed (host) or docker container is not running.'
          : `failed to spawn sqlmap: ${err.message}`))
      })
      let output = ''
      let stderr = ''
      let progress: SqlmapProgress = {
        stage: 'testing',
        percent: 0,
        currentTest: '',
        testsCompleted: 0,
        testsTotal: 100
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
        // SQLMap returns 0 even when vulnerabilities found
        try {
          const parsed = this.parseOutput(output, input)
          resolve(parsed)
        } catch (e) {
          reject(new Error(`Failed to parse sqlmap output: ${e}`))
        }
      })
    })
  }
  
  private buildArgs(input: SqlmapInput): string[] {
    // Argument-injection guards
    TargetValidator.assertSafeArg(input.target, 'target')
    if (input.data) TargetValidator.assertSafeArg(input.data, 'data')
    if (input.cookie) TargetValidator.assertSafeArg(input.cookie, 'cookie')
    TargetValidator.assertSafeArg(input.techniques, 'techniques')
    if (input.headers) {
      for (const [k, v] of Object.entries(input.headers)) {
        TargetValidator.assertSafeArg(k, 'header name')
        TargetValidator.assertSafeArg(v, 'header value')
      }
    }

    const args: string[] = ['-u', input.target, '--batch']
    
    if (input.method === 'POST' && input.data) {
      args.push('--data', input.data)
    }
    
    if (input.cookie) {
      args.push('--cookie', input.cookie)
    }
    
    if (input.headers) {
      for (const [key, value] of Object.entries(input.headers)) {
        args.push('-H', `${key}: ${value}`)
      }
    }
    
    args.push('--level', input.level.toString())
    args.push('--risk', input.risk.toString())
    args.push('--technique', input.techniques)
    args.push('--threads', input.threads.toString())
    
    if (input.dbs) {
      args.push('--dbs')
    }
    
    if (input.tables) {
      args.push('--tables')
    }
    
    if (input.columns) {
      args.push('--columns')
    }
    
    if (input.dump) {
      args.push('--dump')
    }
    
    // Output format
    args.push('--output-dir', '/tmp/sqlmap-output')
    
    return args
  }
  
  private parseOutput(output: string, input: SqlmapInput): SqlmapOutput {
    const injectionPoints: SqlmapOutput['injectionPoints'] = []
    const databases: string[] = []
    
    // Parse injection points
    const injectionMatch = output.match(/Parameter: (.+?) \((.+?)\)\s+Type: (.+?)\s+Title: (.+?)\s+Payload: (.+)/g)
    if (injectionMatch) {
      for (const match of injectionMatch) {
        const parts = match.match(/Parameter: (.+?) \((.+?)\)\s+Type: (.+?)\s+Title: (.+?)\s+Payload: (.+)/)
        if (parts) {
          injectionPoints.push({
            parameter: parts[1].trim(),
            type: parts[3].trim(),
            title: parts[4].trim(),
            payload: parts[5].trim()
          })
        }
      }
    }
    
    // Parse databases if enumerated
    const dbMatch = output.match(/available databases \[(\d+)\]:([\s\S]*?)(?=\n\n|\Z)/)
    if (dbMatch) {
      const dbList = dbMatch[2].match(/\[\*\] (.+)/g)
      if (dbList) {
        databases.push(...dbList.map(db => db.replace(/\[\*\] /, '').trim()))
      }
    }
    
    return {
      target: input.target,
      vulnerable: injectionPoints.length > 0,
      injectionPoints,
      databases: databases.length > 0 ? databases : undefined,
      scanInfo: {
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        testsPerformed: injectionPoints.length
      }
    }
  }
  
  private parseProgress(
    data: string,
    progress: SqlmapProgress,
    onProgress?: (progress: ToolProgress & { data?: SqlmapProgress }) => void
  ): void {
    const lines = data.split('\n')
    
    for (const line of lines) {
      if (line.includes('testing')) {
        progress.currentTest = line.trim()
        progress.testsCompleted++
        progress.percent = Math.min(95, (progress.testsCompleted / progress.testsTotal) * 100)
      }
      if (line.includes('is vulnerable')) {
        progress.stage = 'detecting'
      }
      if (line.includes('fetching')) {
        progress.stage = 'enumerating'
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
  
  generateReport(output: SqlmapOutput): SecurityReport {
    const findings: Finding[] = []
    
    if (output.vulnerable) {
      for (const injection of output.injectionPoints) {
        findings.push(createFinding(
          `SQL Injection: ${injection.title}`,
          `Parameter '${injection.parameter}' is vulnerable to ${injection.type} SQL injection`,
          'critical',
          'SQL Injection',
          {
            evidence: `Payload: ${injection.payload}`,
            remediation: 'Use parameterized queries/prepared statements. Validate and sanitize all user input.',
            references: [
              'https://owasp.org/www-community/attacks/SQL_Injection',
              'https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html'
            ]
          }
        ))
      }
    }
    
    if (output.databases && output.databases.length > 0) {
      findings.push(createFinding(
        'Database Enumeration Successful',
        `Successfully enumerated ${output.databases.length} database(s): ${output.databases.join(', ')}`,
        'high',
        'Information Disclosure',
        {
          remediation: 'Restrict database user privileges. Use least privilege principle.'
        }
      ))
    }
    
    return this.reportGenerator.generate(findings, {
      title: `SQLMap Results for ${output.target}`
    })
  }
  
  protected calculateRiskScore(input: SqlmapInput): number {
    let score = 8 // High base score for SQL injection testing
    
    if (input.dump) score += 2
    if (input.risk >= 2) score += 1
    if (input.level >= 3) score += 1
    
    return Math.min(10, score)
  }
  
  protected estimateImpact(input: SqlmapInput): string {
    if (input.dump) {
      return 'Critical - May extract sensitive data from database'
    }
    if (input.dbs || input.tables) {
      return 'High - May enumerate database structure'
    }
    return 'High - May confirm and exploit SQL injection vulnerabilities'
  }
  
  private getDryRunOutput(input: SqlmapInput): SqlmapOutput {
    return {
      target: input.target,
      vulnerable: false,
      injectionPoints: [],
      scanInfo: {
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        testsPerformed: 0
      }
    }
  }
}

export const sqlmapTool = new SqlmapTool()
