import { defineEventHandler, readBody } from 'h3'
import * as cheerio from 'cheerio'
import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import Papa from 'papaparse'
import { filterAllowedUrls } from '../utils/url-validator'

interface RequestSettings {
    timeout: number
    retries: number
    headers?: Record<string, string>
}

interface SeoAuditRequest {
    urls: string[]  // Bulk-Modus: Array von URLs
    url?: string    // Legacy: Einzelne URL (wird zu urls konvertiert)
    checkLinks?: boolean
    settings?: RequestSettings
    saveResults?: boolean
}

interface HeadingInfo {
    tag: string
    text: string
    count: number
}

interface LinkInfo {
    href: string
    text: string
    status: number
    isInternal: boolean
    isBroken: boolean
}

interface SeoAuditResult {
    url: string
    status: number
    loadTime: number
    size: number

    // Meta
    title: {
        text: string
        length: number
        isGood: boolean
    }
    description: {
        text: string
        length: number
        isGood: boolean
    }
    canonical: string | null
    robots: string | null

    // Headings
    headings: HeadingInfo[]
    h1Count: number
    hasMultipleH1: boolean

    // Images
    imagesWithoutAlt: number
    totalImages: number

    // Links
    internalLinks: number
    externalLinks: number
    brokenLinks: LinkInfo[]

    // Performance
    hasViewport: boolean
    hasCharset: boolean
    hasFavicon: boolean

    // Schema
    hasJsonLd: boolean
    hasOpenGraph: boolean
    hasTwitterCard: boolean

    // Score
    score: number
    issues: string[]

    error?: string
}

async function fetchWithRetry(
    url: string,
    settings: RequestSettings
): Promise<{ response: Response; loadTime: number }> {
    const { timeout, retries, headers } = settings
    let lastError: Error | null = null

    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const startTime = Date.now()
            const controller = new AbortController()
            const timeoutId = setTimeout(() => controller.abort(), timeout * 1000)

            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; HTMLScraper/1.0)',
                    ...headers
                },
                signal: controller.signal
            })
            clearTimeout(timeoutId)
            const loadTime = Date.now() - startTime

            if (response.status >= 500 && attempt < retries) {
                lastError = new Error(`Server error: ${response.status}`)
                await new Promise(r => setTimeout(r, 1000 * (attempt + 1)))
                continue
            }

            return { response, loadTime }
        } catch (error) {
            lastError = error instanceof Error ? error : new Error('Unknown error')
            if (attempt < retries) {
                await new Promise(r => setTimeout(r, 1000 * (attempt + 1)))
                continue
            }
        }
    }

    throw lastError
}

async function checkLinkStatus(url: string): Promise<number> {
    try {
        const response = await fetch(url, {
            method: 'HEAD',
            signal: AbortSignal.timeout(5000)
        })
        return response.status
    } catch {
        return 0
    }
}

