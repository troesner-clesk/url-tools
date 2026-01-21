import { defineEventHandler, readBody } from 'h3'
import { extractLinks, getRedirectChain, formatRedirectChain, isInternalLink, normalizeUrl } from '../utils/link-analyzer'

interface ScrapeLinksRequest {
    urls: string[]
    recursive: boolean
    maxUrls: number
    maxDepth: number
    rateLimit: number
    sameDomainOnly: boolean
}

interface LinkResult {
    sourceUrl: string
    targetUrl: string
    status: number
    redirectChain: string
    type: 'internal' | 'external'
    anchorText: string
    rel: string
    depth: number
    error?: string
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
}

export default defineEventHandler(async (event) => {
    const body = await readBody<ScrapeLinksRequest>(event)

    if (!body.urls || !Array.isArray(body.urls)) {
        throw createError({
            statusCode: 400,
            message: 'urls array required'
        })
    }

    const results: LinkResult[] = []
    const visited = new Set<string>()
    const queue: Array<{ url: string; depth: number; sourceUrl?: string }> = []

    // Seed URLs zur Queue
    for (const url of body.urls) {
        const normalized = normalizeUrl(url)
        if (normalized && !visited.has(normalized)) {
            queue.push({ url: normalized, depth: 0 })
            visited.add(normalized)
        }
    }

    // Basis-Domain für Same-Domain-Check
    const baseDomains = new Set(
        body.urls.map(url => {
            try {
                return new URL(url).hostname
            } catch {
                return null
            }
        }).filter(Boolean)
    )

    const delayMs = 1000 / body.rateLimit // z.B. 500ms bei 2 req/s

    while (queue.length > 0 && results.length < body.maxUrls) {
        const item = queue.shift()!

        try {
            // Rate Limiting
            if (results.length > 0) {
                await sleep(delayMs)
            }

            // Seite fetchen
            const response = await fetch(item.url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; HTMLScraper/1.0)'
                },
                signal: AbortSignal.timeout(30000)
            })

            const html = await response.text()
            const links = extractLinks(html, item.url)

            // Links verarbeiten
            for (const link of links) {
                if (results.length >= body.maxUrls) break

                // Status und Redirect-Kette prüfen
                const redirectInfo = await getRedirectChain(link.targetUrl)

                const result: LinkResult = {
                    sourceUrl: item.url,
                    targetUrl: link.targetUrl,
                    status: redirectInfo.finalStatus,
                    redirectChain: formatRedirectChain(redirectInfo.chain),
                    type: link.isInternal ? 'internal' : 'external',
                    anchorText: link.anchorText,
                    rel: link.rel.join(', '),
                    depth: item.depth,
                    error: redirectInfo.error
                }

                results.push(result)

                // Rekursiv crawlen?
                if (body.recursive &&
                    link.isInternal &&
                    item.depth < body.maxDepth &&
                    !visited.has(link.targetUrl)) {

                    // Same-Domain Check
                    const targetDomain = new URL(link.targetUrl).hostname
                    if (!body.sameDomainOnly || baseDomains.has(targetDomain)) {
                        visited.add(link.targetUrl)
                        queue.push({ url: link.targetUrl, depth: item.depth + 1 })
                    }
                }

                // Rate Limiting zwischen Link-Checks
                await sleep(delayMs / 2)
            }
        } catch (error) {
            results.push({
                sourceUrl: item.sourceUrl || item.url,
                targetUrl: item.url,
                status: 0,
                redirectChain: '',
                type: 'internal',
                anchorText: '',
                rel: '',
                depth: item.depth,
                error: error instanceof Error ? error.message : 'Unknown error'
            })
        }
    }

    return {
        results,
        stats: {
            totalLinks: results.length,
            visited: visited.size,
            remaining: queue.length
        }
    }
})
