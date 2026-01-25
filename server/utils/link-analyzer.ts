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
 * Prüft ob ein Link intern ist (same domain)
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
 * Normalisiert eine URL (entfernt Fragment, trailing slash)
 */
export function normalizeUrl(url: string, baseUrl?: string): string | null {
    try {
        const parsed = new URL(url, baseUrl)
        // Fragment entfernen
        parsed.hash = ''
        // Trailing slash normalisieren (außer bei root)
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
 * Folgt Redirects und gibt die Kette zurück
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
                    'User-Agent': 'Mozilla/5.0 (compatible; HTMLScraper/1.0)'
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

            // Kein Redirect mehr
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
 * Prüft ob es sich um eine XML-Sitemap handelt
 */
export function isSitemap(html: string): boolean {
    const trimmed = html.trim().toLowerCase()
    return trimmed.startsWith('<?xml') ||
        trimmed.includes('<urlset') ||
        trimmed.includes('<sitemapindex')
}

/**
 * Extrahiert URLs aus einer XML-Sitemap
 */
export function extractLinksFromSitemap(xml: string, baseUrl: string): LinkInfo[] {
    const $ = cheerio.load(xml, { xmlMode: true })
    const links: LinkInfo[] = []
    const seenUrls = new Set<string>()

    // URLs aus <loc> Tags extrahieren (urlset Sitemaps)
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
 * Extrahiert alle Links aus HTML oder Sitemap
 */
export function extractLinks(html: string, baseUrl: string): LinkInfo[] {
    // Prüfen ob es eine Sitemap ist
    if (isSitemap(html)) {
        return extractLinksFromSitemap(html, baseUrl)
    }

    // Normale HTML-Extraktion
    const $ = cheerio.load(html)
    const links: LinkInfo[] = []
    const seenUrls = new Set<string>()

    $('a[href]').each((_, element) => {
        const href = $(element).attr('href')
        if (!href) return

        // Ignoriere javascript:, mailto:, tel:, etc.
        if (href.startsWith('javascript:') || href.startsWith('mailto:') ||
            href.startsWith('tel:') || href.startsWith('#')) {
            return
        }

        const normalizedUrl = normalizeUrl(href, baseUrl)
        if (!normalizedUrl) return

        // Duplikate vermeiden
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
 * Formatiert Redirect-Kette als String
 */
export function formatRedirectChain(chain: RedirectStep[]): string {
    return chain.map(step => step.status.toString()).join(' → ')
}
