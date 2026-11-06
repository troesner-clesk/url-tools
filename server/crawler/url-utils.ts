/**
 * URL helpers for the site crawler. Normalisation is deliberately minimal:
 * `/page` and `/page/` are different URLs for search engines (one usually
 * redirects to the other), so trailing slashes and query strings are kept.
 */

const SKIPPED_SCHEMES =
  /^(javascript|mailto|tel|sms|data|file|ftp|about|blob):/i

export function normalizeCrawlUrl(raw: string, base?: string): string | null {
  const value = raw.trim()
  if (!value || value.startsWith('#') || SKIPPED_SCHEMES.test(value)) {
    return null
  }
  try {
    const url = new URL(value, base)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    url.hash = ''
    return url.href
  } catch {
    return null
  }
}

export interface CrawlScope {
  hosts: Set<string>
  rootHost: string
  includeSubdomains: boolean
}

function toggleWww(host: string): string {
  return host.startsWith('www.') ? host.slice(4) : `www.${host}`
}

/** Internal = the start host and its www/non-www twin (plus subdomains if enabled). */
export function createScope(
  startUrl: string,
  includeSubdomains = false,
): CrawlScope {
  const host = new URL(startUrl).hostname.toLowerCase()
  const rootHost = host.startsWith('www.') ? host.slice(4) : host
  return {
    hosts: new Set([host, toggleWww(host)]),
    rootHost,
    includeSubdomains,
  }
}

export function isInScope(url: string, scope: CrawlScope): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase()
    if (scope.hosts.has(host)) return true
    return scope.includeSubdomains && host.endsWith(`.${scope.rootHost}`)
  } catch {
    return false
  }
}

/** Accepts "a, b" strings or arrays; returns trimmed, non-empty path prefixes. */
export function parsePathList(value: string | string[] | undefined): string[] {
  const list = Array.isArray(value) ? value : (value ?? '').split(',')
  return list
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, 50)
}

function prefixMatches(path: string, prefix: string): boolean {
  const p = prefix.replace(/\/+$/, '')
  if (p === '') return true
  return path === p || path.startsWith(`${p}/`)
}

/** Prefix semantics like the Link Analyzer: "/de" matches "/de" and "/de/…". */
export function matchesPathFilters(
  url: string,
  include: string[],
  exclude: string[],
): boolean {
  let path: string
  try {
    path = new URL(url).pathname
  } catch {
    return false
  }
  if (exclude.some((prefix) => prefixMatches(path, prefix))) return false
  if (include.length === 0) return true
  return include.some((prefix) => prefixMatches(path, prefix))
}
