/**
 * OpenKaliClaude - Nmap Tool
 * Network discovery and security auditing scanner integration
 */

import { z } from 'zod'
import { spawn } from 'child_process'
import { XMLParser } from 'fast-xml-parser'
import { SecurityTool, createFinding } from '../base/SecurityTool.js'
import { TargetValidator } from '../base/TargetValidator.js'
import { 
  SecurityReport, 
  ToolProgress,
  Finding,
  ToolUseContext,
  PermissionResult
} from '../../../types/security.js'

// Input Schema
const NmapInputSchema = z.object({
  target: z.string().describe('Target IP, hostname, or CIDR range'),
  scanType: z.enum([
    'quick',        // -sV --top-ports 100
    'full',         // -sV -p- 
    'stealth',      // -sS --top-ports 1000
    'service',      // -sV --version-intensity 9
    'os',           // -O --osscan-guess
    'vuln',         // --script vuln
    'script',       // Custom scripts
    'comprehensive' // -sV -sC -O -p-
  ]).default('quick'),
  ports: z.string().optional().describe('Port range (e.g., "1-65535" or "80,443")'),
  timing: z.enum(['T0', 'T1', 'T2', 'T3', 'T4', 'T5']).default('T3'),
  scripts: z.array(z.string()).optional().describe('NSE scripts to run'),
  serviceDetection: z.boolean().default(true),
  osDetection: z.boolean().default(false),
  aggressive: z.boolean().default(false),
  outputFormat: z.enum(['normal', 'xml', 'json', 'grepable']).default('json'),
  sudo: z.boolean().default(false),
  sourceIp: z.string().optional().describe('Source IP for spoofing'),
  interface: z.string().optional(),
  exclude: z.array(z.string()).optional().describe('Hosts to exclude'),
  maxRetries: z.number().int().min(0).max(10).optional(),
  hostTimeout: z.string().optional().describe('Host timeout (e.g., "30m")'),
  scanDelay: z.string().optional().describe('Delay between probes'),
  maxRate: z.number().int().optional().describe('Max packets per second'),
  dryRun: z.boolean().default(false).describe('Show command without executing')
})

// Output Types
const PortSchema = z.object({
  protocol: z.enum(['tcp', 'udp', 'sctp']),
  portId: z.number(),
  state: z.enum(['open', 'closed', 'filtered', 'unfiltered', 'open|filtered']),
  service: z.object({
    name: z.string(),
    product: z.string().optional(),
    version: z.string().optional(),
    extrainfo: z.string().optional(),
    ostype: z.string().optional(),
    method: z.string().optional(),
    conf: z.number().optional()
  }),
  scripts: z.record(z.unknown()).optional()
})

const HostSchema = z.object({
  address: z.string(),
  status: z.enum(['up', 'down', 'unknown']),
  hostnames: z.array(z.object({
    name: z.string(),
    type: z.string()
  })),
  ports: z.array(PortSchema).optional(),
  os: z.object({
    name: z.string().optional(),
    accuracy: z.number().optional(),
    osclass: z.array(z.object({
      type: z.string(),
      vendor: z.string(),
      osfamily: z.string(),
      osgen: z.string().optional(),
      accuracy: z.number()
    }))
  }).optional(),
  trace: z.object({
    hops: z.array(z.object({
      ttl: z.number(),
      rtt: z.string(),
      ipaddr: z.string(),
      host: z.string().optional()
    }))
  }).optional()
})

const NmapOutputSchema = z.object({
  scanInfo: z.object({
    type: z.string(),
    protocol: z.string(),
    numServices: z.number(),
    services: z.string()
  }),
  scanStats: z.object({
    time: z.string(),
    elapsed: z.string(),
    summary: z.string(),
    hostsUp: z.number(),
    hostsDown: z.number()
  }),
  hosts: z.array(HostSchema)
})

type NmapInput = z.infer<typeof NmapInputSchema>
type NmapOutput = z.infer<typeof NmapOutputSchema>

interface NmapProgress {
  stage: 'discovering' | 'scanning' | 'scripting' | 'complete'
  percent: number
  hostsScanned: number
  totalHosts: number
  currentHost?: string
  openPorts: number
}

export class NmapTool extends SecurityTool<typeof NmapInputSchema, NmapOutput, NmapProgress> {
  name = 'Nmap'
  aliases = ['nmap', 'portscan', 'network-mapper']
  description = 'Network discovery and security auditing scanner - the industry standard for port scanning and service detection'
  inputSchema = NmapInputSchema
  
