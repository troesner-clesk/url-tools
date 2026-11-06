import { type HttpRequestOptions, httpRequest } from './http-client'

/**
 * robots.txt handling following RFC 9309: groups per user agent, longest
 * matching rule wins, `allow` wins ties, `*` and `$` wildcards.
 */

export interface RobotsRule {
  allow: boolean
  pattern: string
  regex: RegExp
}

interface RobotsGroup {
  agents: string[]
  rules: RobotsRule[]
  crawlDelay?: number
}

export interface RobotsTxt {
  groups: RobotsGroup[]
  sitemaps: string[]
}

export type RobotsPolicy =
  | { kind: 'rules'; robots: RobotsTxt; url: string }
  | { kind: 'allow-all'; reason: string }
  | { kind: 'disallow-all'; reason: string }

const MAX_ROBOTS_BYTES = 512 * 1024

function patternToRegex(pattern: string): RegExp {
  const anchored = pattern.endsWith('$')
  const body = anchored ? pattern.slice(0, -1) : pattern
  const source = body
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*')
  return new RegExp(`^${source}${anchored ? '$' : ''}`)
}

export function parseRobotsTxt(text: string): RobotsTxt {
  const groups: RobotsGroup[] = []
  const sitemaps: string[] = []
  let current: RobotsGroup | null = null
  let collectingAgents = false

  for (const rawLine of text.slice(0, MAX_ROBOTS_BYTES).split(/\r\n|\r|\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim()
    const separator = line.indexOf(':')
    if (separator === -1) continue
    const key = line.slice(0, separator).trim().toLowerCase()
    const value = line.slice(separator + 1).trim()

    if (key === 'user-agent' || key === 'useragent' || key === 'user agent') {
      if (!current || !collectingAgents) {
        current = { agents: [], rules: [] }
        groups.push(current)
      }
      current.agents.push(value.toLowerCase())
      collectingAgents = true
      continue
    }
    if (key === 'sitemap') {
      if (value) sitemaps.push(value)
      continue
    }
    collectingAgents = false
    if (!current) continue

    if (key === 'allow' || key === 'disallow') {
      // An empty value means "no restriction" and adds no rule.
      if (!value) continue
      current.rules.push({
        allow: key === 'allow',
        pattern: value,
        regex: patternToRegex(value),
      })
    } else if (key === 'crawl-delay') {
      const seconds = Number(value)
      if (Number.isFinite(seconds) && seconds >= 0) current.crawlDelay = seconds
    }
  }
  return { groups, sitemaps }
}

function groupsFor(robots: RobotsTxt, token: string): RobotsGroup[] {
  const wanted = token.toLowerCase()
  const specific = robots.groups.filter((group) =>
    group.agents.some((agent) => agent.split('/')[0]?.trim() === wanted),
  )
  if (specific.length > 0) return specific
  return robots.groups.filter((group) => group.agents.includes('*'))
}

/** `pathAndQuery` is `pathname + search` of the URL. */
export function isAllowedByRobots(
  robots: RobotsTxt,
  pathAndQuery: string,
  token: string,
): boolean {
  if (pathAndQuery === '/robots.txt') return true
  let best: RobotsRule | null = null
  for (const group of groupsFor(robots, token)) {
    for (const rule of group.rules) {
      if (!rule.regex.test(pathAndQuery)) continue
      if (
        !best ||
        rule.pattern.length > best.pattern.length ||
        (rule.pattern.length === best.pattern.length &&
          rule.allow &&
          !best.allow)
      ) {
        best = rule
      }
    }
  }
  return best ? best.allow : true
}

export function crawlDelaySeconds(
  robots: RobotsTxt,
  token: string,
): number | undefined {
  for (const group of groupsFor(robots, token)) {
    if (group.crawlDelay !== undefined) return group.crawlDelay
  }
  return undefined
}

export function policyAllows(
  policy: RobotsPolicy,
  url: string,
  token: string,
): boolean {
  if (policy.kind === 'allow-all') return true
  if (policy.kind === 'disallow-all') return false
  const parsed = new URL(url)
  return isAllowedByRobots(
    policy.robots,
    `${parsed.pathname}${parsed.search}`,
    token,
  )
}

/**
 * Fetches `<origin>/robots.txt`. 4xx means "no restrictions", 5xx or an
 * unreachable server means "crawl nothing" (RFC 9309, section 2.3.1).
 */
export async function fetchRobotsPolicy(
  origin: string,
  options: Omit<HttpRequestOptions, 'method' | 'maxBytes'>,
): Promise<RobotsPolicy> {
  let url = `${origin}/robots.txt`
  for (let hop = 0; hop <= 5; hop++) {
    let response: Awaited<ReturnType<typeof httpRequest>>
    try {
      response = await httpRequest(url, {
        ...options,
        method: 'GET',
        maxBytes: MAX_ROBOTS_BYTES,
      })
    } catch (error) {
      return {
        kind: 'disallow-all',
        reason: `robots.txt unreachable: ${(error as Error).message}`,
      }
    }
    const { status } = response
    if (status >= 300 && status < 400 && response.headers.location) {
      url = new URL(String(response.headers.location), url).href
      continue
    }
    if (status >= 200 && status < 300) {
      return { kind: 'rules', robots: parseRobotsTxt(response.body || ''), url }
    }
    if (status >= 400 && status < 500) {
      return { kind: 'allow-all', reason: `robots.txt returned ${status}` }
    }
    return {
      kind: 'disallow-all',
      reason: `robots.txt returned ${status}`,
    }
  }
  return { kind: 'allow-all', reason: 'robots.txt redirects too often' }
}
