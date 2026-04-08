/**
 * OpenKaliClaude - Landing Page Component
 * Main CLI interface with tips, recent activity, and chat
 */

import React, { useState, useEffect } from 'react'
import { Box, Text, useInput, useApp, Spacer } from 'ink'
import Gradient from 'ink-gradient'
import Spinner from 'ink-spinner'
import TextInput from 'ink-text-input'

interface LandingPageProps {
  onCommand: (command: string) => void
}

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  cogitationTime?: string
}

const KALI_DRAGON = `
      .---.
     /     \
    | o   o |
    |   <   |
    |  \\|/  |
     \\_____/
      |   |
      |   |
      |   |
     /     \
    /       \
   /_________\\
`

const TIPS = [
  'Run /init to create a CLAUDE.md file with instructions for OpenKaliClaude',
  'Use /tools to list all available security tools',
  'Type /help for a list of available commands',
  'Use /scope to define your authorized testing scope',
  'Run /audit to view session audit log'
]

const COMMANDS = [
  { name: '/help', description: 'Show available commands' },
  { name: '/tools', description: 'List security tools' },
  { name: '/nmap', description: 'Run nmap scan' },
  { name: '/nikto', description: 'Run web vulnerability scan' },
  { name: '/sqlmap', description: 'Test for SQL injection' },
  { name: '/scope', description: 'Set authorized scope' },
  { name: '/report', description: 'Generate security report' },
  { name: '/audit', description: 'View audit log' },
  { name: '/exit', description: 'Exit OpenKaliClaude' }
]

export const LandingPage: React.FC<LandingPageProps> = ({ onCommand }) => {
  const { exit } = useApp()
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [isThinking, setIsThinking] = useState(false)
  const [recentActivity] = useState<string[]>([])

  useInput((input, key) => {
    if (key.escape) {
      setShowShortcuts(!showShortcuts)
    }
    if (key.ctrlC) {
      exit()
    }
  })

  const handleSubmit = (value: string) => {
    if (!value.trim()) return

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: value,
      timestamp: new Date()
    }

    setMessages(prev => [...prev, userMessage])
    setInput('')
    setIsThinking(true)

    // Simulate AI response
    setTimeout(() => {
      const startTime = Date.now()
      
      let response = ''
      if (value.startsWith('/')) {
        const cmd = value.split(' ')[0]
        switch (cmd) {
          case '/help':
            response = 'Available commands:\n' + COMMANDS.map(c => `  ${c.name} - ${c.description}`).join('\n')
            break
          case '/tools':
            response = 'Available security tools:\n  - nmap: Network scanner\n  - nikto: Web vulnerability scanner\n  - sqlmap: SQL injection tester\n  - hashcat: Password cracker\n  - metasploit: Exploitation framework'
            break
          case '/exit':
            exit()
            return
          default:
            response = `Executing command: ${value}`
        }
      } else {
        response = `I'm an AI assistant designed to help with cybersecurity tasks, including penetration testing, vulnerability assessment, and security analysis. I can run various security tools like nmap, nikto, sqlmap, and more.\n\nHow can I assist you today?`
      }

      const cogitationTime = ((Date.now() - startTime) / 1000).toFixed(0)

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: response,
        timestamp: new Date(),
        cogitationTime: `${cogitationTime}s`
      }

      setMessages(prev => [...prev, assistantMessage])
      setIsThinking(false)
      onCommand(value)
    }, 1500)
  }

  return (
    <Box flexDirection="column" height="100%">
      {/* Version Header */}
      <Box paddingX={1} paddingY={0}>
        <Text color="cyan">OpenKaliClaude v2.0.0</Text>
      </Box>

      {/* Main Content Area */}
      <Box flexDirection="column" flexGrow={1} padding={1}>
        {/* Welcome Box */}
        <Box 
          borderStyle="round" 
          borderColor="cyan" 
          paddingX={2} 
          paddingY={1}
          flexDirection="column"
        >
          <Box justifyContent="center" marginBottom={1}>
            <Gradient name="rainbow">
              <Text bold>Welcome to OpenKaliClaude!</Text>
            </Gradient>
          </Box>

          <Box flexDirection="row">
            {/* Left: Tips */}
            <Box flexDirection="column" width="50%" paddingRight={1}>
              <Text bold underline color="cyan">Tips for getting started</Text>
              <Box marginTop={1}>
                <Text color="gray">{TIPS[0]}</Text>
              </Box>
              <Box marginTop={1} justifyContent="center">
                <Text color="blue">{KALI_DRAGON}</Text>
              </Box>
            </Box>

            {/* Right: Recent Activity */}
            <Box flexDirection="column" width="50%" borderStyle="single" padding={1}>
              <Text bold underline color="cyan">Recent activity</Text>
              <Box marginTop={1}>
                {recentActivity.length === 0 ? (
                  <Text color="gray">No recent activity</Text>
                ) : (
                  recentActivity.map((activity, i) => (
                    <Text key={i} color="gray">{activity}</Text>
                  ))
                )}
              </Box>
            </Box>
          </Box>
        </Box>

        {/* Model Info */}
        <Box marginY={1}>
          <Text color="gray">qwen3:1.7b • API Usage Billing - openkaliclaude</Text>
        </Box>

        {/* Chat Messages */}
        <Box flexDirection="column" flexGrow={1} overflow="hidden">
          {messages.map((message) => (
            <Box key={message.id} flexDirection="column" marginY={1}>
              {message.role === 'user' ? (
                <Box>
                  <Text color="green">▸ {message.content}</Text>
                </Box>
              ) : (
                <Box flexDirection="column">
                  <Text>{message.content}</Text>
                  {message.cogitationTime && (
                    <Box marginTop={1}>
                      <Text color="gray">* Cogitated for {message.cogitationTime}</Text>
                    </Box>
                  )}
                </Box>
              )}
            </Box>
          ))}

          {isThinking && (
            <Box marginY={1}>
              <Text color="cyan">
                <Spinner type="dots" /> Thinking...
              </Text>
            </Box>
          )}
        </Box>
      </Box>

      {/* Shortcuts Panel */}
      {showShortcuts && (
        <Box 
          borderStyle="round" 
          borderColor="yellow" 
          padding={1}
          position="absolute"
          bottom={3}
          left={0}
          right={0}
        >
          <Text bold>Keyboard Shortcuts:</Text>
          <Text color="gray">ESC - Toggle shortcuts | Ctrl+C - Exit | Tab - Autocomplete</Text>
        </Box>
      )}

      {/* Input Area */}
      <Box borderStyle="single" borderColor="cyan" paddingX={1}>
        <Text color="green">{'> '}</Text>
        <TextInput 
          value={input} 
          onChange={setInput} 
          onSubmit={handleSubmit}
          placeholder="Type a message or command..."
        />
      </Box>

      {/* Footer */}
      <Box paddingX={1}>
        <Text color="gray" onPress={() => setShowShortcuts(true)}>
          ? for shortcuts
        </Text>
      </Box>
    </Box>
  )
}

export default LandingPage
