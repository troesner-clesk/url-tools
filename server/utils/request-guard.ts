/**
 * Protects the local API and the MCP endpoint against other websites open in
 * the same browser: cross-site requests (CSRF-style "simple" POSTs need no
 * preflight), other local web apps on another port (browsers treat them as
 * "same-site") and DNS rebinding (an attacker domain resolving to 127.0.0.1).
 * See ADR-013. Non-browser clients (curl, MCP clients) send no Origin and a
 * local Host header and pass.
 */

const LOCAL_HOSTNAMES = ['localhost', '127.0.0.1', '[::1]', '::1']

export interface GuardInput {
  host?: string
  origin?: string
  fetchSite?: string
}

export type GuardVerdict = { ok: true } | { ok: false; reason: string }

/** Extra hosts from URL_TOOLS_ALLOWED_HOSTS; `*` disables the host check. */
function configuredHosts(): { any: boolean; extra: Set<string> } {
  const extra = (process.env.URL_TOOLS_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
  return { any: extra.includes('*'), extra: new Set(extra) }
}

/** "localhost:3000" → "localhost", "[::1]:3000" → "[::1]". */
export function hostnameFromHostHeader(host: string): string {
  const value = host.trim().toLowerCase()
  if (value.startsWith('[')) {
    const end = value.indexOf(']')
    return end === -1 ? value : value.slice(0, end + 1)
  }
  return value.split(':')[0] ?? value
}

function isLocalOrConfigured(hostname: string): boolean {
  const { any, extra } = configuredHosts()
  return (
    any ||
    extra.has(hostname) ||
    LOCAL_HOSTNAMES.includes(hostname) ||
    hostname.endsWith('.localhost')
  )
}

export function checkLocalRequest(input: GuardInput): GuardVerdict {
  if (input.host && !isLocalOrConfigured(hostnameFromHostHeader(input.host))) {
    return {
      ok: false,
      reason:
        'Host not allowed (DNS rebinding protection). Add it to URL_TOOLS_ALLOWED_HOSTS to access url-tools under this name.',
    }
  }
  // Another port on localhost counts as "same-site" for browsers, so only the
  // url-tools page itself ("same-origin") and direct navigation ("none") pass.
  if (
    input.fetchSite &&
    input.fetchSite !== 'same-origin' &&
    input.fetchSite !== 'none'
  ) {
    return {
      ok: false,
      reason: `Request from another site blocked (${input.fetchSite})`,
    }
  }
  if (input.origin !== undefined) {
    if (input.origin === 'null') {
      return { ok: false, reason: 'Opaque origin blocked' }
    }
    let origin: URL
    try {
      origin = new URL(input.origin)
    } catch {
      return { ok: false, reason: 'Invalid Origin header' }
    }
    const { any, extra } = configuredHosts()
    const explicitlyAllowed = any || extra.has(origin.hostname.toLowerCase())
    // Without an explicit allowlist entry the Origin must be exactly the
    // server's own origin (same host and port).
    const sameAuthority =
      input.host !== undefined &&
      origin.host.toLowerCase() === input.host.trim().toLowerCase()
    if (!explicitlyAllowed && !sameAuthority) {
      return { ok: false, reason: 'Origin not allowed' }
    }
  }
  return { ok: true }
}

/** Paths the guard applies to: the JSON API and the MCP endpoint. */
export function isGuardedPath(path: string): boolean {
  const pathname = path.split('?')[0] ?? ''
  return (
    pathname.startsWith('/api/') || pathname === '/mcp' || pathname === '/mcp/'
  )
}
