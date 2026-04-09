/**
 * OpenKaliClaude - Hashcat Tool
 * GPU-accelerated password hash cracker
 */

import { z } from 'zod'
import { spawn } from 'child_process'
import { SecurityTool, createFinding } from '../base/SecurityTool.js'
import { TargetValidator } from '../base/TargetValidator.js'
import { SecurityReport, Finding, ToolProgress } from '../../../types/security.js'

const HashcatInputSchema = z.object({
  hashFile: z.string().describe('Path to file containing hashes'),
  hashType: z.number().describe('Hash type code (e.g., 0 for MD5, 100 for SHA1)'),
  attackMode: z.enum([
    'straight',      // 0 - Dictionary attack
    'combination',   // 1 - Combination attack
    'brute-force',   // 3 - Brute force/mask attack
    'hybrid-wordlist', // 6 - Hybrid wordlist + mask
    'hybrid-mask'    // 7 - Hybrid mask + wordlist
  ]).default('straight'),
  wordlist: z.string().optional().describe('Path to wordlist file'),
  mask: z.string().optional().describe('Mask for brute force attack'),
  rules: z.array(z.string()).optional().describe('Rules to apply'),
  minLength: z.number().optional(),
  maxLength: z.number().optional(),
  charset: z.string().optional(),
  outputFile: z.string().optional(),
  show: z.boolean().default(false).describe('Show cracked hashes only'),
  force: z.boolean().default(false).describe('Force execution'),
  dryRun: z.boolean().default(false)
})

const HashcatOutputSchema = z.object({
  hashesProcessed: z.number(),
  hashesCracked: z.number(),
  crackedPasswords: z.array(z.object({
    hash: z.string(),
    password: z.string(),
    hashType: z.number()
  })),
  performance: z.object({
    speed: z.string(),
    timeElapsed: z.string(),
    estimatedTimeRemaining: z.string().optional()
  }),
  scanInfo: z.object({
    startTime: z.string(),
    endTime: z.string(),
    attackMode: z.string()
  })
})

type HashcatInput = z.infer<typeof HashcatInputSchema>
type HashcatOutput = z.infer<typeof HashcatOutputSchema>

interface HashcatProgress {
  stage: 'initializing' | 'running' | 'cracking' | 'complete'
  percent: number
  speed: string
  hashesProcessed: number
  hashesCracked: number
  estimatedTimeRemaining: string
}

export class HashcatTool extends SecurityTool<typeof HashcatInputSchema, HashcatOutput, HashcatProgress> {
  name = 'Hashcat'
  aliases = ['hashcat', 'password-cracker']
  description = 'World\'s fastest password cracker with GPU acceleration'
  inputSchema = HashcatInputSchema
  
  config = {
    category: 'crypto' as const,
    permissionLevel: 'brute-force' as const,
    requiresSudo: false,
    isDestructive: false,
    legalWarnings: [
      'Only crack hashes you have legal authorization to crack',
      'Cracking passwords without permission is illegal',
      'Ensure you have proper authorization before proceeding',
      'GPU cracking may trigger power management alerts'
    ],
    version: '6.2.6+',
    references: ['https://hashcat.net/hashcat/']
  }
  
  private attackModeCodes: Record<string, number> = {
    'straight': 0,
    'combination': 1,
    'brute-force': 3,
    'hybrid-wordlist': 6,
    'hybrid-mask': 7
  }
  
