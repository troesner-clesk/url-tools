import { lookup as dnsLookup, type LookupAddress } from 'node:dns'
import { BlockList, isIP } from 'node:net'

/**
 * Connection-level SSRF guard for the site crawler.
 *
 * The string checks in `server/utils/url-validator.ts` only look at the URL.
 * A public hostname can still resolve to a private address (or change its
 * answer between check and connect), and redirects can point anywhere. This
 * guard runs inside the socket `lookup`, so every connection, including each
 * redirect hop, is checked against the address that is actually dialled.
 */

const reserved = new BlockList()
// IPv4
reserved.addSubnet('0.0.0.0', 8, 'ipv4') // "this" network
reserved.addSubnet('10.0.0.0', 8, 'ipv4') // private
reserved.addSubnet('100.64.0.0', 10, 'ipv4') // carrier-grade NAT
reserved.addSubnet('169.254.0.0', 16, 'ipv4') // link-local, cloud metadata
reserved.addSubnet('172.16.0.0', 12, 'ipv4') // private
reserved.addSubnet('192.0.0.0', 24, 'ipv4') // IETF protocol assignments
reserved.addSubnet('192.0.2.0', 24, 'ipv4') // TEST-NET-1
reserved.addSubnet('192.168.0.0', 16, 'ipv4') // private
reserved.addSubnet('198.18.0.0', 15, 'ipv4') // benchmarking
reserved.addSubnet('198.51.100.0', 24, 'ipv4') // TEST-NET-2
reserved.addSubnet('203.0.113.0', 24, 'ipv4') // TEST-NET-3
reserved.addSubnet('224.0.0.0', 4, 'ipv4') // multicast
reserved.addSubnet('240.0.0.0', 4, 'ipv4') // reserved, broadcast
// IPv6
reserved.addAddress('::', 'ipv6') // unspecified
reserved.addSubnet('64:ff9b:1::', 48, 'ipv6') // local-use NAT64
reserved.addSubnet('fc00::', 7, 'ipv6') // unique local
reserved.addSubnet('fe80::', 10, 'ipv6') // link-local
reserved.addSubnet('ff00::', 8, 'ipv6') // multicast
reserved.addSubnet('2001:db8::', 32, 'ipv6') // documentation

const loopback = new BlockList()
loopback.addSubnet('127.0.0.0', 8, 'ipv4')
loopback.addAddress('::1', 'ipv6')

export class BlockedTargetError extends Error {
  readonly code = 'blocked_target'
  constructor(message: string) {
    super(message)
    this.name = 'BlockedTargetError'
  }
}

/** Loopback targets are only allowed with the dev escape hatch (see ARCHITECTURE.md). */
export function localhostAllowed(): boolean {
  return process.env.URL_TOOLS_ALLOW_LOCALHOST === '1'
}

function familyOf(ip: string): 'ipv4' | 'ipv6' | null {
  const version = isIP(ip)
  if (version === 4) return 'ipv4'
  if (version === 6) return 'ipv6'
  return null
}

/** NAT64 (64:ff9b::/96) embeds an IPv4 address in the last 32 bits. */
function embeddedNat64Ipv4(ip: string): string | null {
  const lower = ip.toLowerCase()
  if (!lower.startsWith('64:ff9b::')) return null
  const tail = lower.slice('64:ff9b::'.length)
  if (isIP(tail) === 4) return tail
  const parts = tail.split(':')
  if (parts.length !== 2) return null
  const hi = Number.parseInt(parts[0] || '0', 16)
  const lo = Number.parseInt(parts[1] || '0', 16)
  if (Number.isNaN(hi) || Number.isNaN(lo)) return null
  return [hi >> 8, hi & 255, lo >> 8, lo & 255].join('.')
}

/**
 * Returns a reason string when the address must not be contacted, or null
 * when it is a public address. IPv4-mapped IPv6 addresses are matched against
 * the IPv4 rules by BlockList itself.
 */
export function blockedAddressReason(
  ip: string,
  allowLoopback = localhostAllowed(),
): string | null {
  const family = familyOf(ip)
  if (!family) return 'not an IP address'
  if (loopback.check(ip, family)) {
    return allowLoopback ? null : 'loopback address'
  }
  if (reserved.check(ip, family)) return 'private or reserved address'
  const nat64 = family === 'ipv6' ? embeddedNat64Ipv4(ip) : null
  if (nat64) return blockedAddressReason(nat64, allowLoopback)
  return null
}

/** Strips the brackets WHATWG URL keeps around IPv6 hostnames. */
export function bareHostname(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname
}

/**
 * Cheap pre-flight check for a URL before any network activity: protocol and
 * literal IP addresses. Hostnames are checked again at connect time.
 */
export function assertCrawlableUrl(url: string): URL {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new BlockedTargetError('Invalid URL')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new BlockedTargetError('Only http and https URLs can be crawled')
  }
  if (parsed.username || parsed.password) {
    throw new BlockedTargetError('URLs with credentials are not crawled')
  }
  const host = bareHostname(parsed.hostname)
  if (isIP(host)) {
    const reason = blockedAddressReason(host)
    if (reason) throw new BlockedTargetError(`Blocked target (${reason})`)
  } else if (
    (host === 'localhost' || host.endsWith('.localhost')) &&
    !localhostAllowed()
  ) {
    throw new BlockedTargetError('Blocked target (loopback address)')
  }
  return parsed
}

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void

/**
 * Drop-in replacement for `dns.lookup` used as `lookup` option of
 * `http.request`. Resolves all addresses and refuses the connection when any
 * of them is private, so round-robin tricks cannot slip a private IP through.
 */
export function guardedLookup(
  hostname: string,
  options: { family?: number | string; all?: boolean; hints?: number },
  callback: LookupCallback,
): void {
  const family =
    options.family === 'IPv4' ? 4 : options.family === 'IPv6' ? 6 : 0
  dnsLookup(
    hostname,
    {
      all: true,
      family: typeof options.family === 'number' ? options.family : family,
      hints: options.hints,
    },
    (err, addresses) => {
      if (err) return callback(err, [])
      const list = addresses as LookupAddress[]
      if (list.length === 0) {
        const notFound: NodeJS.ErrnoException = new Error(
          `No address for ${hostname}`,
        )
        notFound.code = 'ENOTFOUND'
        return callback(notFound, [])
      }
      for (const entry of list) {
        const reason = blockedAddressReason(entry.address)
        if (reason) {
          return callback(
            new BlockedTargetError(
              `Blocked target ${hostname} → ${entry.address} (${reason})`,
            ),
            [],
          )
        }
      }
      if (options.all) return callback(null, list)
      const first = list[0] as LookupAddress
      callback(null, first.address, first.family)
    },
  )
}
