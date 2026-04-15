import { createError, defineEventHandler, readBody } from 'h3'
import { fetchWithRetry, type RequestSettings } from '../utils/fetch-with-retry'
import {
  type InboundLink,
  matchesTarget,
  normalizeTargets,
} from '../utils/inbound-matcher'
import { extractLinks, normalizeUrl } from '../utils/link-analyzer'
import { fetchSitemapUrls } from '../utils/sitemap'
import { isAllowedUrl } from '../utils/url-validator'

type TargetMode = 'single' | 'multi' | 'matrix'
type CrawlScope = 'recursive' | 'sitemap'

interface AnalyzeInboundRequest {
  startUrls: string[]
  crawlScope: CrawlScope
  targetMode: TargetMode
  targets?: string[]
  maxUrls?: number
  maxDepth?: number
  rateLimit?: number
  urlFilter?: string
  pathInclude?: string
  pathExclude?: string
  settings?: RequestSettings
}

const MAX_TARGETS = 500
const MAX_RESULTS = 50000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export default defineEventHandler(async (event) => {
  const body = await readBody<AnalyzeInboundRequest>(event)

  if (
    !body.startUrls ||
    !Array.isArray(body.startUrls) ||
    body.startUrls.length === 0
  ) {
    throw createError({ statusCode: 400, message: 'startUrls array required' })
  }

  if (body.crawlScope !== 'recursive' && body.crawlScope !== 'sitemap') {
    throw createError({ statusCode: 400, message: 'invalid crawlScope' })
  }

  if (
    body.targetMode !== 'single' &&
    body.targetMode !== 'multi' &&
    body.targetMode !== 'matrix'
  ) {
    throw createError({ statusCode: 400, message: 'invalid targetMode' })
  }

  const targetsInput = body.targets ?? []
  if (body.targetMode !== 'matrix') {
    if (targetsInput.length === 0) {
      throw createError({
        statusCode: 400,
        message: 'targets required for single/multi mode',
      })
    }
    if (targetsInput.length > MAX_TARGETS) {
      throw createError({
        statusCode: 400,
        message: `too many targets (max ${MAX_TARGETS})`,
      })
    }
  }

  const res = event.node.res
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })

  let isClosed = false
  res.on('close', () => {
    isClosed = true
  })

  function emit(eventName: string, data: unknown) {
    if (isClosed) return
    res.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`)
  }

  const settings: RequestSettings = {
    timeout: Math.min(Math.max(body.settings?.timeout ?? 30, 1), 120),
    retries: Math.min(Math.max(body.settings?.retries ?? 1, 0), 5),
    proxy: body.settings?.proxy,
    headers: body.settings?.headers,
  }

  const maxUrls = Math.min(Math.max(body.maxUrls || 200, 1), 10000)
  const maxDepth = Math.min(Math.max(body.maxDepth ?? 3, 0), 10)
  const rateLimit = Math.max(body.rateLimit || 2, 0.1)
  const delayMs = 1000 / rateLimit

  let urlFilterRegex: RegExp | null = null
  if (body.urlFilter && body.urlFilter.length <= 200) {
    try {
      urlFilterRegex = new RegExp(body.urlFilter)
    } catch {}
  }

  const pathIncludes = body.pathInclude
    ? body.pathInclude
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean)
    : []
  const pathExcludes = body.pathExclude
    ? body.pathExclude
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean)
    : []

  function matchesPathFilter(url: string): boolean {
    try {
      const path = new URL(url).pathname
      for (const ex of pathExcludes) {
        const p = ex.replace(/\/+$/, '')
        if (path === p || path.startsWith(`${p}/`)) return false
      }
      if (pathIncludes.length > 0) {
        return pathIncludes.some((inc) => {
          const p = inc.replace(/\/+$/, '')
          return path === p || path.startsWith(`${p}/`)
        })
      }
      return true
    } catch {
      return true
    }
  }

  const normalizedTargetSet = normalizeTargets(targetsInput)

  try {
    const visited = new Set<string>()
    const queue: Array<{ url: string; depth: number }> = []
    // Dedup identical (source, target) pairs — mostly matters for matrix mode
    // where nav links repeat on every page.
    const emittedEdges = new Set<string>()
    let pagesProcessed = 0
    let inboundFound = 0
    let capReached = false

    // Resolve base domains (from startUrls)
    const baseDomains = new Set(
      body.startUrls
        .map((url) => {
          try {
            return new URL(url).hostname
          } catch {
            return null
          }
        })
        .filter((h): h is string => Boolean(h)),
    )

    if (body.crawlScope === 'sitemap') {
      emit('log', { message: 'Fetching sitemap(s)...', type: 'info' })
      for (const startUrl of body.startUrls) {
        if (!isAllowedUrl(startUrl)) continue
        try {
          const { entries } = await fetchSitemapUrls(startUrl, settings, {
            recursive: true,
          })
          for (const entry of entries) {
            const normalized = normalizeUrl(entry.loc)
            if (!normalized || visited.has(normalized)) continue
            if (!isAllowedUrl(normalized)) continue
            visited.add(normalized)
            queue.push({ url: normalized, depth: 0 })
          }
        } catch (err) {
          emit('log', {
            message: `Sitemap fetch failed: ${err instanceof Error ? err.message : 'unknown'}`,
            type: 'error',
          })
        }
      }
      emit('log', {
        message: `Seeded ${queue.length} URL(s) from sitemap`,
        type: 'info',
      })
    } else {
      for (const url of body.startUrls) {
        const normalized = normalizeUrl(url)
        if (
          normalized &&
          !visited.has(normalized) &&
          isAllowedUrl(normalized)
        ) {
          visited.add(normalized)
          queue.push({ url: normalized, depth: 0 })
        }
      }
      emit('log', {
        message: `Starting recursive crawl with ${queue.length} seed(s)`,
        type: 'info',
      })
    }

    while (
      queue.length > 0 &&
      pagesProcessed < maxUrls &&
      !isClosed &&
      !capReached
    ) {
      const item = queue.shift()
      if (!item) break

      if (urlFilterRegex && !urlFilterRegex.test(item.url)) continue
      if (!matchesPathFilter(item.url)) continue

      emit('progress', {
        done: pagesProcessed,
        total: pagesProcessed + queue.length + 1,
        currentUrl: item.url,
      })

      try {
        if (pagesProcessed > 0) await sleep(delayMs)

        const { response } = await fetchWithRetry(item.url, settings)
        const contentLength = parseInt(
          response.headers.get('content-length') || '0',
          10,
        )
        if (contentLength > 10 * 1024 * 1024) {
          throw new Error('Response too large (>10MB)')
        }

        const html = await response.text()
        // Guard against chunked responses that bypass content-length check
        if (html.length > 10 * 1024 * 1024) {
          throw new Error('Response too large (>10MB)')
        }
        const sourceStatus = response.status
        const links = extractLinks(html, item.url)
        pagesProcessed++

        let pageHits = 0
        for (const link of links) {
          if (!link.isInternal) continue

          const isMatch =
            body.targetMode === 'matrix' ||
            matchesTarget(link.targetUrl, normalizedTargetSet)

          if (isMatch) {
            const edgeKey = `${item.url}|${link.targetUrl}`
            if (!emittedEdges.has(edgeKey)) {
              emittedEdges.add(edgeKey)
              const inbound: InboundLink = {
                sourceUrl: item.url,
                targetUrl: link.targetUrl,
                anchorText: link.anchorText,
                rel: link.rel.join(', '),
                sourceStatus,
                depth: item.depth,
              }
              emit('result', inbound)
              inboundFound++
              pageHits++
              if (inboundFound >= MAX_RESULTS) {
                capReached = true
                emit('log', {
                  message: `Result cap reached (${MAX_RESULTS}); stopping early`,
                  type: 'error',
                })
                break
              }
            }
          }

          // Recursive crawl: enqueue internal link as next page to fetch
          if (
            body.crawlScope === 'recursive' &&
            item.depth < maxDepth &&
            !visited.has(link.targetUrl)
          ) {
            try {
              const targetDomain = new URL(link.targetUrl).hostname
              if (
                baseDomains.has(targetDomain) &&
                isAllowedUrl(link.targetUrl)
              ) {
                visited.add(link.targetUrl)
                queue.push({ url: link.targetUrl, depth: item.depth + 1 })
              }
            } catch {}
          }
        }

        emit('log', {
          message: `Scanned ${item.url} — ${pageHits} inbound match(es), ${links.length} links total`,
          type: pageHits > 0 ? 'success' : 'info',
        })
      } catch (error) {
        emit('log', {
          message: `Error fetching ${item.url}: ${error instanceof Error ? error.message : 'unknown'}`,
          type: 'error',
        })
      }
    }

    emit('done', {
      pagesProcessed,
      inboundFound,
      visited: visited.size,
    })
    emit('log', {
      message: `Complete: ${inboundFound} inbound link(s) across ${pagesProcessed} page(s)`,
      type: 'success',
    })
  } catch (error) {
    emit('error', {
      message: error instanceof Error ? error.message : 'Unknown error',
    })
  } finally {
    res.end()
  }
})
