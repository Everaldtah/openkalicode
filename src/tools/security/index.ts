/**
 * OpenKaliClaude - Security Tools Index
 * Main export file for all security tools
 */

import { nmapTool } from './recon/NmapTool.js'
import { niktoTool } from './webapp/NiktoTool.js'
import { sqlmapTool } from './webapp/SqlmapTool.js'
import { hashcatTool } from './password/HashcatTool.js'
import { metasploitTool } from './exploit/MetasploitTool.js'
import { kaliTool, kaliCatalogTool } from './kali/index.js'

// Export all security tools.
//
// The hand-written tools (nmap, nikto, ...) give rich, typed, parsed output for
// the most common operations. `kaliCatalogTool` + `kaliTool` provide the
// universal protocol: discover any Kali tool and its usage, then execute it —
// so the agent is not limited to the five purpose-built wrappers.
export const securityTools = [
  kaliCatalogTool,
  kaliTool,
  nmapTool,
  niktoTool,
  sqlmapTool,
  hashcatTool,
  metasploitTool
] as const

// Tool categories for organization
export const securityToolCategories = {
  reconnaissance: [kaliCatalogTool, nmapTool],
  webapp: [niktoTool, sqlmapTool],
  password: [hashcatTool],
  wireless: [],
  exploitation: [metasploitTool],
  universal: [kaliTool],
  osint: [],
  forensics: [],
  cloud: []
} as const

export type SecurityToolCategory = keyof typeof securityToolCategories

// Export individual tools
export { nmapTool, niktoTool, sqlmapTool, hashcatTool, metasploitTool, kaliTool, kaliCatalogTool }

// Export the Kali universal protocol surface
export * from './kali/index.js'

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
