import { createError, defineEventHandler, readBody } from 'h3'
import { fetchWithRetry, type RequestSettings } from '../utils/fetch-with-retry'
import {
  extractLinks,
  getRedirectChain,
  normalizeUrl,
} from '../utils/link-analyzer'
import { isAllowedUrl } from '../utils/url-validator'

interface CheckLinksRequest {
  urls: string[]
  recursive?: boolean
  maxDepth?: number
  maxUrls?: number
  sameDomainOnly?: boolean
  externalOnly?: boolean
  settings?: RequestSettings
}

interface BrokenLinkResult {
  sourceUrl: string
  targetUrl: string
  status: number
  statusText: string
  isBroken: boolean
  isInternal: boolean
  anchorText: string
  error?: string
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export default defineEventHandler(async (event) => {
  const body = await readBody<CheckLinksRequest>(event)

  if (!body.urls || !Array.isArray(body.urls)) {
    throw createError({
      statusCode: 400,
      message: 'urls array required',
    })
  }

  // Set SSE headers
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

  // Helper: send SSE event
  function emit(eventName: string, data: unknown) {
    if (isClosed) return
    res.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`)
  }

  // Default settings with clamping
  const settings: RequestSettings = {
    timeout: Math.min(Math.max(body.settings?.timeout ?? 30, 1), 120),
    retries: Math.min(Math.max(body.settings?.retries ?? 1, 0), 5),
    proxy: body.settings?.proxy,
    headers: body.settings?.headers,
  }

  const maxUrls = Math.max(body.maxUrls || 500, 1)
  const maxDepth = Math.min(Math.max(body.maxDepth || 1, 1), 5)
  const delayMs = 200

  try {
    const results: BrokenLinkResult[] = []
    const visited = new Set<string>()
    const checkedLinks = new Set<string>()
    const queue: Array<{ url: string; depth: number }> = []

    // Seed URLs with SSRF check
    for (const url of body.urls) {
      const normalized = normalizeUrl(url)
      if (normalized && !visited.has(normalized) && isAllowedUrl(normalized)) {
        queue.push({ url: normalized, depth: 0 })
        visited.add(normalized)
      }
    }

    // Base domains for same-domain check
    const baseDomains = new Set(
      body.urls
        .map((url) => {
          try {
            return new URL(url).hostname
          } catch {
            return null
          }
        })
        .filter(Boolean),
    )

    emit('log', {
      message: `Starting broken link check with ${queue.length} seed URL(s)`,
      type: 'info',
    })

    while (queue.length > 0 && results.length < maxUrls && !isClosed) {
      const item = queue.shift()!

      emit('progress', {
        done: results.length,
        total: results.length + queue.length + 1,
        currentUrl: item.url,
      })
      emit('log', {
        message: `Crawling ${item.url} (depth: ${item.depth})`,
        type: 'progress',
      })

      try {
        const { response } = await fetchWithRetry(item.url, settings)

        const contentLength = parseInt(
          response.headers.get('content-length') || '0',
          10,
        )
        if (contentLength > 10 * 1024 * 1024) {
          emit('log', {
            message: `Skipping ${item.url}: response too large (>10MB)`,
            type: 'error',
          })
          continue
        }

        const html = await response.text()
        const links = extractLinks(html, item.url)

        emit('log', {
          message: `Found ${links.length} links on ${item.url}`,
          type: 'success',
        })

        for (const link of links) {
          if (results.length >= maxUrls || isClosed) break

          // Skip already checked target URLs
          const linkKey = `${item.url}|${link.targetUrl}`
          if (checkedLinks.has(linkKey)) continue
          checkedLinks.add(linkKey)

          // SSRF protection for target URLs
          if (!isAllowedUrl(link.targetUrl)) continue

          // Skip internal links if externalOnly is enabled
          if (body.externalOnly && link.isInternal) continue

          await sleep(delayMs)

          const redirectInfo = await getRedirectChain(
            link.targetUrl,
            5,
            settings.timeout * 1000,
          )

          const isBroken =
            redirectInfo.finalStatus >= 400 || redirectInfo.finalStatus === 0
          const statusText =
            redirectInfo.error || httpStatusText(redirectInfo.finalStatus)

          const result: BrokenLinkResult = {
            sourceUrl: item.url,
            targetUrl: link.targetUrl,
            status: redirectInfo.finalStatus,
            statusText,
            isBroken,
            isInternal: link.isInternal,
            anchorText: link.anchorText,
            error: redirectInfo.error,
          }

          results.push(result)
          emit('result', result)
        }

        // Recursive crawling: add internal links to queue
        if (body.recursive && item.depth < maxDepth) {
          for (const link of links) {
            if (!link.isInternal) continue
            if (visited.has(link.targetUrl)) continue
            if (!isAllowedUrl(link.targetUrl)) continue

            const targetDomain = new URL(link.targetUrl).hostname
            if (body.sameDomainOnly && !baseDomains.has(targetDomain)) continue

            visited.add(link.targetUrl)
            queue.push({ url: link.targetUrl, depth: item.depth + 1 })
          }
        }
      } catch (error) {
        emit('log', {
          message: `Error crawling ${item.url}: ${error instanceof Error ? error.message : 'Unknown error'}`,
          type: 'error',
        })
      }
    }

    const brokenCount = results.filter((r) => r.isBroken).length
    const okCount = results.filter((r) => !r.isBroken).length

    emit('done', {
      totalLinks: results.length,
      brokenCount,
      okCount,
      visited: visited.size,
    })
    emit('log', {
      message: `Check complete: ${results.length} links checked, ${brokenCount} broken, ${okCount} OK`,
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

function httpStatusText(status: number): string {
  const texts: Record<number, string> = {
    0: 'Connection Failed',
    200: 'OK',
    201: 'Created',
    204: 'No Content',
    301: 'Moved Permanently',
    302: 'Found',
    303: 'See Other',
    304: 'Not Modified',
    307: 'Temporary Redirect',
    308: 'Permanent Redirect',
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    405: 'Method Not Allowed',
    408: 'Request Timeout',
    410: 'Gone',
    429: 'Too Many Requests',
    500: 'Internal Server Error',
    502: 'Bad Gateway',
    503: 'Service Unavailable',
    504: 'Gateway Timeout',
  }
  return texts[status] || `HTTP ${status}`
}
