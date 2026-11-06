import { defineEventHandler, getQuery } from 'h3'
import {
  crawlIdParam,
  queryNumber,
  queryString,
  toHttpError,
} from '../../../../crawler/api-helpers'
import { queryUrls } from '../../../../crawler/queries'

/** Paged URL table: ?filter=&issue=&search=&sort=&dir=&limit=&offset=&columns=a,b */
export default defineEventHandler((event) => {
  const crawlId = crawlIdParam(event)
  const query = getQuery(event)
  try {
    return queryUrls(crawlId, {
      filter: queryString(query.filter),
      issueId: queryString(query.issue),
      search: queryString(query.search),
      sort: queryString(query.sort),
      direction: queryString(query.dir) === 'desc' ? 'desc' : 'asc',
      limit: queryNumber(query.limit),
      offset: queryNumber(query.offset),
      columns: queryString(query.columns)
        ?.split(',')
        .map((c) => c.trim())
        .filter(Boolean),
    })
  } catch (error) {
    throw toHttpError(error)
  }
})
