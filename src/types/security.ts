/**
 * OpenKaliClaude - Security Types
 * Core type definitions for security tools and permissions
 */

import { z } from 'zod'

// ============================================================================
// Permission Levels
// ============================================================================

export const SecurityPermissionLevelSchema = z.enum([
  'passive-recon',      // Read-only network operations (ping, DNS)
  'active-recon',       // Port scanning, service detection
  'vuln-scanning',      // Vulnerability detection
  'web-scanning',       // Web app scanning (may modify state)
  'brute-force',        // Authentication attacks
  'exploitation',       // Running exploits
  'wireless',           // WiFi operations (may violate laws)
  'social-engineering', // Phishing/simulation campaigns
  'forensics',          // Data recovery/analysis
  'reverse-shell',      // Callback connections
  'privilege-escalation' // Local exploitation
])

export type SecurityPermissionLevel = z.infer<typeof SecurityPermissionLevelSchema>

// ============================================================================
// Scope Constraints
// ============================================================================

export const ScopeConstraintSchema = z.object({
  allowedNetworks: z.array(z.string()).default([]),
  allowedDomains: z.array(z.string()).default([]),
  excludedNetworks: z.array(z.string()).default(['0.0.0.0/0', '::/0']),
  excludedDomains: z.array(z.string()).default([]),
  maxScope: z.enum(['host', 'cidr/24', 'cidr/16', 'domain', 'unlimited']).default('host'),
  requireAuthorization: z.boolean().default(true)
})

export type ScopeConstraint = z.infer<typeof ScopeConstraintSchema>

// ============================================================================
// Tool Configuration
// ============================================================================

export const SecurityToolConfigSchema = z.object({
  category: z.enum([
    'reconnaissance',
    'scanning',
    'enumeration',
    'exploitation',
    'wireless',
    'forensics',
    'osint',
    'crypto',
    'social-engineering',
    'webapp',
    'network',
    'mobile',
    'cloud',
    'containers'
  ]),
  permissionLevel: SecurityPermissionLevelSchema,
  requiresSudo: z.boolean().default(false),
  isDestructive: z.boolean().default(false),
  legalWarnings: z.array(z.string()).default([]),
  version: z.string().default('1.0.0'),
  author: z.string().optional(),
  references: z.array(z.string()).default([])
})

export type SecurityToolConfig = z.infer<typeof SecurityToolConfigSchema>

// ============================================================================
// Tool Result Types
// ============================================================================

export interface ToolProgress {
  stage: string
  percent: number
  message?: string
  details?: Record<string, unknown>
}

export interface ToolResult<T = unknown> {
  data: T
  success: boolean
  error?: string
  warnings?: string[]
  metadata?: {
    executionTime: number
    timestamp: string
    toolVersion?: string
    commandExecuted?: string
  }
}

export interface SecurityReport {
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical'
  findings: Finding[]
  summary: string
  recommendations: string[]
  cvssScore?: number
}

export interface Finding {
  id: string
  title: string
  description: string
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical'
  category: string
  evidence?: string
  remediation?: string
  references?: string[]
  cve?: string[]
}

// ============================================================================
// Permission Result
// ============================================================================

export interface PermissionResult {
  granted: boolean
  reason?: string
  requiresConfirmation?: boolean
  confirmationMessage?: string
  riskScore?: number
  estimatedImpact?: string
}

// ============================================================================
// Tool Context
// ============================================================================

export interface ToolUseContext {
  sessionId: string
  userId?: string
  scopeConstraint: ScopeConstraint
  auditLog: boolean
  dryRun: boolean
  environment: 'development' | 'testing' | 'production'
}

// ============================================================================
// CVSS Types
// ============================================================================

export const CVSSVectorSchema = z.object({
  attackVector: z.enum(['network', 'adjacent', 'local', 'physical']),
  attackComplexity: z.enum(['low', 'high']),
  privilegesRequired: z.enum(['none', 'low', 'high']),
  userInteraction: z.enum(['none', 'required']),
  scope: z.enum(['unchanged', 'changed']),
  confidentialityImpact: z.enum(['none', 'low', 'high']),
  integrityImpact: z.enum(['none', 'low', 'high']),
  availabilityImpact: z.enum(['none', 'low', 'high'])
})

export type CVSSVector = z.infer<typeof CVSSVectorSchema>

// ============================================================================
// Session Types
// ============================================================================

export interface SecuritySession {
  id: string
  createdAt: Date
  expiresAt: Date
  scope: ScopeConstraint
  toolsUsed: string[]
  targetsAuthorized: string[]
  auditLog: AuditEntry[]
}

export interface AuditEntry {
  timestamp: Date
  tool: string
  target: string
  action: string
  result: 'success' | 'failure' | 'denied'
  details?: Record<string, unknown>
}

// ============================================================================
// CTF Integration Types
// ============================================================================

export const CTFConfigSchema = z.object({
  platform: z.enum(['hackthebox', 'tryhackme', 'vulnhub', 'custom']),
  target: z.string(),
  apiKey: z.string().optional(),
  flags: z.array(z.string()).default([])
})

export type CTFConfig = z.infer<typeof CTFConfigSchema>

// ============================================================================
// Tool Chain Types
// ============================================================================

export interface ToolChainStep {
  tool: string
  input: Record<string, unknown>
  condition?: (previousResults: unknown[]) => boolean
  transform?: (previousResults: unknown[]) => Record<string, unknown>
}

export interface ToolChain {
  name: string
  description: string
  steps: ToolChainStep[]
  autoExecute: boolean
}

// ============================================================================
// Error Types
// ============================================================================

export class SecurityToolError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'SecurityToolError'
  }
}

export class UnauthorizedTargetError extends SecurityToolError {
  constructor(target: string) {
    super(
      `Target '${target}' is not within authorized scope`,
      'UNAUTHORIZED_TARGET',
      { target }
    )
    this.name = 'UnauthorizedTargetError'
  }
}

export class SecurityPermissionDeniedError extends SecurityToolError {
  constructor(permission: PermissionResult) {
    super(
      permission.reason || 'Permission denied',
      'PERMISSION_DENIED',
      { permission }
    )
    this.name = 'SecurityPermissionDeniedError'
  }
}

export class ScopeError extends SecurityToolError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'SCOPE_VIOLATION', details)
    this.name = 'ScopeError'
  }
}
