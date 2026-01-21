import { defineEventHandler, readBody } from 'h3'
import * as cheerio from 'cheerio'

interface ScrapeHtmlRequest {
    urls: string[]
    cssSelector?: string
}

interface ScrapeHtmlResult {
    url: string
    status: number
    contentType: string
    size: number
    html: string
    error?: string
}

export default defineEventHandler(async (event) => {
    const body = await readBody<ScrapeHtmlRequest>(event)

    if (!body.urls || !Array.isArray(body.urls)) {
        throw createError({
            statusCode: 400,
            message: 'urls array required'
        })
    }

    const results: ScrapeHtmlResult[] = []
    const cssSelector = body.cssSelector?.trim() || ''

    // Parallel mit Limit (5 gleichzeitig)
    const batchSize = 5
    for (let i = 0; i < body.urls.length; i += batchSize) {
        const batch = body.urls.slice(i, i + batchSize)

        const batchResults = await Promise.all(
            batch.map(async (url): Promise<ScrapeHtmlResult> => {
                try {
                    const response = await fetch(url, {
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (compatible; HTMLScraper/1.0)'
                        },
                        signal: AbortSignal.timeout(30000) // 30s timeout
                    })

                    let html = await response.text()

                    // CSS-Selector anwenden wenn vorhanden
                    if (cssSelector) {
                        const $ = cheerio.load(html)
                        const selected = $(cssSelector)
                        if (selected.length > 0) {
                            // Alle gefundenen Elemente sammeln
                            html = selected.map((_, el) => $.html(el)).get().join('\n')
                        } else {
                            // Kein Match gefunden
                            html = `<!-- Kein Element gefunden für Selector: ${cssSelector} -->\n${html}`
                        }
                    }

                    return {
                        url,
                        status: response.status,
                        contentType: response.headers.get('content-type') || 'unknown',
                        size: html.length,
                        html
                    }
                } catch (error) {
                    return {
                        url,
                        status: 0,
                        contentType: 'error',
                        size: 0,
                        html: '',
                        error: error instanceof Error ? error.message : 'Unknown error'
                    }
                }
            })
        )

        results.push(...batchResults)
    }

    return { results }
})
