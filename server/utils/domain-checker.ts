import { promises as dns } from 'node:dns'

export type DomainStatus =
  | 'resolved' // Domain has DNS records
  | 'available' // NXDOMAIN — domain likely unregistered
  | 'subdomain-gone' // Subdomain NXDOMAIN but parent domain exists
  | 'timeout' // DNS query timed out
  | 'error' // Other DNS error
  | 'skipped' // IP address or skipped (e.g. internal link)

export interface DomainCheckResult {
  status: DomainStatus
  error?: string
}

/**
 * Checks whether a hostname resolves via DNS.
 *
 * Results are deduplicated via a shared cache map keyed on normalized hostname
 * (lowercased, trailing dot stripped). Concurrent calls for the same hostname
 * return the same in-flight promise.
 */
export async function checkDomain(
  hostname: string,
  cache: Map<string, Promise<DomainCheckResult>>,
  timeoutMs = 3000,
): Promise<DomainCheckResult> {
  // Normalize: lowercase + strip trailing dot (FQDN)
  const key = hostname.toLowerCase().replace(/\.$/, '')
  const existing = cache.get(key)
  if (existing) return existing
  const promise = doCheck(key, cache, timeoutMs)
  cache.set(key, promise)
  return promise
}

async function doCheck(
  hostname: string,
  cache: Map<string, Promise<DomainCheckResult>>,
  timeoutMs: number,
): Promise<DomainCheckResult> {
  if (isIpAddress(hostname)) return { status: 'skipped' }
  try {
    await withTimeout(dns.lookup(hostname), timeoutMs)
    return { status: 'resolved' }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    const message = (err as Error).message
    if (code === 'ENOTFOUND') {
      const parent = getRegistrableParent(hostname)
      if (parent && parent !== hostname) {
        try {
          const parentResult = await checkDomain(parent, cache, timeoutMs)
          if (parentResult.status === 'resolved') {
            return { status: 'subdomain-gone', error: `Parent ${parent} exists` }
          }
        } catch {
          // fall through
        }
      }
      return { status: 'available', error: 'NXDOMAIN' }
    }
    if (message === 'DNS timeout') return { status: 'timeout' }
    return { status: 'error', error: code || message }
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error('DNS timeout')), ms)
  })
  return Promise.race([p, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer)
  })
}

function isIpAddress(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, '')
  return /^[\d.]+$/.test(h) || /^[\da-f:]+$/i.test(h)
}

function getRegistrableParent(hostname: string): string | null {
  const parts = hostname.split('.')
  if (parts.length <= 2) return null
  return parts.slice(-2).join('.')
}
