import { createError, defineEventHandler, getRequestHeader } from 'h3'
import { checkLocalRequest, isGuardedPath } from '../utils/request-guard'

export default defineEventHandler((event) => {
  if (!isGuardedPath(event.path)) return
  const verdict = checkLocalRequest({
    host: getRequestHeader(event, 'host'),
    origin: getRequestHeader(event, 'origin'),
    fetchSite: getRequestHeader(event, 'sec-fetch-site'),
  })
  if (!verdict.ok) {
    throw createError({ statusCode: 403, message: verdict.reason })
  }
})
