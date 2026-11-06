import {
  createError,
  defineEventHandler,
  getQuery,
  setResponseHeader,
} from 'h3'
import {
  crawlIdParam,
  queryString,
  toHttpError,
} from '../../../../crawler/api-helpers'
import { type ExportKind, exportCsv } from '../../../../crawler/queries'

const KINDS: ExportKind[] = ['issues', 'urls', 'links']

/** CSV download: ?kind=issues|urls|links */
export default defineEventHandler((event) => {
  const crawlId = crawlIdParam(event)
  const kind = (queryString(getQuery(event).kind) ?? 'issues') as ExportKind
  if (!KINDS.includes(kind)) {
    throw createError({
      statusCode: 400,
      message: `kind must be one of ${KINDS.join(', ')}`,
    })
  }
  try {
    const csv = exportCsv(crawlId, kind)
    setResponseHeader(event, 'Content-Type', 'text/csv; charset=utf-8')
    setResponseHeader(
      event,
      'Content-Disposition',
      `attachment; filename="${crawlId}_${kind}.csv"`,
    )
    // BOM so Excel opens UTF-8 (umlauts) correctly.
    return `﻿${csv}`
  } catch (error) {
    throw toHttpError(error)
  }
})
