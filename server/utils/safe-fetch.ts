import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { bareHostname, blockedAddressReason } from '../crawler/net-guard'
import { isAllowedUrl } from './url-validator'

/**
 * SSRF protection for the scraping tools that use the global `fetch` or
 * Puppeteer (ADR-013). The URL string check alone misses redirects and
 * hostnames that resolve to private addresses; here every hop is resolved
 * and checked with the same address rules as the Site Audit guard.
 *
 * Residual risk: DNS can change between this check and the connection
 * (rebinding). The Site Audit closes that gap by checking inside the socket
 * lookup; the legacy tools accept it for now.
 */

export class BlockedUrlError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BlockedUrlError'
  }
}

/** Returns why a URL must not be requested, or null when it is a public target. */
export async function blockedTargetReason(url: string): Promise<string | null> {
  if (!isAllowedUrl(url)) return 'URL not allowed'
  const host = bareHostname(new URL(url).hostname)
  if (isIP(host)) return blockedAddressReason(host)
  let addresses: Array<{ address: string }>
  try {
    addresses = await lookup(host, { all: true })
  } catch {
    // Unresolvable: the request itself fails with a DNS error.
    return null
  }
  for (const { address } of addresses) {
    const reason = blockedAddressReason(address)
    if (reason) return `${host} resolves to ${address} (${reason})`
  }
  return null
}

export async function assertPublicUrl(url: string): Promise<void> {
  const reason = await blockedTargetReason(url)
  if (reason) throw new BlockedUrlError(`Blocked target: ${reason}`)
}

/**
 * `fetch` that follows redirects itself and checks every hop before the
 * request is sent. Same signature as `fetch` for the GET/HEAD calls of the
 * scraping tools.
 */
export async function safeFetch(
  url: string,
  init: RequestInit = {},
  maxRedirects = 10,
): Promise<Response> {
  let current = url
  for (let hop = 0; ; hop++) {
    await assertPublicUrl(current)
    const response = await fetch(current, { ...init, redirect: 'manual' })
    const location = response.headers.get('location')
    if (response.status < 300 || response.status >= 400 || !location) {
      return response
    }
    if (hop >= maxRedirects) {
      throw new Error(`More than ${maxRedirects} redirects`)
    }
    await response.body?.cancel().catch(() => {})
    current = new URL(location, current).href
  }
}

/**
 * Cached check for browser requests (Puppeteer request interception), so a
 * page with many subresources resolves each host only once per minute.
 */
const browserChecks = new Map<
  string,
  { expires: number; reason: Promise<string | null> }
>()

export function blockedBrowserRequestReason(
  url: string,
): Promise<string | null> {
  if (!/^https?:/i.test(url)) {
    // data:, blob:, about: never leave the browser.
    return Promise.resolve(/^(data|blob|about):/i.test(url) ? null : 'scheme')
  }
  let key: string
  try {
    const parsed = new URL(url)
    key = `${parsed.protocol}//${parsed.host}`
  } catch {
    return Promise.resolve('invalid URL')
  }
  const now = Date.now()
  const cached = browserChecks.get(key)
  if (cached && cached.expires > now) return cached.reason
  const reason = blockedTargetReason(url)
  browserChecks.set(key, { expires: now + 60_000, reason })
  if (browserChecks.size > 1000) {
    for (const [k, v] of browserChecks)
      if (v.expires <= now) browserChecks.delete(k)
  }
  return reason
}