// Einzelne URL auditieren
async function auditUrl(
    url: string,
    checkLinks: boolean,
    settings: RequestSettings
): Promise<SeoAuditResult> {
    try {
        const { response, loadTime } = await fetchWithRetry(url, settings)
        const html = await response.text()
        const $ = cheerio.load(html)
        const issues: string[] = []
        let score = 100

        // Title
        const titleText = $('title').first().text().trim()
        const titleLength = titleText.length
        const titleIsGood = titleLength >= 30 && titleLength <= 60
        if (!titleText) {
            issues.push('Kein Title-Tag gefunden')
            score -= 15
        } else if (titleLength < 30) {
            issues.push('Title zu kurz (< 30 Zeichen)')
            score -= 5
        } else if (titleLength > 60) {
            issues.push('Title zu lang (> 60 Zeichen)')
            score -= 5
        }

        // Description
        const descText = $('meta[name="description"]').attr('content')?.trim() || ''
        const descLength = descText.length
        const descIsGood = descLength >= 120 && descLength <= 160
        if (!descText) {
            issues.push('Keine Meta-Description gefunden')
            score -= 10
        } else if (descLength < 120) {
            issues.push('Meta-Description zu kurz (< 120 Zeichen)')
            score -= 3
        } else if (descLength > 160) {
            issues.push('Meta-Description zu lang (> 160 Zeichen)')
            score -= 3
        }

        // Canonical
        const canonical = $('link[rel="canonical"]').attr('href') || null
        if (!canonical) {
            issues.push('Kein Canonical-Tag gefunden')
            score -= 5
        }

        // Robots
        const robots = $('meta[name="robots"]').attr('content') || null

        // Headings
        const headings: HeadingInfo[] = []
        const headingCounts: Record<string, number> = {}

        $('h1, h2, h3, h4, h5, h6').each((_, el) => {
            const tag = el.tagName.toLowerCase()
            const text = $(el).text().trim().substring(0, 100)
            headingCounts[tag] = (headingCounts[tag] || 0) + 1
            headings.push({ tag, text, count: headingCounts[tag] })
        })

        const h1Count = headingCounts['h1'] || 0
        if (h1Count === 0) {
            issues.push('Kein H1-Tag gefunden')
            score -= 10
        } else if (h1Count > 1) {
            issues.push(`Mehrere H1-Tags gefunden (${h1Count})`)
            score -= 5
        }

        // Images
        const images = $('img')
        const totalImages = images.length
        let imagesWithoutAlt = 0
        images.each((_, el) => {
            if (!$(el).attr('alt')) {
                imagesWithoutAlt++
            }
        })
        if (imagesWithoutAlt > 0) {
            issues.push(`${imagesWithoutAlt} Bilder ohne Alt-Text`)
            score -= Math.min(imagesWithoutAlt * 2, 10)
        }

        // Links
        const baseUrl = new URL(url)
        const links = $('a[href]')
        let internalLinks = 0
        let externalLinks = 0
        const brokenLinks: LinkInfo[] = []

        links.each((_, el) => {
            const href = $(el).attr('href')
            if (!href || href.startsWith('#') || href.startsWith('javascript:')) return

            try {
                const linkUrl = new URL(href, url)
                if (linkUrl.hostname === baseUrl.hostname) {
                    internalLinks++
                } else {
                    externalLinks++
                }
            } catch {
                // Invalid URL
            }
        })

        // Check broken links (optional, limited)
        if (checkLinks) {
            const linksToCheck = $('a[href]').slice(0, 20) // Max 20 Links
            for (let i = 0; i < linksToCheck.length; i++) {
                const el = linksToCheck[i]
                const href = $(el).attr('href')
                const text = $(el).text().trim().substring(0, 50)
                if (!href || href.startsWith('#') || href.startsWith('javascript:')) continue

                try {
                    const linkUrl = new URL(href, url)
                    const status = await checkLinkStatus(linkUrl.href)
                    if (status >= 400 || status === 0) {
                        brokenLinks.push({
                            href: linkUrl.href,
                            text,
                            status,
                            isInternal: linkUrl.hostname === baseUrl.hostname,
                            isBroken: true
                        })
                    }
                } catch {
                    // Invalid URL
                }
            }
            if (brokenLinks.length > 0) {
                issues.push(`${brokenLinks.length} fehlerhafte Links gefunden`)
                score -= Math.min(brokenLinks.length * 3, 15)
            }
        }

        // Technical
        const hasViewport = $('meta[name="viewport"]').length > 0
        const hasCharset = $('meta[charset]').length > 0 || $('meta[http-equiv="Content-Type"]').length > 0
        const hasFavicon = $('link[rel="icon"], link[rel="shortcut icon"]').length > 0

        if (!hasViewport) {
            issues.push('Kein Viewport-Meta-Tag')
            score -= 5
        }

        // Schema/Social
        const hasJsonLd = $('script[type="application/ld+json"]').length > 0
        const hasOpenGraph = $('meta[property^="og:"]').length > 0
        const hasTwitterCard = $('meta[name^="twitter:"]').length > 0

        if (!hasJsonLd) {
            issues.push('Kein JSON-LD Schema gefunden')
            score -= 3
        }
        if (!hasOpenGraph) {
            issues.push('Keine Open Graph Tags')
            score -= 3
        }

        // Ensure score is between 0-100
        score = Math.max(0, Math.min(100, score))

        return {
            url,
            status: response.status,
            loadTime,
            size: html.length,
            title: { text: titleText, length: titleLength, isGood: titleIsGood },
            description: { text: descText, length: descLength, isGood: descIsGood },
            canonical,
            robots,
            headings,
            h1Count,
            hasMultipleH1: h1Count > 1,
            imagesWithoutAlt,
            totalImages,
            internalLinks,
            externalLinks,
            brokenLinks,
            hasViewport,
            hasCharset,
            hasFavicon,
            hasJsonLd,
            hasOpenGraph,
            hasTwitterCard,
            score,
            issues
        }

    } catch (error) {
        return {
            url,
            status: 0,
            loadTime: 0,
            size: 0,
            title: { text: '', length: 0, isGood: false },
            description: { text: '', length: 0, isGood: false },
            canonical: null,
            robots: null,
            headings: [],
            h1Count: 0,
            hasMultipleH1: false,
            imagesWithoutAlt: 0,
            totalImages: 0,
            internalLinks: 0,
            externalLinks: 0,
            brokenLinks: [],
            hasViewport: false,
            hasCharset: false,
            hasFavicon: false,
            hasJsonLd: false,
            hasOpenGraph: false,
            hasTwitterCard: false,
            score: 0,
            issues: [],
            error: error instanceof Error ? error.message : 'Unknown error'
        }
    }
}

