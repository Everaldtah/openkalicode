/**
 * Detect the host's actual local subnet, so when the operator says
 * "scan my wifi" we scan the network they're *actually* on instead of
 * guessing 192.168.1.0/24 and hitting scope errors.
 *
 * Uses os.networkInterfaces() — works cross-platform without shelling out.
 */

import os from 'node:os'

export interface LocalSubnet {
  iface: string
  address: string
  cidr: string
  netmask: string
}

/**
 * Return all non-internal IPv4 subnets the host is currently attached to,
 * sorted with likely-wifi interfaces first.
 */
export function detectLocalSubnets(): LocalSubnet[] {
  const ifaces = os.networkInterfaces()
  const out: LocalSubnet[] = []
  for (const [name, addrs] of Object.entries(ifaces)) {
    if (!addrs) continue
    for (const a of addrs) {
      if (a.family !== 'IPv4' || a.internal) continue
      if (!a.cidr) continue
      // Normalize CIDR to the network address, not the host address —
      // os gives us e.g. "192.168.1.57/24" but scanners want "192.168.1.0/24".
      const networkCidr = normalizeCidr(a.cidr)
      out.push({ iface: name, address: a.address, cidr: networkCidr, netmask: a.netmask })
    }
  }
  out.sort((a, b) => ifaceRank(a.iface) - ifaceRank(b.iface))
  return out
}

function ifaceRank(name: string): number {
  const n = name.toLowerCase()
  if (/wi[-]?fi|wlan|wireless/.test(n)) return 0
  if (/eth|en0|en1|lan/.test(n)) return 1
  if (/vethernet|wsl|docker|vbox|vmware/.test(n)) return 9
  return 5
}

function normalizeCidr(cidr: string): string {
  const [ip, bitsStr] = cidr.split('/')
  const bits = parseInt(bitsStr, 10)
  if (isNaN(bits)) return cidr
  const parts = ip.split('.').map(Number)
  const num = (parts[0] << 24) + (parts[1] << 16) + (parts[2] << 8) + parts[3]
  const mask = bits === 0 ? 0 : (0xFFFFFFFF << (32 - bits)) >>> 0
  const net = (num & mask) >>> 0
  const netIp = [
    (net >>> 24) & 0xFF,
    (net >>> 16) & 0xFF,
    (net >>> 8) & 0xFF,
    net & 0xFF
  ].join('.')
  return `${netIp}/${bits}`
}

/** Pick the single best guess for "the LAN the user is on". */
export function primarySubnet(): LocalSubnet | null {
  return detectLocalSubnets()[0] || null
}
