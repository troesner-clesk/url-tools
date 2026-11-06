import { createError, defineEventHandler } from 'h3'
import { crawlIdParam } from '../../../../crawler/api-helpers'
import { getCrawlJob } from '../../../../crawler/engine'

export default defineEventHandler((event) => {
  const crawlId = crawlIdParam(event)
  const job = getCrawlJob(crawlId)
  if (!job?.isRunning) {
    throw createError({ statusCode: 409, message: 'Crawl is not running' })
  }
  job.stop()
  return { crawlId, stopping: true }
})
