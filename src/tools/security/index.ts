/**
 * OpenKaliClaude - Security Tools Index
 * Main export file for all security tools
 */

import { nmapTool } from './recon/NmapTool.js'
import { niktoTool } from './webapp/NiktoTool.js'
import { sqlmapTool } from './webapp/SqlmapTool.js'
import { hashcatTool } from './password/HashcatTool.js'
import { metasploitTool } from './exploit/MetasploitTool.js'

// Export all security tools
export const securityTools = [
  nmapTool,
  niktoTool,
  sqlmapTool,
  hashcatTool,
  metasploitTool
] as const

// Tool categories for organization
export const securityToolCategories = {
  reconnaissance: [nmapTool],
  webapp: [niktoTool, sqlmapTool],
  password: [hashcatTool],
  wireless: [],
  exploitation: [metasploitTool],
  osint: [],
  forensics: [],
  cloud: []
} as const

export type SecurityToolCategory = keyof typeof securityToolCategories

// Export individual tools
export { nmapTool, niktoTool, sqlmapTool, hashcatTool, metasploitTool }

// Export base classes
export { SecurityTool, TargetValidator, ReportGenerator } from './base/index.js'

// Export types
export type { 
  SecurityToolConfig,
  ScopeConstraint,
  SecurityPermissionLevel,
  ToolResult,
  SecurityReport,
  Finding,
  CVSSVector
} from '../../types/security.js'
