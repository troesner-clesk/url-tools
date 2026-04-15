// Checks if a URL is safe to fetch (SSRF protection)
export function isAllowedUrl(url: string): boolean {
  try {
    const parsed = new URL(url)

    // Only allow http/https
    if (!['http:', 'https:'].includes(parsed.protocol)) return false

    const hostname = parsed.hostname.toLowerCase()

    // Opt-in escape hatch for crawling localhost — useful in dev for the
    // bundled demo fixtures (e.g. /demo/dead-links.html). Off by default.
    const allowLocalhost = process.env.URL_TOOLS_ALLOW_LOCALHOST === '1'

    // Block localhost
    const isLocalhost =
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname.endsWith('.localhost')
    if (isLocalhost && !allowLocalhost) return false

    // Block private IP ranges
    if (hostname.startsWith('10.')) return false
    if (hostname.startsWith('192.168.')) return false
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return false

    // Block link-local and cloud metadata
    if (hostname.startsWith('169.254.')) return false
    if (hostname === '0.0.0.0') return false

    return true
  } catch {
    return false
  }
}

// Validates an array of URLs and returns only allowed ones
export function filterAllowedUrls(urls: string[]): string[] {
  return urls.filter(isAllowedUrl)
}
