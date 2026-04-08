/**
 * OpenKaliClaude - Security Tools Installer
 * Automated installation of Kali Linux security tools
 */

import { spawn } from 'child_process'
import { promisify } from 'util'
import * as fs from 'fs/promises'
import * as path from 'path'

const exec = promisify(spawn)

interface ToolDefinition {
  name: string
  package: string
  description: string
  alternatives?: string[]
  postInstall?: string[]
}

const CORE_TOOLS: ToolDefinition[] = [
  { name: 'nmap', package: 'nmap', description: 'Network discovery and security auditing' },
  { name: 'nikto', package: 'nikto', description: 'Web vulnerability scanner' },
  { name: 'sqlmap', package: 'sqlmap', description: 'Automated SQL injection tool' },
  { name: 'hashcat', package: 'hashcat', description: 'GPU password cracker' },
  { name: 'john', package: 'john', description: 'John the Ripper password cracker' },
  { name: 'hydra', package: 'hydra', description: 'Online password brute forcer' },
  { name: 'gobuster', package: 'gobuster', description: 'Directory/file brute forcer' },
  { name: 'dirb', package: 'dirb', description: 'URL brute forcer' },
  { name: 'wpscan', package: 'wpscan', description: 'WordPress vulnerability scanner' },
  { name: 'masscan', package: 'masscan', description: 'High-speed port scanner' },
  { name: 'searchsploit', package: 'exploitdb', description: 'Exploit database searcher' },
  { name: 'metasploit', package: 'metasploit-framework', description: 'Exploitation framework' }
]

const ADDITIONAL_TOOLS: ToolDefinition[] = [
  { name: 'aircrack-ng', package: 'aircrack-ng', description: 'Wireless security suite' },
  { name: 'reaver', package: 'reaver', description: 'WPS PIN attacker' },
  { name: 'wireshark', package: 'wireshark', description: 'Network protocol analyzer' },
  { name: 'tcpdump', package: 'tcpdump', description: 'Network packet analyzer' },
  { name: 'netcat', package: 'netcat-traditional', description: 'Network swiss army knife' },
  { name: 'ncat', package: 'ncat', description: 'Netcat improved' },
  { name: 'socat', package: 'socat', description: 'Multipurpose relay' },
  { name: 'proxychains', package: 'proxychains4', description: 'Proxy chains' },
  { name: 'tor', package: 'tor', description: 'Anonymity network' },
  { name: 'openvpn', package: 'openvpn', description: 'VPN client' },
  { name: 'enum4linux', package: 'enum4linux', description: 'Windows/Samba enumeration' },
  { name: 'ldap-utils', package: 'ldap-utils', description: 'LDAP utilities' },
  { name: 'snmp', package: 'snmp', description: 'SNMP tools' },
  { name: 'sslscan', package: 'sslscan', description: 'SSL/TLS scanner' },
  { name: 'testssl.sh', package: 'testssl.sh', description: 'SSL/TLS tester' }
]

const CLOUD_TOOLS: ToolDefinition[] = [
  { name: 'aws-cli', package: 'awscli', description: 'AWS command line interface' },
  { name: 'azure-cli', package: 'azure-cli', description: 'Azure command line interface' },
  { name: 'gcloud', package: 'google-cloud-sdk', description: 'Google Cloud SDK' },
  { name: 'trivy', package: 'trivy', description: 'Container vulnerability scanner' },
  { name: 'docker', package: 'docker.io', description: 'Container platform' }
]

interface InstallResult {
  tool: string
  success: boolean
  message: string
  version?: string
}

/**
 * Check if running on a Debian-based system
 */
async function isDebianBased(): Promise<boolean> {
  try {
    await fs.access('/etc/debian_version')
    return true
  } catch {
    return false
  }
}

/**
 * Check if running with sudo
 */
function hasSudo(): boolean {
  return process.getuid?.() === 0 || process.env.SUDO_USER !== undefined
}

