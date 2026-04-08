/**
 * OpenKaliClaude - Base Tool Interface
 * Core tool abstraction inherited from OpenClaude architecture
 */

import { z } from 'zod'
import { ToolResult, ToolProgress, ToolUseContext, PermissionResult } from './types/security.js'

export interface Tool<Input extends z.ZodTypeAny, Output, Progress = unknown> {
  name: string
  aliases?: string[]
  description: string
  inputSchema: Input
  
  call(
    input: z.infer<Input>,
    context: ToolUseContext,
    canUseTool: CanUseToolFn,
    parentMessage: unknown,
    onProgress?: (progress: ToolProgress & { data?: Progress }) => void
  ): Promise<ToolResult<Output>>
}

export type CanUseToolFn = (
  toolName: string,
  input: unknown
) => Promise<PermissionResult>

export interface ToolCapabilities {
  streaming?: boolean
  batchProcessing?: boolean
  progressReporting?: boolean
  cancellation?: boolean
}

export abstract class BaseTool<Input extends z.ZodTypeAny, Output, Progress = unknown> 
  implements Tool<Input, Output, Progress> {
  
  abstract name: string
  abstract aliases?: string[]
  abstract description: string
  abstract inputSchema: Input
  
  capabilities: ToolCapabilities = {
    streaming: false,
    batchProcessing: false,
    progressReporting: true,
    cancellation: false
  }
  
  abstract execute(
    input: z.infer<Input>,
    onProgress?: (progress: ToolProgress & { data?: Progress }) => void
  ): Promise<Output>
  
  abstract validatePermissions(
    input: z.infer<Input>,
    context: ToolUseContext
  ): Promise<PermissionResult>
  
  async call(
    input: z.infer<Input>,
    context: ToolUseContext,
    canUseTool: CanUseToolFn,
    parentMessage: unknown,
    onProgress?: (progress: ToolProgress & { data?: Progress }) => void
  ): Promise<ToolResult<Output>> {
    const startTime = Date.now()
    
    try {
      // Validate input against schema
      const validatedInput = this.inputSchema.parse(input)
      
      // Check permissions
      const permission = await this.validatePermissions(validatedInput, context)
      if (!permission.granted) {
        return {
          data: null as Output,
          success: false,
          error: permission.reason || 'Permission denied',
          metadata: {
            executionTime: Date.now() - startTime,
            timestamp: new Date().toISOString()
          }
        }
      }
      
      // Execute the tool
      const data = await this.execute(validatedInput, onProgress)
      
      return {
        data,
        success: true,
        metadata: {
          executionTime: Date.now() - startTime,
          timestamp: new Date().toISOString()
        }
      }
    } catch (error) {
      return {
        data: null as Output,
        success: false,
        error: error instanceof Error ? error.message : String(error),
        metadata: {
          executionTime: Date.now() - startTime,
          timestamp: new Date().toISOString()
        }
      }
    }
  }
}