  config = {
    category: 'reconnaissance' as const,
    permissionLevel: 'active-recon' as const,
    requiresSudo: true,
    isDestructive: false,
    legalWarnings: [
      'Only scan networks you have explicit written permission to test',
      'Port scanning may trigger security monitoring systems (IDS/IPS)',
      'Some scans require elevated privileges (sudo)',
      'Unauthorized scanning may violate laws in your jurisdiction'
    ],
    version: '7.94+',
    references: [
      'https://nmap.org/book/',
      'https://nmap.org/nsedoc/'
    ]
  }
  
  private scanTypeOptions: Record<string, string[]> = {
    quick: ['-sV', '--top-ports', '100'],
    full: ['-sV', '-p-'],
    stealth: ['-sS', '--top-ports', '1000'],
    service: ['-sV', '--version-intensity', '9'],
    os: ['-O', '--osscan-guess'],
    vuln: ['--script', 'vuln'],
    script: [],
    comprehensive: ['-sV', '-sC', '-O', '-p-']
  }
  
  async execute(
    input: NmapInput,
    onProgress?: (progress: ToolProgress & { data?: NmapProgress }) => void
  ): Promise<NmapOutput> {
    // Build command arguments
    const args = this.buildArgs(input)
    
    if (input.dryRun) {
      const cmd = input.sudo ? `sudo nmap ${args.join(' ')}` : `nmap ${args.join(' ')}`
      console.log(`[DRY RUN] Would execute: ${cmd}`)
      return this.getDryRunOutput(input)
    }
    
    // Execute nmap with XML output
    const cmd = input.sudo ? ['sudo', 'nmap', ...args, '-oX', '-'] : ['nmap', ...args, '-oX', '-']
    
    return new Promise((resolve, reject) => {
      const process = spawn(cmd[0], cmd.slice(1))
      let output = ''
      let stderr = ''
      let progress: NmapProgress = {
        stage: 'discovering',
        percent: 0,
        hostsScanned: 0,
        totalHosts: 1,
        openPorts: 0
      }
      
      process.stdout.on('data', (data) => {
        output += data.toString()
        this.parseProgress(data.toString(), progress, onProgress)
      })
      
      process.stderr.on('data', (data) => {
        stderr += data.toString()
      })
      
      process.on('close', (code) => {
        if (code !== 0 && code !== null) {
          reject(new Error(`nmap exited with code ${code}: ${stderr}`))
        } else {
          try {
            const parsed = this.parseXmlOutput(output)
            resolve(parsed)
          } catch (e) {
            reject(new Error(`Failed to parse nmap output: ${e}`))
          }
        }
      })
    })
  }
  
  async validatePermissions(
    input: NmapInput,
    context: ToolUseContext
  ): Promise<PermissionResult> {
    // Check target authorization
    await this.validateTarget(input.target, context)
    
    const riskScore = this.calculateRiskScore(input)
    
    return {
      granted: true,
      requiresConfirmation: input.scanType === 'comprehensive' || input.scanType === 'vuln',
      riskScore,
      estimatedImpact: this.estimateImpact(input),
      confirmationMessage: `Scan ${input.target} with ${input.scanType} profile? This may be detected by security systems.`
    }
  }
  
  private buildArgs(input: NmapInput): string[] {
    // Argument-injection guards: reject values that would be parsed as flags
    TargetValidator.assertSafeArg(input.target, 'target')
    if (input.ports) TargetValidator.assertSafeArg(input.ports, 'ports')
    if (input.sourceIp) TargetValidator.assertSafeArg(input.sourceIp, 'sourceIp')
    if (input.interface) TargetValidator.assertSafeArg(input.interface, 'interface')
    if (input.hostTimeout) TargetValidator.assertSafeArg(input.hostTimeout, 'hostTimeout')
    if (input.scanDelay) TargetValidator.assertSafeArg(input.scanDelay, 'scanDelay')
    if (input.scripts) input.scripts.forEach(s => TargetValidator.assertSafeArg(s, 'scripts'))
    if (input.exclude) input.exclude.forEach(s => TargetValidator.assertSafeArg(s, 'exclude'))

    const args: string[] = []
    
    // Add scan type options
    const scanOpts = this.scanTypeOptions[input.scanType]
    args.push(...scanOpts)
    
    // Add scripts if specified
    if (input.scripts && input.scripts.length > 0) {
      args.push('--script', input.scripts.join(','))
    }
    
    // Port specification
    if (input.ports) {
      args.push('-p', input.ports)
    }
    
    // Timing template
    args.push(`-${input.timing}`)
    
    // Service detection
    if (input.serviceDetection && !scanOpts.includes('-sV')) {
      args.push('-sV')
    }
    
    // OS detection
    if (input.osDetection && !scanOpts.includes('-O')) {
      args.push('-O')
    }
    
    // Aggressive mode
    if (input.aggressive) {
      args.push('-A')
    }
    
    // Source IP
    if (input.sourceIp) {
      args.push('-S', input.sourceIp)
    }
    
    // Interface
    if (input.interface) {
      args.push('-e', input.interface)
    }
    
    // Exclude hosts
    if (input.exclude && input.exclude.length > 0) {
      args.push('--exclude', input.exclude.join(','))
    }
    
    // Timing options
    if (input.maxRetries !== undefined) {
      args.push('--max-retries', input.maxRetries.toString())
    }
    if (input.hostTimeout) {
      args.push('--host-timeout', input.hostTimeout)
    }
    if (input.scanDelay) {
      args.push('--scan-delay', input.scanDelay)
    }
    if (input.maxRate) {
      args.push('--max-rate', input.maxRate.toString())
    }
    
    // Target
    args.push(input.target)
    
    return args
  }
  
