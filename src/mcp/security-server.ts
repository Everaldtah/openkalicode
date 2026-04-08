/**
 * OpenKaliClaude - MCP Security Server
 * Model Context Protocol server for AI agent integration
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { securityTools } from '../tools/security/index.js'
import { ScopeConstraint } from '../types/security.js'

// Default scope - only localhost/private networks
const defaultScope: ScopeConstraint = {
  allowedNetworks: ['127.0.0.1/8', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'],
  allowedDomains: ['localhost'],
  excludedNetworks: [],
  excludedDomains: [],
  maxScope: 'cidr/24',
  requireAuthorization: true
}

/**
 * Convert security tool to MCP tool format
 */
function toolToMcpSchema(tool: typeof securityTools[number]): Tool {
  const warnings = tool.config.legalWarnings?.join('\n') || ''
  
  return {
    name: tool.name.toLowerCase().replace(/\s+/g, '_'),
    description: `${tool.description}\n\nCategory: ${tool.config.category}\nPermission Level: ${tool.config.permissionLevel}\n\n${warnings}`,
    inputSchema: zodToJsonSchema(tool.inputSchema) as Tool['inputSchema']
  }
}

/**
 * OpenKaliClaude MCP Server
 */
export class OpenKaliClaudeMcpServer {
  private server: Server
  private scope: ScopeConstraint
  private auditLog: boolean

  constructor(scope: ScopeConstraint = defaultScope, auditLog: boolean = true) {
    this.scope = scope
    this.auditLog = auditLog

    this.server = new Server(
      {
        name: 'openkaliclaude-security',
        version: '2.0.0'
      },
      {
        capabilities: {
          tools: {}
        }
      }
    )

    this.setupHandlers()
  }

  private setupHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: securityTools.map(toolToMcpSchema)
      }
    })

    // Execute tool
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params

      // Find the tool
      const tool = securityTools.find(t => {
        const toolName = t.name.toLowerCase().replace(/\s+/g, '_')
        const aliases = (t.aliases || []).map(a => a.toLowerCase().replace(/\s+/g, '_'))
        return toolName === name || aliases.includes(name)
      })

      if (!tool) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: `Unknown security tool: ${name}`,
                availableTools: securityTools.map(t => t.name.toLowerCase().replace(/\s+/g, '_'))
              }, null, 2)
            }
          ],
          isError: true
        }
      }

      // Log audit entry
      if (this.auditLog) {
        this.logAudit('tool_call', { tool: name, args })
      }

      try {
        // Create tool context
        const context = {
          sessionId: `mcp-${Date.now()}`,
          scopeConstraint: this.scope,
          auditLog: this.auditLog,
          dryRun: (args as Record<string, unknown>).dryRun === true,
          environment: 'production' as const
        }

        // Execute tool
        const result = await tool.execute(args as never, (progress) => {
          // Stream progress updates
          console.error(`[PROGRESS] ${progress.stage}: ${progress.percent}%`)
        })

        // Generate report
        const report = tool.generateReport(result)

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                data: result,
                report: {
                  severity: report.severity,
                  summary: report.summary,
                  findingsCount: report.findings.length,
                  recommendations: report.recommendations
                }
              }, null, 2)
            }
          ],
          isError: false
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: errorMessage,
                tool: name
              }, null, 2)
            }
          ],
          isError: true
        }
      }
    })
  }

  private logAudit(action: string, details: Record<string, unknown>): void {
    const entry = {
      timestamp: new Date().toISOString(),
      action,
      details
    }
    console.error(`[AUDIT] ${JSON.stringify(entry)}`)
  }

  async start(): Promise<void> {
    const transport = new StdioServerTransport()
    await this.server.connect(transport)
    console.error('OpenKaliClaude MCP Security server running on stdio')
    console.error(`Scope: ${JSON.stringify(this.scope.allowedNetworks)}`)
    console.error(`Tools available: ${securityTools.length}`)
  }
}

/**
 * Start MCP server
 */
export async function startMcpServer(): Promise<void> {
  // Load scope from environment if available
  let scope = defaultScope
  if (process.env.OKAL_SCOPE) {
    try {
      scope = JSON.parse(process.env.OKAL_SCOPE)
    } catch {
      console.error('Invalid OKAL_SCOPE, using default')
    }
  }

  const auditLog = process.env.OKAL_AUDIT !== 'false'
  
  const server = new OpenKaliClaudeMcpServer(scope, auditLog)
  await server.start()
}

// Entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  startMcpServer().catch(console.error)
}

export default OpenKaliClaudeMcpServer