  async execute(
    input: HashcatInput,
    onProgress?: (progress: ToolProgress & { data?: HashcatProgress }) => void
  ): Promise<HashcatOutput> {
    const args = this.buildArgs(input)
    
    if (input.dryRun) {
      console.log(`[DRY RUN] hashcat ${args.join(' ')}`)
      return this.getDryRunOutput(input)
    }
    
    return new Promise((resolve, reject) => {
      const process = spawn('hashcat', args)
      process.on('error', (err: NodeJS.ErrnoException) => {
        reject(new Error(err.code === 'ENOENT'
          ? 'hashcat is not installed on this host.'
          : `failed to spawn hashcat: ${err.message}`))
      })
      let output = ''
      let stderr = ''
      let progress: HashcatProgress = {
        stage: 'initializing',
        percent: 0,
        speed: '',
        hashesProcessed: 0,
        hashesCracked: 0,
        estimatedTimeRemaining: ''
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
        // Hashcat may exit with various codes
        try {
          const parsed = this.parseOutput(output, input)
          resolve(parsed)
        } catch (e) {
          reject(new Error(`Failed to parse hashcat output: ${e}`))
        }
      })
    })
  }
  
  private buildArgs(input: HashcatInput): string[] {
    // Argument-injection guards: any user-supplied path/string that would
    // otherwise land at a positional slot must not look like a flag.
    TargetValidator.assertSafeArg(input.hashFile, 'hashFile')
    if (input.wordlist) TargetValidator.assertSafeArg(input.wordlist, 'wordlist')
    if (input.mask) TargetValidator.assertSafeArg(input.mask, 'mask')
    if (input.outputFile) TargetValidator.assertSafeArg(input.outputFile, 'outputFile')
    if (input.charset) TargetValidator.assertSafeArg(input.charset, 'charset')
    if (input.rules) input.rules.forEach(r => TargetValidator.assertSafeArg(r, 'rules'))

    const args: string[] = ['-m', input.hashType.toString()]
    
    // Attack mode
    args.push('-a', this.attackModeCodes[input.attackMode].toString())
    
    // Input hash file
    args.push(input.hashFile)
    
    // Wordlist or mask
    if (input.wordlist) {
      args.push(input.wordlist)
    }
    if (input.mask) {
      args.push(input.mask)
    }
    
    // Rules
    if (input.rules && input.rules.length > 0) {
      for (const rule of input.rules) {
        args.push('-r', rule)
      }
    }
    
    // Length constraints
    if (input.minLength !== undefined) {
      args.push('--increment-min', input.minLength.toString())
    }
    if (input.maxLength !== undefined) {
      args.push('--increment-max', input.maxLength.toString())
    }
    
    // Custom charset
    if (input.charset) {
      args.push('-1', input.charset)
    }
    
    // Output file
    if (input.outputFile) {
      args.push('-o', input.outputFile)
    }
    
    // Show mode
    if (input.show) {
      args.push('--show')
    }
    
    // Force
    if (input.force) {
      args.push('--force')
    }
    
    // Output format
    args.push('--outfile-format', '2')
    args.push('--status')
    args.push('--status-timer', '1')
    
    return args
  }
  
  private parseOutput(output: string, input: HashcatInput): HashcatOutput {
    const crackedPasswords: HashcatOutput['crackedPasswords'] = []
    
    // Parse cracked passwords
    const lines = output.split('\n')
    for (const line of lines) {
      // Match pattern: hash:password
      const match = line.match(/^([a-f0-9]+):(.*)$/i)
      if (match) {
        crackedPasswords.push({
          hash: match[1],
          password: match[2],
          hashType: input.hashType
        })
      }
    }
    
    // Parse performance stats
    const speedMatch = output.match(/Speed\.\#\d+\.\.\.\.\s+(\S+)/)
    const timeMatch = output.match(/Time\.Estimated\.\.\.\.\s+(\S+)/)
    
    return {
      hashesProcessed: crackedPasswords.length * 10, // Estimate
      hashesCracked: crackedPasswords.length,
      crackedPasswords,
      performance: {
        speed: speedMatch ? speedMatch[1] : 'Unknown',
        timeElapsed: 'Unknown',
        estimatedTimeRemaining: timeMatch ? timeMatch[1] : undefined
      },
      scanInfo: {
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        attackMode: input.attackMode
      }
    }
  }
  
  private parseProgress(
    data: string,
    progress: HashcatProgress,
    onProgress?: (progress: ToolProgress & { data?: HashcatProgress }) => void
  ): void {
    const lines = data.split('\n')
    
    for (const line of lines) {
      // Parse status line
      const speedMatch = line.match(/Speed\.\#\d+\.\.\.\.\s+(\S+)/)
      if (speedMatch) {
        progress.speed = speedMatch[1]
        progress.stage = 'running'
      }
      
      const progressMatch = line.match(/Progress\.\.\.\.\s+(\d+)\/(\d+)/)
      if (progressMatch) {
        const current = parseInt(progressMatch[1])
        const total = parseInt(progressMatch[2])
        progress.percent = Math.min(100, (current / total) * 100)
        progress.hashesProcessed = current
      }
      
      const crackedMatch = line.match(/Recovered\.\.\.\.\s+(\d+)\/(\d+)/)
      if (crackedMatch) {
        progress.hashesCracked = parseInt(crackedMatch[1])
      }
      
      const timeMatch = line.match(/Time\.Estimated\.\.\.\.\s+(\S+)/)
      if (timeMatch) {
        progress.estimatedTimeRemaining = timeMatch[1]
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
  
  generateReport(output: HashcatOutput): SecurityReport {
    const findings: Finding[] = []
    
    if (output.hashesCracked > 0) {
      findings.push(createFinding(
        `Password Hashes Cracked: ${output.hashesCracked}`,
        `Successfully cracked ${output.hashesCracked} password hash(es) using ${output.scanInfo.attackMode} attack`,
        'high',
        'Password Security',
        {
          evidence: output.crackedPasswords.map(p => `Hash: ${p.hash.substring(0, 20)}...`).join('\n'),
          remediation: 'Implement strong password policies. Use bcrypt/Argon2 for password hashing. Enable MFA.',
          references: [
            'https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html'
          ]
        }
      ))
    }
    
    return this.reportGenerator.generate(findings, {
      title: `Hashcat Cracking Results`
    })
  }
  
  protected calculateRiskScore(input: HashcatInput): number {
    let score = 6 // Base score for password cracking
    
    if (input.attackMode === 'brute-force') score += 2
    if (input.hashType === 0 || input.hashType === 100) score += 1 // MD5/SHA1 are weak
    
    return Math.min(10, score)
  }
  
  protected estimateImpact(input: HashcatInput): string {
    const impacts: Record<string, string> = {
      'straight': 'Low-Medium - Dictionary attack using wordlist',
      'combination': 'Medium - Combines multiple wordlists',
      'brute-force': 'High - Exhaustive search, may take very long',
      'hybrid-wordlist': 'Medium - Wordlist with pattern variations',
      'hybrid-mask': 'Medium - Pattern-based with wordlist'
    }
    
    return impacts[input.attackMode] || 'Unknown impact level'
  }
  
  private getDryRunOutput(input: HashcatInput): HashcatOutput {
    return {
      hashesProcessed: 0,
      hashesCracked: 0,
      crackedPasswords: [],
      performance: {
        speed: 'N/A (dry run)',
        timeElapsed: '0s'
      },
      scanInfo: {
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        attackMode: input.attackMode
      }
    }
  }
}

export const hashcatTool = new HashcatTool()
