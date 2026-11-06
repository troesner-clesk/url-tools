import { defineEventHandler, getQuery } from 'h3'
import {
  crawlIdParam,
  queryString,
  toHttpError,
} from '../../../../crawler/api-helpers'
import type { Severity } from '../../../../crawler/catalog'
import { listIssues } from '../../../../crawler/queries'

export default defineEventHandler((event) => {
  const crawlId = crawlIdParam(event)
  const query = getQuery(event)
  try {
    return {
      issues: listIssues(crawlId, {
        severity: queryString(query.severity) as Severity | undefined,
        category: queryString(query.category),
      }),
    }
  } catch (error) {
    throw toHttpError(error)
  }
})
