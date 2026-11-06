import { createError, defineEventHandler, readBody } from 'h3'
import { type CrawlOptions, startCrawl } from '../../../crawler/engine'
import { BlockedTargetError } from '../../../crawler/net-guard'

/** Starts a site crawl in the background and returns its id immediately. */
export default defineEventHandler(async (event) => {
  const body = (await readBody<Partial<CrawlOptions>>(event)) ?? {}
  if (typeof body.startUrl !== 'string' || !body.startUrl.trim()) {
    throw createError({ statusCode: 400, message: 'startUrl is required' })
  }
  try {
    const job = startCrawl({
      startUrl: body.startUrl,
      maxUrls: body.maxUrls,
      maxDepth: body.maxDepth,
      concurrency: body.concurrency,
      requestsPerSecond: body.requestsPerSecond,
      respectRobots: body.respectRobots,
      checkExternal: body.checkExternal,
      useSitemaps: body.useSitemaps,
      includeSubdomains: body.includeSubdomains,
      includePaths: body.includePaths,
      excludePaths: body.excludePaths,
      userAgent: body.userAgent,
      headers: body.headers,
      source: 'ui',
    })
    return { crawlId: job.crawlId, progress: job.progress }
  } catch (error) {
    if (error instanceof BlockedTargetError) {
      throw createError({ statusCode: 400, message: error.message })
    }
    const message = error instanceof Error ? error.message : 'Unknown error'
    const statusCode = message.includes('already running') ? 429 : 400
    throw createError({ statusCode, message })
  }
})