/**
 * Execute command with promise
 */
function execCommand(command: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
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
      if (code === 0) {
        resolve({ stdout, stderr })
      } else {
        reject(new Error(`Command failed with code ${code}: ${stderr}`))
      }
    })
  })
}

/**
 * Install a single tool
 */
async function installTool(tool: ToolDefinition): Promise<InstallResult> {
  console.log(`Installing ${tool.name}...`)

  try {
    const isDebian = await isDebianBased()
    
    if (isDebian) {
      await execCommand('apt-get', ['install', '-y', tool.package])
    } else {
      // Try to install via package manager
      try {
        await execCommand('brew', ['install', tool.name])
      } catch {
        return {
          tool: tool.name,
          success: false,
          message: 'Unsupported package manager. Please install manually.'
        }
      }
    }

    // Get version
    let version = 'unknown'
    try {
      const { stdout } = await execCommand(tool.name, ['--version'])
      version = stdout.split('\n')[0].trim()
    } catch {
      // Version check failed, but installation may still be successful
    }

    // Run post-install commands if specified
    if (tool.postInstall) {
      for (const cmd of tool.postInstall) {
        try {
          await execCommand('bash', ['-c', cmd])
        } catch {
          // Post-install command failed, continue
        }
      }
    }

    return {
      tool: tool.name,
      success: true,
      message: `Successfully installed ${tool.name}`,
      version
    }
  } catch (error) {
    return {
      tool: tool.name,
      success: false,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

/**
 * Install multiple tools
 */
export async function installTools(tools?: string[]): Promise<InstallResult[]> {
  console.log('╔══════════════════════════════════════════════════════════════╗')
  console.log('║  OpenKaliClaude Security Tools Installer                     ║')
  console.log('╚══════════════════════════════════════════════════════════════╝')
  console.log()

  // Check for sudo
  if (!hasSudo()) {
    console.log('⚠️  Warning: Not running with sudo. Some installations may fail.')
    console.log('   Consider running with: sudo okal install')
    console.log()
  }

  // Determine which tools to install
  let toolsToInstall: ToolDefinition[] = []

  if (!tools || tools.length === 0 || tools.includes('all')) {
    toolsToInstall = [...CORE_TOOLS, ...ADDITIONAL_TOOLS]
  } else if (tools.includes('core')) {
    toolsToInstall = CORE_TOOLS
  } else if (tools.includes('cloud')) {
    toolsToInstall = CLOUD_TOOLS
  } else {
    // Install specific tools
    const allTools = [...CORE_TOOLS, ...ADDITIONAL_TOOLS, ...CLOUD_TOOLS]
    toolsToInstall = allTools.filter(t => tools.includes(t.name))
  }

  if (toolsToInstall.length === 0) {
    console.log('No tools specified for installation.')
    console.log('Usage: okal install [tool1] [tool2] ...')
    console.log('       okal install core')
    console.log('       okal install all')
    return []
  }

  console.log(`Installing ${toolsToInstall.length} tool(s)...`)
  console.log()

  const results: InstallResult[] = []

  for (const tool of toolsToInstall) {
    const result = await installTool(tool)
    results.push(result)

    if (result.success) {
      console.log(`  ✅ ${tool.name}: ${result.message}`)
      if (result.version) {
        console.log(`     Version: ${result.version}`)
      }
    } else {
      console.log(`  ❌ ${tool.name}: ${result.message}`)
    }
  }

  console.log()
  console.log('Installation complete!')
  console.log(`  Successful: ${results.filter(r => r.success).length}`)
  console.log(`  Failed: ${results.filter(r => !r.success).length}`)

  return results
}

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  const tools = process.argv.slice(2)
  installTools(tools.length > 0 ? tools : undefined)
    .then(results => {
      process.exit(results.every(r => r.success) ? 0 : 1)
    })
    .catch(error => {
      console.error('Installation failed:', error)
      process.exit(1)
    })
}

export default installTools
