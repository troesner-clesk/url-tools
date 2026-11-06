import { createError, getRouterParam, type H3Event } from 'h3'
import { BlockedTargetError } from './net-guard'
import { CrawlQueryError } from './queries'
import { isValidCrawlId } from './store'

/** Shared plumbing for the /api/site-audit endpoints. */

export function crawlIdParam(event: H3Event): string {
  const id = decodeURIComponent(getRouterParam(event, 'id') ?? '')
  if (!isValidCrawlId(id)) {
    throw createError({ statusCode: 400, message: 'Invalid crawl id' })
  }
  return id
}

export function toHttpError(error: unknown): Error {
  if (error instanceof CrawlQueryError) {
    return createError({ statusCode: error.statusCode, message: error.message })
  }
  if (error instanceof BlockedTargetError) {
    return createError({ statusCode: 400, message: error.message })
  }
  const message = error instanceof Error ? error.message : 'Unknown error'
  return createError({ statusCode: 500, message })
}

export function queryString(value: unknown): string | undefined {
  if (Array.isArray(value)) return queryString(value[0])
  return typeof value === 'string' && value !== '' ? value : undefined
}

export function queryNumber(value: unknown): number | undefined {
  const text = queryString(value)
  if (text === undefined) return undefined
  const n = Number(text)
  return Number.isFinite(n) ? n : undefined
}
