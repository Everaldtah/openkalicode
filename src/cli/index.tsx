/**
 * OpenKaliClaude - CLI Entry Point
 * Main CLI application using Ink
 */

import React, { useState } from 'react'
import { render, Box, Text, useApp } from 'ink'
import { Command } from 'commander'
import WelcomeScreen from './components/WelcomeScreen.js'
import LandingPage from './components/LandingPage.js'

enum AppState {
  WELCOME = 'welcome',
  LANDING = 'landing',
  TOOL_EXECUTION = 'tool_execution'
}

interface AppProps {
  skipWelcome?: boolean
  command?: string
}

const App: React.FC<AppProps> = ({ skipWelcome = false, command }) => {
  const [state, setState] = useState<AppState>(
    skipWelcome ? AppState.LANDING : AppState.WELCOME
  )

  const handleWelcomeContinue = () => {
    setState(AppState.LANDING)
  }

  const handleCommand = (cmd: string) => {
    console.log(`Command received: ${cmd}`)
    // Handle tool execution here
  }

  return (
    <Box flexDirection="column" height="100%">
      {state === AppState.WELCOME && (
        <WelcomeScreen onContinue={handleWelcomeContinue} />
      )}
      {state === AppState.LANDING && (
        <LandingPage onCommand={handleCommand} />
      )}
    </Box>
  )
}

// CLI Setup
const program = new Command()

program
  .name('okal')
  .description('OpenKaliClaude - AI-Powered Cybersecurity CLI')
  .version('2.0.0')
  .option('-s, --skip-welcome', 'Skip welcome screen')
  .option('-c, --command <cmd>', 'Execute command directly')
  .option('--mcp-server', 'Start MCP server mode')
  .option('--dry-run', 'Show commands without executing')
  .option('--scope <file>', 'Load scope configuration from file')
  .option('--audit', 'Enable audit logging')
  .action((options) => {
    if (options.mcpServer) {
      // Start MCP server
      import('../mcp/security-server.js').then(({ startMcpServer }) => {
        startMcpServer()
      })
    } else {
      // Start interactive CLI
      render(
        <App 
          skipWelcome={options.skipWelcome} 
          command={options.command}
        />
      )
    }
  })

// Subcommands
program
  .command('scan')
  .description('Run a security scan')
  .argument('<target>', 'Target to scan')
  .option('-t, --type <type>', 'Scan type (nmap, nikto, full)', 'nmap')
  .option('-p, --ports <ports>', 'Port range')
  .option('--dry-run', 'Show command without executing')
  .action(async (target, options) => {
    console.log(`Scanning ${target} with ${options.type}...`)
    // Implement scan logic
  })

program
  .command('tools')
  .description('List available security tools')
  .action(() => {
    console.log('Available Security Tools:')
    console.log('  Reconnaissance:')
    console.log('    - nmap: Network discovery and port scanning')
    console.log('  Web Application:')
    console.log('    - nikto: Web vulnerability scanner')
    console.log('    - sqlmap: SQL injection tester')
    console.log('  Password/Crypto:')
    console.log('    - hashcat: GPU password cracker')
    console.log('  Exploitation:')
    console.log('    - metasploit: Exploitation framework')
  })

program
  .command('install')
  .description('Install security tools')
  .argument('[tools...]', 'Tools to install (or "all")')
  .action(async (tools) => {
    console.log('Installing security tools...')
    const { installTools } = await import('../scripts/install-security-tools.js')
    await installTools(tools)
  })

program
  .command('verify')
  .description('Verify tool installation')
  .action(async () => {
    console.log('Verifying tool installation...')
    const { verifyInstallation } = await import('../scripts/verify-installation.js')
    await verifyInstallation()
  })

program
  .command('config')
  .description('Manage configuration')
  .option('--set-scope <scope>', 'Set authorized scope')
  .option('--show', 'Show current configuration')
  .action((options) => {
    if (options.show) {
      console.log('Current Configuration:')
      console.log('  Scope: Default (localhost only)')
      console.log('  Audit: Enabled')
      console.log('  Mode: Interactive')
    }
  })

// Parse arguments
program.parse()

export default App
