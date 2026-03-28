import * as cheerio from 'cheerio'
import { defineEventHandler, readBody } from 'h3'
import { fetchWithRetry, type RequestSettings } from '../utils/fetch-with-retry'
import { filterAllowedUrls } from '../utils/url-validator'

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

export default defineEventHandler(async (event) => {
  const body = await readBody<ScrapeHtmlRequest>(event)

  if (!body.urls || !Array.isArray(body.urls)) {
    throw createError({
      statusCode: 400,
      message: 'urls array required',
    })
  }

  body.urls = filterAllowedUrls(body.urls)

  // Default settings
  const settings: RequestSettings = {
    timeout: body.settings?.timeout ?? 30,
    retries: body.settings?.retries ?? 1,
    proxy: body.settings?.proxy,
    headers: body.settings?.headers,
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

          const contentLength = parseInt(
            response.headers.get('content-length') || '0',
            10,
          )
          if (contentLength > 10 * 1024 * 1024) {
            throw new Error('Response too large (>10MB)')
          }

          let html = await response.text()

          // Apply CSS selector if provided
          if (cssSelector) {
            const $ = cheerio.load(html)
            const selected = $(cssSelector)
            if (selected.length > 0) {
              html = selected
                .map((_, el) => $.html(el))
                .get()
                .join('\n')
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
            retryCount,
          }
        } catch (error) {
          return {
            url,
            status: 0,
            contentType: 'error',
            size: 0,
            html: '',
            error: error instanceof Error ? error.message : 'Unknown error',
          }
        }
      }),
    )

    results.push(...batchResults)
  }

  return { results }
})
