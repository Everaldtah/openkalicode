/**
 * OpenKaliClaude - Target Validator
 * Validates targets against scope constraints
 */

import { ScopeConstraint } from '../../../types/security.js'

export class TargetValidator {
  
  /**
   * Check if a target is within authorized scope
   */
  async isAuthorized(target: string, scope: ScopeConstraint): Promise<boolean> {
    // Check excluded networks first
    for (const excluded of scope.excludedNetworks) {
      if (this.matchesNetwork(target, excluded)) {
        return false
      }
    }
    
    // Check excluded domains
    for (const excluded of scope.excludedDomains) {
      if (this.matchesDomain(target, excluded)) {
        return false
      }
    }
    
    // If no allowed networks/domains specified, check if target is safe
    if (scope.allowedNetworks.length === 0 && scope.allowedDomains.length === 0) {
      // Default: only allow private/local addresses
      return this.isPrivateOrLocalhost(target)
    }
    
    // Check allowed networks
    for (const allowed of scope.allowedNetworks) {
      if (this.matchesNetwork(target, allowed)) {
        return true
      }
    }
    
    // Check allowed domains
    for (const allowed of scope.allowedDomains) {
      if (this.matchesDomain(target, allowed)) {
        return true
      }
    }
    
    return false
  }
  
  /**
   * Check if target matches a network CIDR
   */
  private matchesNetwork(target: string, cidr: string): boolean {
    try {
      // Handle localhost
      if (target === 'localhost' || target === '127.0.0.1') {
        return cidr === '127.0.0.1/8' || cidr === 'localhost'
      }
      
      // Handle CIDR matching
      if (cidr.includes('/')) {
        return this.ipInCidr(target, cidr)
      }
      
      // Exact match
      return target === cidr
    } catch {
      return false
    }
  }
  
  /**
   * Check if IP is within CIDR range
   */
  private ipInCidr(ip: string, cidr: string): boolean {
    const [cidrIp, bits] = cidr.split('/')
    const mask = parseInt(bits, 10)
    if (isNaN(mask) || mask < 0 || mask > 32) return false
    if (!this.isValidIp(ip) || !this.isValidIp(cidrIp)) return false

    const ipNum = this.ipToNumber(ip) >>> 0
    const cidrNum = this.ipToNumber(cidrIp) >>> 0
    // /0 matches everything; avoid JS shift-count mod-32 wraparound at shift=32
    const maskNum = mask === 0 ? 0 : (0xFFFFFFFF << (32 - mask)) >>> 0

    return (ipNum & maskNum) === (cidrNum & maskNum)
  }

  /**
   * Reject CLI argument injection: values that look like flags or contain
   * shell-meaningful control characters. Used by tool wrappers before exec.
   */
  static assertSafeArg(value: string, fieldName = 'argument'): void {
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(`Invalid ${fieldName}: must be a non-empty string`)
    }
    if (value.startsWith('-')) {
      throw new Error(`Invalid ${fieldName}: values beginning with '-' are not allowed (argument injection guard)`)
    }
    if (/[\r\n\0]/.test(value)) {
      throw new Error(`Invalid ${fieldName}: control characters are not allowed`)
    }
  }
  
  /**
   * Convert IP address to number
   */
  private ipToNumber(ip: string): number {
    const parts = ip.split('.').map(Number)
    return (parts[0] << 24) + (parts[1] << 16) + (parts[2] << 8) + parts[3]
  }
  
  /**
   * Check if target matches a domain pattern
   */
  private matchesDomain(target: string, pattern: string): boolean {
    // Handle wildcards
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(2)
      return target === suffix || target.endsWith('.' + suffix)
    }
    
    // Exact match
    return target === pattern
  }
  
  /**
   * Check if target is a private/local address
   */
  private isPrivateOrLocalhost(target: string): boolean {
    // Check localhost
    if (target === 'localhost' || target === '127.0.0.1' || target.startsWith('127.')) {
      return true
    }
    
    // Check private IP ranges
    const privateRanges = [
      '10.0.0.0/8',
      '172.16.0.0/12',
      '192.168.0.0/16',
      '169.254.0.0/16',  // Link-local
      '127.0.0.0/8'      // Loopback
    ]
    
    for (const cidr of privateRanges) {
      if (this.matchesNetwork(target, cidr)) {
        return true
      }
    }
    
    return false
  }
  
  /**
   * Validate target format (IP, hostname, or CIDR)
   */
  validateFormat(target: string): { valid: boolean; type?: 'ip' | 'hostname' | 'cidr'; error?: string } {
    // Check for CIDR
    if (target.includes('/')) {
      const [ip, bits] = target.split('/')
      const mask = parseInt(bits, 10)
      if (isNaN(mask) || mask < 0 || mask > 32) {
        return { valid: false, error: 'Invalid CIDR mask' }
      }
      if (!this.isValidIp(ip)) {
        return { valid: false, error: 'Invalid IP in CIDR' }
      }
      return { valid: true, type: 'cidr' }
    }
    
    // Check for IP address
    if (this.isValidIp(target)) {
      return { valid: true, type: 'ip' }
    }
    
    // Check for hostname
    if (this.isValidHostname(target)) {
      return { valid: true, type: 'hostname' }
    }
    
    return { valid: false, error: 'Invalid target format' }
  }
  
  /**
   * Check if string is valid IP address
   */
  private isValidIp(ip: string): boolean {
    const parts = ip.split('.')
    if (parts.length !== 4) return false
    
    for (const part of parts) {
      const num = parseInt(part, 10)
      if (isNaN(num) || num < 0 || num > 255) return false
    }
    
    return true
  }
  
  /**
   * Check if string is valid hostname
   */
  private isValidHostname(hostname: string): boolean {
    const hostnameRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/
    return hostnameRegex.test(hostname) && hostname.length <= 253
  }
  
  /**
   * Expand CIDR to list of IPs (for small ranges)
   */
  expandCidr(cidr: string): string[] {
    const [ip, bits] = cidr.split('/')
    const mask = parseInt(bits, 10)
    
    if (mask < 24) {
      throw new Error('CIDR too large to expand (>256 hosts)')
    }
    
    const baseIp = this.ipToNumber(ip)
    const hostBits = 32 - mask
    const numHosts = Math.pow(2, hostBits)
    
    const ips: string[] = []
    for (let i = 0; i < numHosts; i++) {
      ips.push(this.numberToIp(baseIp + i))
    }
    
    return ips
  }
  
  /**
   * Convert number to IP address
   */
  private numberToIp(num: number): string {
    return [
      (num >>> 24) & 0xFF,
      (num >>> 16) & 0xFF,
      (num >>> 8) & 0xFF,
      num & 0xFF
    ].join('.')
  }
}
