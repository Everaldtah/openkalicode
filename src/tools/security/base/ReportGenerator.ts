/**
 * OpenKaliClaude - Report Generator
 * Generates security reports from tool outputs
 */

import { SecurityReport, Finding, CVSSVector } from '../../../types/security.js'

export class ReportGenerator {
  
  /**
   * Generate a security report from findings
   */
  generate(findings: Finding[], options?: {
    title?: string
    includeRemediation?: boolean
    includeReferences?: boolean
  }): SecurityReport {
    const severity = this.calculateOverallSeverity(findings)
    
    return {
      severity,
      findings,
      summary: this.generateSummary(findings, options?.title),
      recommendations: this.generateRecommendations(findings)
    }
  }
  
  /**
   * Calculate overall severity from findings
   */
  private calculateOverallSeverity(findings: Finding[]): SecurityReport['severity'] {
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
  
  /**
   * Generate summary text
   */
  private generateSummary(findings: Finding[], title?: string): string {
    const counts = this.countBySeverity(findings)
    
    let summary = title ? `${title}\n\n` : ''
    summary += `Security Assessment Summary:\n`
    summary += `- Total Findings: ${findings.length}\n`
    summary += `- Critical: ${counts.critical}\n`
    summary += `- High: ${counts.high}\n`
    summary += `- Medium: ${counts.medium}\n`
    summary += `- Low: ${counts.low}\n`
    summary += `- Info: ${counts.info}\n`
    
    return summary
  }
  
  /**
   * Count findings by severity
   */
  private countBySeverity(findings: Finding[]): Record<string, number> {
    const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 }
    
    for (const finding of findings) {
      counts[finding.severity]++
    }
    
    return counts
  }
  
  /**
   * Generate recommendations from findings
   */
  private generateRecommendations(findings: Finding[]): string[] {
    const recommendations: string[] = []
    
    // Group by category
    const byCategory = new Map<string, Finding[]>()
    for (const finding of findings) {
      const existing = byCategory.get(finding.category) || []
      existing.push(finding)
      byCategory.set(finding.category, existing)
    }
    
    // Generate recommendations for each category
    for (const [category, categoryFindings] of byCategory) {
      const criticalHigh = categoryFindings.filter(f => 
        f.severity === 'critical' || f.severity === 'high'
      )
      
      if (criticalHigh.length > 0) {
        recommendations.push(
          `Priority: Address ${criticalHigh.length} critical/high severity issues in ${category}`
        )
      }
      
      // Add specific remediation if available
      for (const finding of categoryFindings) {
        if (finding.remediation) {
          recommendations.push(`[${finding.severity.toUpperCase()}] ${finding.remediation}`)
        }
      }
    }
    
    return recommendations
  }
  
  /**
   * Format report as markdown
   */
  toMarkdown(report: SecurityReport): string {
    let md = `# Security Assessment Report\n\n`
    md += `**Severity:** ${report.severity.toUpperCase()}\n\n`
    md += `## Summary\n\n${report.summary}\n\n`
    
    if (report.findings.length > 0) {
      md += `## Findings\n\n`
      
      for (const finding of report.findings) {
        md += `### ${finding.title}\n\n`
        md += `- **ID:** ${finding.id}\n`
        md += `- **Severity:** ${finding.severity.toUpperCase()}\n`
        md += `- **Category:** ${finding.category}\n`
        if (finding.cve?.length) {
          md += `- **CVE:** ${finding.cve.join(', ')}\n`
        }
        md += `\n**Description:**\n${finding.description}\n\n`
        
        if (finding.evidence) {
          md += `**Evidence:**\n\`\`\`\n${finding.evidence}\n\`\`\`\n\n`
        }
        
        if (finding.remediation) {
          md += `**Remediation:**\n${finding.remediation}\n\n`
        }
        
        if (finding.references?.length) {
          md += `**References:**\n`
          for (const ref of finding.references) {
            md += `- ${ref}\n`
          }
          md += `\n`
        }
      }
    }
    
    if (report.recommendations.length > 0) {
      md += `## Recommendations\n\n`
      for (const rec of report.recommendations) {
        md += `- ${rec}\n`
      }
    }
    
    return md
  }
  
  /**
   * Format report as JSON
   */
  toJSON(report: SecurityReport): string {
    return JSON.stringify(report, null, 2)
  }
  
  /**
   * Calculate CVSS score from vector
   */
  calculateCVSS(vector: CVSSVector): number {
    // Simplified CVSS 3.1 calculation
    const av = { network: 0.85, adjacent: 0.62, local: 0.55, physical: 0.2 }
    const ac = { low: 0.77, high: 0.44 }
    const pr = { none: 0.85, low: 0.62, high: 0.27 }
    const ui = { none: 0.85, required: 0.62 }
    const ci = { none: 0, low: 0.22, high: 0.56 }
    const ii = { none: 0, low: 0.22, high: 0.56 }
    const ai = { none: 0, low: 0.22, high: 0.56 }
    
    const iss = 1 - ((1 - ci[vector.confidentialityImpact]) * 
                     (1 - ii[vector.integrityImpact]) * 
                     (1 - ai[vector.availabilityImpact]))
    
    const impact = vector.scope === 'changed' 
      ? 7.52 * (iss - 0.029) - 3.25 * Math.pow(iss - 0.02, 15)
      : 6.42 * iss
    
    const exploitability = 8.22 * av[vector.attackVector] * 
                          ac[vector.attackComplexity] * 
                          pr[vector.privilegesRequired] * 
                          ui[vector.userInteraction]
    
    const score = impact <= 0 ? 0 : Math.min(10, impact + exploitability)
    
    return Math.ceil(score * 10) / 10
  }
}
