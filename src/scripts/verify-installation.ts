/**
 * OpenKaliClaude - Installation Verification
 * Verify that all required security tools are installed and working
 */

import { spawn } from 'child_process'

interface ToolVerification {
  name: string
  command: string
  versionArgs: string[]
  minVersion?: string
  required: boolean
}

const TOOLS_TO_VERIFY: ToolVerification[] = [
  { name: 'nmap', command: 'nmap', versionArgs: ['--version'], minVersion: '7.80', required: true },
  { name: 'nikto', command: 'nikto', versionArgs: ['-Version'], required: true },
  { name: 'sqlmap', command: 'sqlmap', versionArgs: ['--version'], required: true },
  { name: 'hashcat', command: 'hashcat', versionArgs: ['--version'], required: true },
  { name: 'john', command: 'john', versionArgs: ['--version'], required: false },
  { name: 'hydra', command: 'hydra', versionArgs: ['-h'], required: false },
  { name: 'gobuster', command: 'gobuster', versionArgs: ['version'], required: false },
  { name: 'dirb', command: 'dirb', versionArgs: ['-h'], required: false },
  { name: 'wpscan', command: 'wpscan', versionArgs: ['--version'], required: false },
  { name: 'masscan', command: 'masscan', versionArgs: ['--version'], required: false },
  { name: 'searchsploit', command: 'searchsploit', versionArgs: ['--version'], required: false },
  { name: 'msfconsole', command: 'msfconsole', versionArgs: ['--version'], required: false },
  { name: 'aircrack-ng', command: 'aircrack-ng', versionArgs: ['--version'], required: false },
  { name: 'wireshark', command: 'tshark', versionArgs: ['--version'], required: false },
  { name: 'tcpdump', command: 'tcpdump', versionArgs: ['--version'], required: false },
  { name: 'netcat', command: 'nc', versionArgs: ['-h'], required: false },
  { name: 'socat', command: 'socat', versionArgs: ['-V'], required: false },
  { name: 'proxychains', command: 'proxychains4', versionArgs: ['--version'], required: false }
]

interface VerificationResult {
  tool: string
  installed: boolean
  version?: string
  path?: string
  required: boolean
  error?: string
}

/**
 * Execute command and get output
 */
function execCommand(command: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const process = spawn(command, args)
    let stdout = ''
    let stderr = ''

    process.stdout.on('data', (data) => {
      stdout += data.toString()
    })

    process.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    process.on('close', (code) => {
      resolve({ stdout, stderr, code: code || 0 })
    })
  })
}

/**
 * Check if command exists in PATH
 */
async function commandExists(command: string): Promise<boolean> {
  try {
    await execCommand('which', [command])
    return true
  } catch {
    return false
  }
}

/**
 * Get version from output
 */
function extractVersion(output: string): string | undefined {
  // Try common version patterns
  const patterns = [
    /version[:\s]+([\d.]+)/i,
    /v?([\d.]+[\w.-]*)/,
    /([\d]+\.[\d]+\.[\d]+)/
  ]

  for (const pattern of patterns) {
    const match = output.match(pattern)
    if (match) {
      return match[1]
    }
  }

  // Return first line as version if no pattern matches
  const firstLine = output.split('\n')[0].trim()
  if (firstLine && firstLine.length < 100) {
    return firstLine
  }

  return undefined
}

/**
 * Verify a single tool
 */
async function verifyTool(tool: ToolVerification): Promise<VerificationResult> {
  const exists = await commandExists(tool.command)

  if (!exists) {
    return {
      tool: tool.name,
      installed: false,
      required: tool.required,
      error: 'Command not found in PATH'
    }
  }

  try {
    const { stdout, stderr } = await execCommand(tool.command, tool.versionArgs)
    const output = stdout || stderr
    const version = extractVersion(output)

    return {
      tool: tool.name,
      installed: true,
      version,
      required: tool.required
    }
  } catch (error) {
    return {
      tool: tool.name,
      installed: true, // Command exists but version check failed
      required: tool.required,
      error: 'Version check failed'
    }
  }
}

/**
 * Verify all tools
 */
export async function verifyInstallation(): Promise<VerificationResult[]> {
  console.log('╔══════════════════════════════════════════════════════════════╗')
  console.log('║  OpenKaliClaude Tool Verification                            ║')
  console.log('╚══════════════════════════════════════════════════════════════╝')
  console.log()

  const results: VerificationResult[] = []

  for (const tool of TOOLS_TO_VERIFY) {
    const result = await verifyTool(tool)
    results.push(result)

    const status = result.installed 
      ? '✅' 
      : result.required 
        ? '❌' 
        : '⚠️'
    
    const version = result.version ? ` (${result.version})` : ''
    const required = result.required ? ' [REQUIRED]' : ' [optional]'

    console.log(`${status} ${result.tool}${version}${required}`)

    if (result.error) {
      console.log(`   ${result.error}`)
    }
  }

  console.log()

  // Summary
  const installed = results.filter(r => r.installed)
  const missing = results.filter(r => !r.installed)
  const missingRequired = missing.filter(r => r.required)

  console.log('Summary:')
  console.log(`  Installed: ${installed.length}/${results.length}`)
  console.log(`  Missing: ${missing.length}`)

  if (missingRequired.length > 0) {
    console.log()
    console.log('⚠️  Missing required tools:')
    for (const tool of missingRequired) {
      console.log(`    - ${tool.tool}`)
    }
    console.log()
    console.log('Run "okal install core" to install required tools')
  }

  return results
}

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  verifyInstallation()
    .then(results => {
      const missingRequired = results.filter(r => !r.installed && r.required)
      process.exit(missingRequired.length > 0 ? 1 : 0)
    })
    .catch(error => {
      console.error('Verification failed:', error)
      process.exit(1)
    })
}

export default verifyInstallation
