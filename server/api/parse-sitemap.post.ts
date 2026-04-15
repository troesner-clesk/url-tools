import { createError, defineEventHandler, readBody } from 'h3'
import type { RequestSettings } from '../utils/fetch-with-retry'
import { fetchSitemapUrls, type SitemapEntry } from '../utils/sitemap'
import { isAllowedUrl } from '../utils/url-validator'

interface ParseSitemapRequest {
  url: string
  recursive?: boolean
}

interface ParseSitemapResponse {
  urls: SitemapEntry[]
  stats: {
    total: number
    sitemaps: number
  }
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

    const settings: RequestSettings = {
      timeout: 30,
      retries: 2,
    }

    const { entries, sitemapsFetched } = await fetchSitemapUrls(url, settings, {
      recursive: body.recursive === true,
    })

    return {
      urls: entries,
      stats: {
        total: entries.length,
        sitemaps: sitemapsFetched,
      },
    }
  },
)