function getTimestamp(): string {
    return new Date().toISOString()
        .replace(/[:.]/g, '-')
        .replace('T', '_')
        .slice(0, 19)
}

export default defineEventHandler(async (event) => {
    const body = await readBody<SeoAuditRequest>(event)

    // URLs sammeln (Legacy-Support für einzelne URL)
    const urls = filterAllowedUrls(body.urls || (body.url ? [body.url] : []))

    if (urls.length === 0) {
        throw createError({
            statusCode: 400,
            message: 'urls array or url required'
        })
    }

    const settings: RequestSettings = {
        timeout: body.settings?.timeout ?? 30,
        retries: body.settings?.retries ?? 1,
        headers: body.settings?.headers
    }

    const results: SeoAuditResult[] = []

    // Alle URLs auditieren
    for (const url of urls) {
        const result = await auditUrl(url, body.checkLinks ?? false, settings)
        results.push(result)
    }

    // Ergebnisse speichern wenn gewünscht
    let savedFiles: string[] = []
    if (body.saveResults && results.length > 0) {
        const timestamp = getTimestamp()
        const outputDir = join(process.cwd(), 'output', 'seo-audit')
        await mkdir(outputDir, { recursive: true })

        // JSON speichern
        const jsonPath = join(outputDir, `${timestamp}_seo-audit.json`)
        await writeFile(jsonPath, JSON.stringify(results, null, 2), 'utf-8')
        savedFiles.push(jsonPath)

        // CSV für Übersicht
        const csvData = results.map(r => ({
            url: r.url,
            status: r.status,
            score: r.score,
            loadTime: r.loadTime,
            size: r.size,
            title: r.title.text,
            titleLength: r.title.length,
            description: r.description.text.substring(0, 100),
            descriptionLength: r.description.length,
            h1Count: r.h1Count,
            internalLinks: r.internalLinks,
            externalLinks: r.externalLinks,
            imagesWithoutAlt: r.imagesWithoutAlt,
            hasViewport: r.hasViewport,
            hasJsonLd: r.hasJsonLd,
            hasOpenGraph: r.hasOpenGraph,
            issuesCount: r.issues.length,
            error: r.error || ''
        }))
        const csvPath = join(outputDir, `${timestamp}_seo-audit.csv`)
        const csv = Papa.unparse(csvData)
        await writeFile(csvPath, csv, 'utf-8')
        savedFiles.push(csvPath)
    }

    // Bei einzelner URL: direkt das Ergebnis zurückgeben (Legacy-Kompatibilität)
    if (urls.length === 1 && !body.urls) {
        return results[0]
    }

    // Bei Bulk: Array + Stats zurückgeben
    return {
        results,
        savedFiles,
        stats: {
            total: results.length,
            success: results.filter(r => !r.error).length,
            failed: results.filter(r => r.error).length,
            avgScore: Math.round(results.reduce((sum, r) => sum + r.score, 0) / results.length)
        }
    }
})