  private parseXmlOutput(xml: string): NmapOutput {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: ''
    })
    
    const parsed = parser.parse(xml)
    
    return {
      scanInfo: {
        type: parsed.nmaprun?.scaninfo?.type || 'unknown',
        protocol: parsed.nmaprun?.scaninfo?.protocol || 'unknown',
        numServices: parseInt(parsed.nmaprun?.scaninfo?.numservices) || 0,
        services: parsed.nmaprun?.scaninfo?.services || ''
      },
      scanStats: {
        time: parsed.nmaprun?.runstats?.finished?.time || '',
        elapsed: parsed.nmaprun?.runstats?.finished?.elapsed || '',
        summary: parsed.nmaprun?.runstats?.finished?.summary || '',
        hostsUp: parseInt(parsed.nmaprun?.runstats?.hosts?.up) || 0,
        hostsDown: parseInt(parsed.nmaprun?.runstats?.hosts?.down) || 0
      },
      hosts: this.parseHosts(parsed.nmaprun?.host)
    }
  }
  
  private parseHosts(hostData: unknown): NmapOutput['hosts'] {
    if (!hostData) return []
    
    const hosts = Array.isArray(hostData) ? hostData : [hostData]
    
    return hosts.map((host: Record<string, unknown>) => ({
      address: (host.address as Record<string, string>)?.addr || 'unknown',
      status: ((host.status as Record<string, string>)?.state as 'up' | 'down' | 'unknown') || 'unknown',
      hostnames: this.parseHostnames(host.hostnames),
      ports: this.parsePorts(host.ports),
      os: this.parseOS(host.os),
      trace: this.parseTrace(host.trace)
    }))
  }
  
  private parseHostnames(hostnames: unknown): Array<{ name: string; type: string }> {
    if (!hostnames) return []
    const hostname = (hostnames as Record<string, unknown>)?.hostname
    if (!hostname) return []
    
    const items = Array.isArray(hostname) ? hostname : [hostname]
    return items.map((h: Record<string, string>) => ({
      name: h.name || '',
      type: h.type || ''
    }))
  }
  
  private parsePorts(ports: unknown): NmapOutput['hosts'][0]['ports'] {
    if (!ports) return []
    const port = (ports as Record<string, unknown>)?.port
    if (!port) return []
    
    const items = Array.isArray(port) ? port : [port]
    return items.map((p: Record<string, unknown>) => ({
      protocol: (p.protocol as 'tcp' | 'udp' | 'sctp') || 'tcp',
      portId: parseInt(p.portid as string) || 0,
      state: ((p.state as Record<string, string>)?.state as 'open' | 'closed' | 'filtered' | 'unfiltered' | 'open|filtered') || 'unknown',
      service: {
        name: ((p.service as Record<string, string>)?.name) || 'unknown',
        product: (p.service as Record<string, string>)?.product,
        version: (p.service as Record<string, string>)?.version,
        extrainfo: (p.service as Record<string, string>)?.extrainfo,
        ostype: (p.service as Record<string, string>)?.ostype,
        method: (p.service as Record<string, string>)?.method,
        conf: parseInt((p.service as Record<string, string>)?.conf || '0') || undefined
      },
      scripts: p.script as Record<string, unknown> | undefined
    }))
  }
  
  private parseOS(os: unknown): NmapOutput['hosts'][0]['os'] {
    if (!os) return undefined
    
    const osmatch = (os as Record<string, unknown>)?.osmatch
    if (!osmatch) return undefined
    
    const matches = Array.isArray(osmatch) ? osmatch : [osmatch]
    const bestMatch = matches[0] as Record<string, unknown>
    
    const osclass = (bestMatch?.osclass as Record<string, unknown>) || {}
    const classes = Array.isArray(osclass) ? osclass : [osclass]
    
    return {
      name: bestMatch?.name as string,
      accuracy: parseInt(bestMatch?.accuracy as string) || 0,
      osclass: classes.map((c: Record<string, string>) => ({
        type: c.type || '',
        vendor: c.vendor || '',
        osfamily: c.osfamily || '',
        osgen: c.osgen,
        accuracy: parseInt(c.accuracy) || 0
      }))
    }
  }
  
  private parseTrace(trace: unknown): NmapOutput['hosts'][0]['trace'] {
    if (!trace) return undefined
    
    const hop = (trace as Record<string, unknown>)?.hop
    if (!hop) return undefined
    
    const hops = Array.isArray(hop) ? hop : [hop]
    
    return {
      hops: hops.map((h: Record<string, string>) => ({
        ttl: parseInt(h.ttl) || 0,
        rtt: h.rtt || '',
        ipaddr: h.ipaddr || '',
        host: h.host
      }))
    }
  }
  
  private parseProgress(
    data: string, 
    progress: NmapProgress,
    onProgress?: (progress: ToolProgress & { data?: NmapProgress }) => void
  ): void {
    const lines = data.split('\n')
    
    for (const line of lines) {
      if (line.includes('Discovered open port')) {
        progress.openPorts++
      }
      if (line.includes('Completed SYN')) {
        progress.stage = 'scanning'
        progress.percent = Math.min(100, progress.percent + 10)
      }
      if (line.includes('NSE')) {
        progress.stage = 'scripting'
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
  
  generateReport(output: NmapOutput): SecurityReport {
    const findings: Finding[] = []
    
    for (const host of output.hosts) {
      // Report open ports as findings
      if (host.ports) {
        for (const port of host.ports) {
          if (port.state === 'open') {
            const severity = this.getPortSeverity(port.portId)
            findings.push(createFinding(
              `Open Port: ${port.portId}/${port.protocol}`,
              `Port ${port.portId} (${port.service.name}) is open on ${host.address}`,
              severity,
              'Network Services',
              {
                evidence: `Service: ${port.service.name}${port.service.version ? ` ${port.service.version}` : ''}`,
                remediation: severity === 'high' || severity === 'critical' 
                  ? `Review if ${port.service.name} on port ${port.portId} is necessary and apply appropriate hardening`
                  : undefined
              }
            ))
          }
        }
      }
      
      // Report OS detection if available
      if (host.os?.name) {
        findings.push(createFinding(
          'Operating System Detected',
          `Target appears to be running: ${host.os.name}`,
          'info',
          'OS Fingerprinting',
          {
            evidence: `Accuracy: ${host.os.accuracy}%`
          }
        ))
      }
    }
    
    return this.reportGenerator.generate(findings, {
      title: `Nmap Scan Results for ${output.hosts.length} host(s)`
    })
  }
  
  private getPortSeverity(port: number): Finding['severity'] {
    const criticalPorts = [21, 22, 23, 25, 53, 80, 110, 135, 139, 143, 443, 445, 993, 995, 1723, 3306, 3389, 5432, 5900, 8080, 8443]
    const highPorts = [111, 2049, 3000, 4444, 5000, 5555, 6666, 7000, 8000, 8888, 9000, 9090, 10000]
    
    if (criticalPorts.includes(port)) return 'medium'
    if (highPorts.includes(port)) return 'low'
    return 'info'
  }
  
  protected calculateRiskScore(input: NmapInput): number {
    let score = 3 // Base score for active recon
    
    if (input.scanType === 'comprehensive') score += 3
    if (input.scanType === 'vuln') score += 2
    if (input.scanType === 'full') score += 1
    if (input.timing === 'T5') score += 1
    if (input.aggressive) score += 1
    
    return Math.min(10, score)
  }
  
  protected estimateImpact(input: NmapInput): string {
    const impacts: Record<string, string> = {
      quick: 'Minimal - scans top 100 ports',
      full: 'Moderate - scans all 65535 ports, may take significant time',
      stealth: 'Low - SYN scan designed to be less detectable',
      service: 'Low - focused service version detection',
      os: 'Low - OS fingerprinting only',
      vuln: 'Moderate - runs vulnerability detection scripts',
      script: 'Variable - depends on selected scripts',
      comprehensive: 'High - full port scan with OS detection and scripts'
    }
    
    return impacts[input.scanType] || 'Unknown impact level'
  }
  
  private getDryRunOutput(input: NmapInput): NmapOutput {
    return {
      scanInfo: {
        type: input.scanType,
        protocol: 'tcp',
        numServices: 0,
        services: 'DRY RUN'
      },
      scanStats: {
        time: new Date().toISOString(),
        elapsed: '0s',
        summary: 'Dry run - no actual scan performed',
        hostsUp: 0,
        hostsDown: 0
      },
      hosts: [{
        address: input.target,
        status: 'unknown',
        hostnames: []
      }]
    }
  }
}

// Export singleton instance
export const nmapTool = new NmapTool()
