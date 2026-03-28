import { defineEventHandler, readBody } from 'h3'
import * as cheerio from 'cheerio'
import { filterAllowedUrls } from '../utils/url-validator'
import { fetchWithRetry, type RequestSettings } from '../utils/fetch-with-retry'

interface ScrapeJsonRequest {
    urls: string[]
    settings?: RequestSettings
}

interface JsonLdData {
    '@type'?: string
    '@context'?: string
    [key: string]: unknown
}

interface OpenGraphData {
    title?: string
    description?: string
    image?: string
    url?: string
    type?: string
    siteName?: string
    [key: string]: string | undefined
}

interface TwitterCardData {
    card?: string
    title?: string
    description?: string
    image?: string
    site?: string
    [key: string]: string | undefined
}

interface ScrapeJsonResult {
    url: string
    status: number
    jsonLd: JsonLdData[]
    openGraph: OpenGraphData
    twitterCard: TwitterCardData
    meta: {
        title?: string
        description?: string
        canonical?: string
        robots?: string
    }
    error?: string
}

export default defineEventHandler(async (event) => {
    const body = await readBody<ScrapeJsonRequest>(event)

    if (!body.urls || !Array.isArray(body.urls)) {
        throw createError({
            statusCode: 400,
            message: 'urls array required'
        })
    }

    body.urls = filterAllowedUrls(body.urls)

    const settings: RequestSettings = {
        timeout: body.settings?.timeout ?? 30,
        retries: body.settings?.retries ?? 1,
        headers: body.settings?.headers
    }

    const results: ScrapeJsonResult[] = []

    // Parallel with limit (5 concurrent)
    const batchSize = 5
    for (let i = 0; i < body.urls.length; i += batchSize) {
        const batch = body.urls.slice(i, i + batchSize)

        const batchResults = await Promise.all(
            batch.map(async (url): Promise<ScrapeJsonResult> => {
                try {
                    const { response } = await fetchWithRetry(url, settings)

                    const contentLength = parseInt(response.headers.get('content-length') || '0')
                    if (contentLength > 10 * 1024 * 1024) {
                        throw new Error('Response too large (>10MB)')
                    }

                    const html = await response.text()
                    const $ = cheerio.load(html)

                    // Extract JSON-LD
                    const jsonLd: JsonLdData[] = []
                    $('script[type="application/ld+json"]').each((_, el) => {
                        try {
                            const content = $(el).html()
                            if (content) {
                                const parsed = JSON.parse(content)
                                if (Array.isArray(parsed)) {
                                    jsonLd.push(...parsed)
                                } else {
                                    jsonLd.push(parsed)
                                }
                            }
                        } catch {
                            // Invalid JSON, skip
                        }
                    })

                    // Extract Open Graph
                    const openGraph: OpenGraphData = {}
                    $('meta[property^="og:"]').each((_, el) => {
                        const property = $(el).attr('property')?.replace('og:', '')
                        const content = $(el).attr('content')
                        if (property && content) {
                            openGraph[property] = content
                        }
                    })

                    // Extract Twitter Card
                    const twitterCard: TwitterCardData = {}
                    $('meta[name^="twitter:"]').each((_, el) => {
                        const name = $(el).attr('name')?.replace('twitter:', '')
                        const content = $(el).attr('content')
                        if (name && content) {
                            twitterCard[name] = content
                        }
                    })

                    // Standard meta tags
                    const meta = {
                        title: $('title').first().text() || undefined,
                        description: $('meta[name="description"]').attr('content') || undefined,
                        canonical: $('link[rel="canonical"]').attr('href') || undefined,
                        robots: $('meta[name="robots"]').attr('content') || undefined
                    }

                    return {
                        url,
                        status: response.status,
                        jsonLd,
                        openGraph,
                        twitterCard,
                        meta
                    }
                } catch (error) {
                    return {
                        url,
                        status: 0,
                        jsonLd: [],
                        openGraph: {},
                        twitterCard: {},
                        meta: {},
                        error: error instanceof Error ? error.message : 'Unknown error'
                    }
                }
            })
        )

        results.push(...batchResults)
    }

    return { results }
})
