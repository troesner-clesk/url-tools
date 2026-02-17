import { defineEventHandler, readBody } from 'h3'
import * as cheerio from 'cheerio'
import { filterAllowedUrls } from '../utils/url-validator'

interface RequestSettings {
    timeout: number      // seconds
    retries: number      // 0-3
    proxy?: string       // optional: http://host:port
    headers?: Record<string, string>  // custom headers
}

interface ScrapeHtmlRequest {
    urls: string[]
    cssSelector?: string
    settings?: RequestSettings
}

interface ScrapeHtmlResult {
    url: string
    status: number
    contentType: string
    size: number
    html: string
    error?: string
    retryCount?: number
}

// Fetch with retry logic
async function fetchWithRetry(
    url: string,
    settings: RequestSettings
): Promise<{ response: Response; retryCount: number }> {
    const { timeout, retries, proxy, headers } = settings
    let lastError: Error | null = null

    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const controller = new AbortController()
            const timeoutId = setTimeout(() => controller.abort(), timeout * 1000)

            const fetchOptions: RequestInit = {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; URLTools/1.0)',
                    ...headers
                },
                signal: controller.signal
            }

            // Proxy support (server-side only)
            // Note: Native fetch doesn't support proxy directly,
            // could use undici or node-fetch-with-proxy if needed

            const response = await fetch(url, fetchOptions)
            clearTimeout(timeoutId)

            // Retry on 5xx errors
            if (response.status >= 500 && attempt < retries) {
                lastError = new Error(`Server error: ${response.status}`)
                await new Promise(r => setTimeout(r, 1000 * (attempt + 1))) // Exponential backoff
                continue
            }

            return { response, retryCount: attempt }
        } catch (error) {
            lastError = error instanceof Error ? error : new Error('Unknown error')

            // Timeout or network error: retry
            if (attempt < retries) {
                await new Promise(r => setTimeout(r, 1000 * (attempt + 1)))
                continue
            }
        }
    }

    throw lastError
}

export default defineEventHandler(async (event) => {
    const body = await readBody<ScrapeHtmlRequest>(event)

    if (!body.urls || !Array.isArray(body.urls)) {
        throw createError({
            statusCode: 400,
            message: 'urls array required'
        })
    }

    body.urls = filterAllowedUrls(body.urls)

    // Default settings
    const settings: RequestSettings = {
        timeout: body.settings?.timeout ?? 30,
        retries: body.settings?.retries ?? 1,
        proxy: body.settings?.proxy,
        headers: body.settings?.headers
    }

    const results: ScrapeHtmlResult[] = []
    const cssSelector = body.cssSelector?.trim() || ''

    // Parallel with limit (5 concurrent)
    const batchSize = 5
    for (let i = 0; i < body.urls.length; i += batchSize) {
        const batch = body.urls.slice(i, i + batchSize)

        const batchResults = await Promise.all(
            batch.map(async (url): Promise<ScrapeHtmlResult> => {
                try {
                    const { response, retryCount } = await fetchWithRetry(url, settings)

                    let html = await response.text()

                    // Apply CSS selector if provided
                    if (cssSelector) {
                        const $ = cheerio.load(html)
                        const selected = $(cssSelector)
                        if (selected.length > 0) {
                            html = selected.map((_, el) => $.html(el)).get().join('\n')
                        } else {
                            html = `<!-- No element found for selector: ${cssSelector} -->\n${html}`
                        }
                    }

                    return {
                        url,
                        status: response.status,
                        contentType: response.headers.get('content-type') || 'unknown',
                        size: html.length,
                        html,
                        retryCount
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
