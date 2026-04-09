/**
 * OpenKaliClaude - Security Tool Base Class
 * Base class for all security tools with validation and reporting
 */

import { z } from 'zod'
import { BaseTool, CanUseToolFn } from '../../../Tool.js'
import { 
  SecurityToolConfig, 
  ToolUseContext, 
  PermissionResult,
  ToolResult,
  ToolProgress,
  SecurityReport,
  Finding,
  UnauthorizedTargetError,
  SecurityPermissionDeniedError
} from '../../../types/security.js'
import { TargetValidator } from './TargetValidator.js'
import { ReportGenerator } from './ReportGenerator.js'

export abstract class SecurityTool<Input extends z.ZodTypeAny, Output, Progress = unknown>
  extends BaseTool<Input, Output, Progress> {
  
  abstract config: SecurityToolConfig
  
  protected validator: TargetValidator
  protected reportGenerator: ReportGenerator
  
  constructor() {
    super()
    this.validator = new TargetValidator()
    this.reportGenerator = new ReportGenerator()
  }
  
  /**
   * Validate target is within authorized scope
   */
  async validateTarget(target: string, context: ToolUseContext): Promise<void> {
    const isAuthorized = await this.validator.isAuthorized(target, context.scopeConstraint)
    if (!isAuthorized) {
      throw new UnauthorizedTargetError(target)
    }
  }
  
  /**
   * Validate permissions for using this tool
   */
  async validatePermissions(
    input: z.infer<Input>,
    context: ToolUseContext
  ): Promise<PermissionResult> {
    // Check if dry run mode
    if (context.dryRun) {
      return {
        granted: true,
        reason: 'Dry run mode - no actual execution',
        requiresConfirmation: false
      }
    }
    
    // Get target from input if present
    const target = (input as Record<string, unknown>).target as string | undefined
    
    if (target) {
      const isAuthorized = await this.validator.isAuthorized(target, context.scopeConstraint)
      if (!isAuthorized) {
        const allowed = context.scopeConstraint.allowedNetworks.join(', ') || '(none)'
        const denied  = context.scopeConstraint.excludedNetworks.join(', ') || '(none)'
        return {
          granted: false,
          reason: `Target '${target}' is not within authorized scope. allowedNetworks=[${allowed}] excludedNetworks=[${denied}]. Pick a target contained in one of the allowed ranges.`,
          riskScore: 10
        }
      }
    }
    
    // Check permission level requirements
    const requiredLevel = this.config.permissionLevel
    const riskScore = this.calculateRiskScore(input)
    
    return {
      granted: true,
      requiresConfirmation: this.config.isDestructive || riskScore > 5,
      riskScore,
      estimatedImpact: this.estimateImpact(input)
    }
  }
  
  /**
   * Main call method - validates and executes
   */
  async call(
    input: z.infer<Input>,
    context: ToolUseContext,
    canUseTool: CanUseToolFn,
    parentMessage: unknown,
    onProgress?: (progress: ToolProgress & { data?: Progress }) => void
  ): Promise<ToolResult<Output>> {
    const startTime = Date.now()
    const target = (input as Record<string, unknown>).target as string | undefined
    
    try {
      // Validate input
      const validatedInput = this.inputSchema.parse(input)
      
      // Validate target scope if present
      if (target) {
        await this.validateTarget(target, context)
      }
      
      // Check permissions
      const permission = await this.validatePermissions(validatedInput, context)
      if (!permission.granted) {
        throw new SecurityPermissionDeniedError(permission)
      }
      
      // Log audit entry if enabled
      if (context.auditLog) {
        this.logAuditEntry(this.name, target || 'N/A', 'execute', context.sessionId)
      }
      
      // Execute with progress tracking
      const data = await this.execute(validatedInput, onProgress)
      
      // Generate security report
      const report = this.generateReport(data)
      
      return {
        data,
        success: true,
        warnings: this.config.legalWarnings,
        metadata: {
          executionTime: Date.now() - startTime,
          timestamp: new Date().toISOString(),
          toolVersion: this.config.version
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
  
  /**
   * Generate security report from output
   */
  abstract generateReport(output: Output): SecurityReport
  
  /**
   * Calculate risk score for this operation (1-10)
   */
  protected abstract calculateRiskScore(input: z.infer<Input>): number
  
  /**
   * Estimate impact of this operation
   */
  protected abstract estimateImpact(input: z.infer<Input>): string
  
  /**
   * Log audit entry
   */
  private logAuditEntry(tool: string, target: string, action: string, sessionId: string): void {
    const entry = {
      timestamp: new Date().toISOString(),
      sessionId,
      tool,
      target,
      action
    }
    // In production, this would write to a secure audit log
    console.error(`[AUDIT] ${JSON.stringify(entry)}`)
  }
}

/**
 * Utility function to create severity-based findings
 */
export function createFinding(
  title: string,
  description: string,
  severity: Finding['severity'],
  category: string,
  options?: Partial<Finding>
): Finding {
  return {
    id: `FIND-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    title,
    description,
    severity,
    category,
    ...options
  }
}

/**
 * Calculate overall severity from findings
 */
export function calculateOverallSeverity(findings: Finding[]): SecurityReport['severity'] {
  if (findings.length === 0) return 'info'
  
  const severityOrder = ['info', 'low', 'medium', 'high', 'critical'] as const
  let maxIndex = 0
  
  for (const finding of findings) {
    const index = severityOrder.indexOf(finding.severity)
    if (index > maxIndex) {
      maxIndex = index
    }
  }
  
  return severityOrder[maxIndex]
}
