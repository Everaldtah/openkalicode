/**
 * OpenKaliClaude - Agent Module
 *
 * Public API for embedding the agent in other tools.
 */

export { runAnthropicAgent, type AnthropicAgentOptions } from './anthropic.js'
export { runLocalAgent, type LocalAgentOptions, type LocalProvider } from './local.js'
export { buildOpenAITools, buildAnthropicMcpServer, dispatchToolCall, buildAgentSystemPrompt, type AgentToolContext } from './tools.js'
