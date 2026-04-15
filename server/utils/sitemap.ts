import * as cheerio from 'cheerio'
import { fetchWithRetry, type RequestSettings } from './fetch-with-retry'
import { isAllowedUrl } from './url-validator'

export interface SitemapEntry {
  loc: string
  lastmod?: string
  changefreq?: string
  priority?: string
  source: string
}

export interface FetchSitemapResult {
  entries: SitemapEntry[]
  sitemapsFetched: number
}

export interface FetchSitemapOptions {
  recursive?: boolean
  maxSitemaps?: number
  maxEntries?: number
  maxBodySize?: number
  /**
   * Called after each sitemap is successfully fetched and parsed. Use this
   * to stream progress to a SSE consumer. Throws are swallowed so a buggy
   * callback can't break the fetch loop.
   */
  onSitemapFetched?: (url: string, entriesAdded: number) => void
}

const DEFAULT_MAX_SITEMAPS = 50
const DEFAULT_MAX_ENTRIES = 50000
const DEFAULT_MAX_BODY_SIZE = 10 * 1024 * 1024

export function parseSitemapXml(
  xml: string,
  sourceUrl: string,
): { entries: SitemapEntry[]; childSitemaps: string[] } {
  const $ = cheerio.load(xml, { xmlMode: true })
  const entries: SitemapEntry[] = []
  const childSitemaps: string[] = []
  const seenLocs = new Set<string>()

  $('sitemapindex > sitemap > loc').each((_, el) => {
    const loc = $(el).text().trim()
    if (loc && !seenLocs.has(loc)) {
      seenLocs.add(loc)
      childSitemaps.push(loc)
    }
  })

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

export async function fetchSitemapUrls(
  startUrl: string,
  settings: RequestSettings,
  opts: FetchSitemapOptions = {},
): Promise<FetchSitemapResult> {
  const recursive = opts.recursive === true
  const maxSitemaps = opts.maxSitemaps ?? DEFAULT_MAX_SITEMAPS
  const maxEntries = opts.maxEntries ?? DEFAULT_MAX_ENTRIES
  const maxBodySize = opts.maxBodySize ?? DEFAULT_MAX_BODY_SIZE

  const allEntries: SitemapEntry[] = []
  const fetchedSitemaps = new Set<string>()
  const queue: string[] = [startUrl]

  while (
    queue.length > 0 &&
    fetchedSitemaps.size < maxSitemaps &&
    allEntries.length < maxEntries
  ) {
    const currentUrl = queue.shift()!

    if (fetchedSitemaps.has(currentUrl)) continue
    fetchedSitemaps.add(currentUrl)

    if (!isAllowedUrl(currentUrl)) continue

    try {
      const { response } = await fetchWithRetry(currentUrl, settings)

      const contentLength = parseInt(
        response.headers.get('content-length') || '0',
        10,
      )
      if (contentLength > maxBodySize) continue

      const xml = await response.text()
      if (xml.length > maxBodySize) continue

      const { entries, childSitemaps } = parseSitemapXml(xml, currentUrl)

      const before = allEntries.length
      for (const entry of entries) {
        if (allEntries.length >= maxEntries) break
        allEntries.push(entry)
      }

      try {
        opts.onSitemapFetched?.(currentUrl, allEntries.length - before)
      } catch {
        // Defense-in-depth: a throwing callback must not abort the fetch loop
      }

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
    entries: allEntries,
    sitemapsFetched: fetchedSitemaps.size,
  }
}
