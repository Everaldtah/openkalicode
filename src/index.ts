/**
 * OpenKaliClaude - Main Entry Point
 * Library exports for programmatic usage
 */

// Export security tools
export {
  securityTools,
  securityToolCategories,
  nmapTool,
  niktoTool,
  sqlmapTool,
  hashcatTool,
  metasploitTool,
  SecurityTool,
  TargetValidator,
  ReportGenerator
} from './tools/security/index.js'

// Export types
export type {
  SecurityToolConfig,
  ScopeConstraint,
  SecurityPermissionLevel,
  ToolResult,
  SecurityReport,
  Finding,
  CVSSVector,
  ToolProgress,
  ToolUseContext,
  PermissionResult
} from './types/security.js'

// Export MCP server
export { OpenKaliClaudeMcpServer, startMcpServer } from './mcp/security-server.js'

// Export utilities
export { installTools } from './scripts/install-security-tools.js'
export { verifyInstallation } from './scripts/verify-installation.js'

// Version
export const VERSION = '2.0.0'
export const NAME = 'OpenKaliClaude'
