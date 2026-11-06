import { createError, defineEventHandler, getQuery } from 'h3'
import {
  crawlIdParam,
  queryString,
  toHttpError,
} from '../../../../crawler/api-helpers'
import { urlDetails } from '../../../../crawler/queries'

/** Details of one URL: ?url=<absolute URL> */
export default defineEventHandler((event) => {
  const crawlId = crawlIdParam(event)
  const url = queryString(getQuery(event).url)
  if (!url) throw createError({ statusCode: 400, message: 'url is required' })
  try {
    return urlDetails(crawlId, url)
  } catch (error) {
    throw toHttpError(error)
  }
})
