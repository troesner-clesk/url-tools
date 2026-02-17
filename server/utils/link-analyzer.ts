import * as cheerio from 'cheerio'

export interface LinkInfo {
    sourceUrl: string
    targetUrl: string
    anchorText: string
    rel: string[]
    isInternal: boolean
}

export interface RedirectStep {
    url: string
    status: number
}

/**
 * Checks if a link is internal (same domain)
 */
export function isInternalLink(baseUrl: string, targetUrl: string): boolean {
    try {
        const base = new URL(baseUrl)
        const target = new URL(targetUrl, baseUrl)
        return base.hostname === target.hostname
    } catch {
        return false
    }
}

/**
 * Normalizes a URL (removes fragment, trailing slash)
 */
export function normalizeUrl(url: string, baseUrl?: string): string | null {
    try {
        const parsed = new URL(url, baseUrl)
        // Remove fragment
        parsed.hash = ''
        // Normalize trailing slash (except for root)
        let normalized = parsed.href
        if (normalized.endsWith('/') && parsed.pathname !== '/') {
            normalized = normalized.slice(0, -1)
        }
        return normalized
    } catch {
        return null
    }
}

/**
 * Follows redirects and returns the chain
 */
export async function getRedirectChain(url: string, maxRedirects = 10, timeoutMs = 10000): Promise<{
    chain: RedirectStep[]
    finalUrl: string
    finalStatus: number
    error?: string
}> {
    const chain: RedirectStep[] = []
    let currentUrl = url
    let redirectCount = 0

    while (redirectCount < maxRedirects) {
        try {
            const controller = new AbortController()
            const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

            const response = await fetch(currentUrl, {
                method: 'HEAD',
                redirect: 'manual',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; URLTools/1.0)'
                },
                signal: controller.signal
            })

            clearTimeout(timeoutId)

            chain.push({ url: currentUrl, status: response.status })

            // Redirect?
            if (response.status >= 300 && response.status < 400) {
                const location = response.headers.get('location')
                if (location) {
                    currentUrl = new URL(location, currentUrl).href
                    redirectCount++
                    continue
                }
            }

            // No more redirects
            return {
                chain,
                finalUrl: currentUrl,
                finalStatus: response.status
            }
        } catch (error) {
            const errorMsg = error instanceof Error
                ? (error.name === 'AbortError' ? 'Timeout' : error.message)
                : 'Unknown error'
            return {
                chain,
                finalUrl: currentUrl,
                finalStatus: 0,
                error: errorMsg
            }
        }
    }

    return {
        chain,
        finalUrl: currentUrl,
        finalStatus: 0,
        error: 'Too many redirects'
    }
}

/**
 * Checks if the content is an XML sitemap
 */
export function isSitemap(html: string): boolean {
    const trimmed = html.trim().toLowerCase()
    return trimmed.startsWith('<?xml') ||
        trimmed.includes('<urlset') ||
        trimmed.includes('<sitemapindex')
}

/**
 * Extracts URLs from an XML sitemap
 */
export function extractLinksFromSitemap(xml: string, baseUrl: string): LinkInfo[] {
    const $ = cheerio.load(xml, { xmlMode: true })
    const links: LinkInfo[] = []
    const seenUrls = new Set<string>()

    // Extract URLs from <loc> tags (urlset sitemaps)
    $('loc').each((_, element) => {
        const url = $(element).text().trim()
        if (!url) return

        const normalizedUrl = normalizeUrl(url)
        if (!normalizedUrl) return

        if (seenUrls.has(normalizedUrl)) return
        seenUrls.add(normalizedUrl)

        links.push({
            sourceUrl: baseUrl,
            targetUrl: normalizedUrl,
            anchorText: '',
            rel: [],
            isInternal: isInternalLink(baseUrl, normalizedUrl)
        })
    })

    return links
}

/**
 * Extracts all links from HTML or sitemap
 */
export function extractLinks(html: string, baseUrl: string): LinkInfo[] {
    // Check if it's a sitemap
    if (isSitemap(html)) {
        return extractLinksFromSitemap(html, baseUrl)
    }

    // Standard HTML extraction
    const $ = cheerio.load(html)
    const links: LinkInfo[] = []
    const seenUrls = new Set<string>()

    $('a[href]').each((_, element) => {
        const href = $(element).attr('href')
        if (!href) return

        // Ignore javascript:, mailto:, tel:, etc.
        if (href.startsWith('javascript:') || href.startsWith('mailto:') ||
            href.startsWith('tel:') || href.startsWith('#')) {
            return
        }

        const normalizedUrl = normalizeUrl(href, baseUrl)
        if (!normalizedUrl) return

        // Avoid duplicates
        if (seenUrls.has(normalizedUrl)) return
        seenUrls.add(normalizedUrl)

        const relAttr = $(element).attr('rel') || ''
        const relValues = relAttr.split(/\s+/).filter(Boolean)

        links.push({
            sourceUrl: baseUrl,
            targetUrl: normalizedUrl,
            anchorText: $(element).text().trim().substring(0, 200),
            rel: relValues,
            isInternal: isInternalLink(baseUrl, normalizedUrl)
        })
    })

    return links
}

/**
 * Formats redirect chain as string
 */
export function formatRedirectChain(chain: RedirectStep[]): string {
    return chain.map(step => step.status.toString()).join(' → ')
}
