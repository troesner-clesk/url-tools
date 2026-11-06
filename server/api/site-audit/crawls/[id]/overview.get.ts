import { defineEventHandler } from 'h3'
import { crawlIdParam, toHttpError } from '../../../../crawler/api-helpers'
import { getOverview } from '../../../../crawler/queries'

export default defineEventHandler((event) => {
  const crawlId = crawlIdParam(event)
  try {
    return getOverview(crawlId)
  } catch (error) {
    throw toHttpError(error)
  }
})
