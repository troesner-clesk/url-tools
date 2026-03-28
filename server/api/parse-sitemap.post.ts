import * as cheerio from 'cheerio'
import { createError, defineEventHandler, readBody } from 'h3'
import { fetchWithRetry, type RequestSettings } from '../utils/fetch-with-retry'
import { isAllowedUrl } from '../utils/url-validator'

interface ParseSitemapRequest {
  url: string
  recursive?: boolean
}

interface SitemapEntry {
  loc: string
  lastmod?: string
  changefreq?: string
  priority?: string
  source: string
}

interface ParseSitemapResponse {
  urls: SitemapEntry[]
  stats: {
    total: number
    sitemaps: number
  }
}

const MAX_SITEMAPS = 50
const MAX_ENTRIES = 50000
const MAX_BODY_SIZE = 10 * 1024 * 1024 // 10 MB

function parseSitemapXml(
  xml: string,
  sourceUrl: string,
): { entries: SitemapEntry[]; childSitemaps: string[] } {
  const $ = cheerio.load(xml, { xmlMode: true })
  const entries: SitemapEntry[] = []
  const childSitemaps: string[] = []
  const seenLocs = new Set<string>()

  // Check for <sitemapindex> with child <sitemap> elements
  $('sitemapindex > sitemap > loc').each((_, el) => {
    const loc = $(el).text().trim()
    if (loc && !seenLocs.has(loc)) {
      seenLocs.add(loc)
      childSitemaps.push(loc)
    }
  })

  // Extract <url> entries from <urlset>
  $('urlset > url').each((_, el) => {
    const loc = $('loc', el).text().trim()
    if (!loc) return
    if (seenLocs.has(loc)) return
    seenLocs.add(loc)

    entries.push({
      loc,
      lastmod: $('lastmod', el).text().trim() || undefined,
      changefreq: $('changefreq', el).text().trim() || undefined,
      priority: $('priority', el).text().trim() || undefined,
      source: sourceUrl,
    })
  })

  return { entries, childSitemaps }
}

export default defineEventHandler(
  async (event): Promise<ParseSitemapResponse> => {
    const body = await readBody<ParseSitemapRequest>(event)

    if (!body.url || typeof body.url !== 'string') {
      throw createError({
        statusCode: 400,
        message: 'url is required',
      })
    }

    const url = body.url.trim()

    if (!isAllowedUrl(url)) {
      throw createError({
        statusCode: 400,
        message: 'URL is not allowed (blocked by SSRF protection)',
      })
    }

    const recursive = body.recursive === true

    const settings: RequestSettings = {
      timeout: 30,
      retries: 2,
    }

    const allEntries: SitemapEntry[] = []
    const fetchedSitemaps = new Set<string>()
    const queue: string[] = [url]

    while (
      queue.length > 0 &&
      fetchedSitemaps.size < MAX_SITEMAPS &&
      allEntries.length < MAX_ENTRIES
    ) {
      const currentUrl = queue.shift()!

      // Avoid re-fetching the same sitemap
      if (fetchedSitemaps.has(currentUrl)) continue
      fetchedSitemaps.add(currentUrl)

      // SSRF check on each URL before fetching
      if (!isAllowedUrl(currentUrl)) continue

      try {
        const { response } = await fetchWithRetry(currentUrl, settings)

        // Guard against oversized responses
        const contentLength = parseInt(
          response.headers.get('content-length') || '0',
          10,
        )
        if (contentLength > MAX_BODY_SIZE) {
          continue
        }

        const xml = await response.text()

        if (xml.length > MAX_BODY_SIZE) {
          continue
        }

        const { entries, childSitemaps } = parseSitemapXml(xml, currentUrl)

        for (const entry of entries) {
          if (allEntries.length >= MAX_ENTRIES) break
          allEntries.push(entry)
        }

        // Only follow child sitemaps if recursive is enabled
        if (recursive) {
          for (const childUrl of childSitemaps) {
            if (!fetchedSitemaps.has(childUrl) && isAllowedUrl(childUrl)) {
              queue.push(childUrl)
            }
          }
        }
      } catch {}
    }

    return {
      urls: allEntries,
      stats: {
        total: allEntries.length,
        sitemaps: fetchedSitemaps.size,
      },
    }
  },
)
