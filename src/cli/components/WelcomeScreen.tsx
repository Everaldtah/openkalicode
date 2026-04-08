/**
 * OpenKaliClaude - Welcome Screen Component
 * ASCII art welcome page with security notes
 */

import React, { useState, useEffect } from 'react'
import { Box, Text, useInput, useApp } from 'ink'
import Gradient from 'ink-gradient'
import BigText from 'ink-figlet'

interface WelcomeScreenProps {
  onContinue: () => void
}

const ASCII_LOGO = `
 ██████  ██████  ███████ ███    ██ ██   ██  █████  ██      ██      
██    ██ ██   ██ ██      ████   ██ ██  ██  ██   ██ ██      ██      
██    ██ ██████  █████   ██ ██  ██ █████   ███████ ██      ██      
██    ██ ██   ██ ██      ██  ██ ██ ██  ██  ██   ██ ██      ██      
 ██████  ██   ██ ███████ ██   ████ ██   ██ ██   ██ ███████ ███████ 
                                                                    
    ██████  ██╗      █████╗ ██╗   ██╗██████╗ ███████╗              
    ██╔══██╗██║     ██╔══██╗██║   ██║██╔══██╗██╔════╝              
    ██████╔╝██║     ███████║██║   ██║██║  ██║█████╗                
    ██╔══██╗██║     ██╔══██║██║   ██║██║  ██║██╔══╝                
    ██║  ██║███████╗██║  ██║╚██████╔╝██████╔╝███████╗              
    ╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚═════╝ ╚══════╝              
`

const SECURITY_NOTES = [
  {
    title: 'OpenKaliClaude is currently in research preview',
    description: 'This beta version may have limitations or unexpected behaviors.\nUse /report to submit any issues.'
  },
  {
    title: 'The AI can make mistakes',
    description: 'Always double-check OpenKaliClaude\'s outputs, especially in security contexts.'
  },
  {
    title: 'Due to prompt injection risks, only use it with code you trust',
    description: 'For guidelines, see: https://openkaliclaude.example.com/security'
  }
]

const LEGAL_WARNING = `
╔══════════════════════════════════════════════════════════════════╗
║  WARNING: This tool is for authorized security testing ONLY      ║
║  Unauthorized access to computer systems is ILLEGAL              ║
║  Ensure you have explicit written permission before scanning     ║
║  By using this software, you accept full legal responsibility    ║
╚══════════════════════════════════════════════════════════════════╝
`

export const WelcomeScreen: React.FC<WelcomeScreenProps> = ({ onContinue }) => {
  const { exit } = useApp()
  const [showLegal, setShowLegal] = useState(false)

  useInput((input, key) => {
    if (key.return) {
      if (!showLegal) {
        setShowLegal(true)
      } else {
        onContinue()
      }
    }
    if (key.escape) {
      exit()
    }
  })

  return (
    <Box flexDirection="column" padding={1}>
      {/* Header */}
      <Box justifyContent="center" marginBottom={1}>
        <Text color="cyan">* Welcome to OpenKaliClaude research preview! *</Text>
      </Box>

      {/* ASCII Logo */}
      <Box justifyContent="center" marginBottom={1}>
        <Gradient name="retro">
          <Text>{ASCII_LOGO}</Text>
        </Gradient>
      </Box>

      {/* Browser didn't open message */}
      <Box marginY={1}>
        <Text>Browser didn&apos;t open? Use the url below to sign in:</Text>
      </Box>

      <Box marginBottom={2}>
        <Text color="blue" underline>
          https://openkaliclaude.example.com/oauth/authorize?client_id=abcd1234efgh5678&user=%2Aprofile%3DOKC_research
        </Text>
      </Box>

      {/* Second header */}
      <Box justifyContent="center" marginBottom={1}>
        <Text color="cyan">* Welcome to OpenKaliClaude research preview! *</Text>
      </Box>

      {/* Security Notes */}
      <Box marginTop={1} marginBottom={1}>
        <Text bold underline>Security notes:</Text>
      </Box>

      {SECURITY_NOTES.map((note, index) => (
        <Box key={index} flexDirection="column" marginY={1}>
          <Text bold color="yellow">
            {index + 1}. {note.title}
          </Text>
          <Text color="gray">
            {note.description.split('\n').map((line, i) => (
              <Text key={i}>   {line}</Text>
            ))}
          </Text>
        </Box>
      ))}

      {/* Legal Warning */}
      {showLegal && (
        <Box marginY={2}>
          <Text color="red">{LEGAL_WARNING}</Text>
        </Box>
      )}

      {/* Continue prompt */}
      <Box marginTop={2}>
        <Text color="cyan">
          Press <Text bold>Enter</Text> to continue...
        </Text>
      </Box>

      {/* Footer hint */}
      <Box marginTop={1}>
        <Text color="gray">Press ESC to exit</Text>
      </Box>
    </Box>
  )
}

export default WelcomeScreen
