/**
 * OpenKaliClaude - Agent Tool Adapters
 *
 * Converts the in-repo SecurityTool[] into the two formats we need:
 *
 *   1. Anthropic Claude Agent SDK in-process MCP tools (Zod-native)
 *   2. OpenAI-compatible function/tool definitions (JSON Schema)
 *      — used for LM Studio, Ollama, and any other OpenAI-compatible server.
 *
 * Both adapters share a single execution path: they call the SecurityTool's
 * `call()` method with a fully-built ToolUseContext, so scope checks,
 * argument-injection guards, audit logging, and report generation all run
 * exactly the same regardless of which model is driving the agent.
 */

import { zodToJsonSchema } from 'zod-to-json-schema'
import { securityTools } from '../tools/security/index.js'
import { ScopeConstraint, ToolUseContext } from '../types/security.js'

export interface AgentToolContext {
  scope: ScopeConstraint
  auditLog: boolean
  sessionId: string
  dryRun: boolean
}

function buildToolContext(ctx: AgentToolContext): ToolUseContext {
  return {
    sessionId: ctx.sessionId,
    scopeConstraint: ctx.scope,
    auditLog: ctx.auditLog,
    dryRun: ctx.dryRun,
    environment: 'production'
  }
}

function toolName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '_')
}

/**
 * OpenAI-compatible tool definitions (LM Studio, Ollama, etc.)
 */
export function buildOpenAITools() {
  return securityTools.map(t => ({
    type: 'function' as const,
    function: {
      name: toolName(t.name),
      description: `${t.description}\n\nCategory: ${t.config.category}\nPermission: ${t.config.permissionLevel}\n\n${(t.config.legalWarnings || []).join('\n')}`,
      parameters: zodToJsonSchema(t.inputSchema, { target: 'openApi3' }) as Record<string, unknown>
    }
  }))
}

/**
 * Dispatch a tool call by name. Used by the OpenAI-compatible loop.
 * Returns the JSON-stringified tool result that gets fed back to the model.
 */
export async function dispatchToolCall(
  name: string,
  rawArgs: string | Record<string, unknown>,
  ctx: AgentToolContext
): Promise<string> {
  const tool = securityTools.find(t => toolName(t.name) === name)
  if (!tool) {
    return JSON.stringify({ error: `Unknown tool: ${name}` })
  }

  let args: Record<string, unknown>
  try {
    args = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : rawArgs
  } catch (e) {
    return JSON.stringify({ error: `Invalid JSON arguments: ${(e as Error).message}` })
  }

  try {
    const result = await tool.call(
      args as never,
      buildToolContext(ctx),
      async () => ({ behavior: 'allow' }),
      null
    )
    if (!result.success) {
      return JSON.stringify({ error: result.error, success: false })
    }
    const report = tool.generateReport(result.data as never)
    return JSON.stringify({
      success: true,
      data: result.data,
      report: {
        severity: report.severity,
        summary: report.summary,
        findings: report.findings.length,
        recommendations: report.recommendations
      }
    })
  } catch (e) {
    return JSON.stringify({ error: (e as Error).message })
  }
}

/**
 * Build an in-process Claude Agent SDK MCP server containing every
 * SecurityTool. The SDK accepts Zod schemas natively, so no JSON Schema
 * conversion is needed for this path.
 *
 * The import is dynamic so that users running the local-model path don't
 * pay the cost of loading the Anthropic SDK.
 */
export async function buildAnthropicMcpServer(ctx: AgentToolContext) {
  const { createSdkMcpServer, tool } = await import('@anthropic-ai/claude-agent-sdk')

  const tools = securityTools.map(t =>
    tool(
      toolName(t.name),
      `${t.description}\n\n${(t.config.legalWarnings || []).join('\n')}`,
      // The SDK expects a Zod *shape* (record of fields). Our tools use a
      // ZodObject — `.shape` exposes the underlying field map.
      ((t.inputSchema as unknown as { shape: Record<string, unknown> }).shape) || {},
      async (args: Record<string, unknown>) => {
        const text = await dispatchToolCall(toolName(t.name), args, ctx)
        return { content: [{ type: 'text', text }] }
      }
    )
  )

  return createSdkMcpServer({
    name: 'openkaliclaude-security',
    version: '2.0.0',
    tools
  })
}
