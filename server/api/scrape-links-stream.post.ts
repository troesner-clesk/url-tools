import { defineEventHandler, readBody, createError } from 'h3'
import { extractLinks, getRedirectChain, formatRedirectChain, normalizeUrl } from '../utils/link-analyzer'
import { isAllowedUrl } from '../utils/url-validator'
import { fetchWithRetry, type RequestSettings } from '../utils/fetch-with-retry'

interface ScrapeLinksRequest {
    urls: string[]
    recursive: boolean
    maxUrls: number
    maxDepth: number
    rateLimit: number
    sameDomainOnly: boolean
    urlFilter?: string   // Regex filter for URLs
    pathInclude?: string // Comma-separated paths that must be included
    pathExclude?: string // Comma-separated paths to exclude
    settings?: RequestSettings
}

interface LinkResult {
    sourceUrl: string
    targetUrl: string
    status: number
    redirectChain: string
    type: 'internal' | 'external'
    anchorText: string
    rel: string
    depth: number
    error?: string
    retryCount?: number
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
}

export default defineEventHandler(async (event) => {
    const body = await readBody<ScrapeLinksRequest>(event)

    if (!body.urls || !Array.isArray(body.urls)) {
        throw createError({
            statusCode: 400,
            message: 'urls array required'
        })
    }

    // Set SSE headers
    const res = event.node.res
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
    })

    let isClosed = false
    res.on('close', () => { isClosed = true })

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
        headers: body.settings?.headers
    }

    const maxUrls = Math.min(Math.max(body.maxUrls || 100, 1), 10000)
    const rateLimit = Math.max(body.rateLimit || 2, 0.1)

    // URL filter (regex) - limit length to prevent ReDoS
    let urlFilterRegex: RegExp | null = null
    if (body.urlFilter && body.urlFilter.length <= 200) {
        try {
            urlFilterRegex = new RegExp(body.urlFilter)
        } catch {
            // Invalid regex - ignore
        }
    }

    // Path filter (include/exclude)
    const pathIncludes = body.pathInclude
        ? body.pathInclude.split(',').map(p => p.trim()).filter(Boolean)
        : []
    const pathExcludes = body.pathExclude
        ? body.pathExclude.split(',').map(p => p.trim()).filter(Boolean)
        : []

    function matchesPathFilter(url: string): boolean {
        try {
            const path = new URL(url).pathname
            for (const ex of pathExcludes) {
                const p = ex.replace(/\/+$/, '')
                if (path === p || path.startsWith(p + '/')) return false
            }
            if (pathIncludes.length > 0) {
                return pathIncludes.some(inc => {
                    const p = inc.replace(/\/+$/, '')
                    return path === p || path.startsWith(p + '/')
                })
            }
            return true
        } catch {
            return true
        }
    }

    try {
        const results: LinkResult[] = []
        const visited = new Set<string>()
        const queue: Array<{ url: string; depth: number; sourceUrl?: string }> = []

        // Seed URLs zur Queue (mit SSRF-Check)
        for (const url of body.urls) {
            const normalized = normalizeUrl(url)
            if (normalized && !visited.has(normalized) && isAllowedUrl(normalized)) {
                queue.push({ url: normalized, depth: 0 })
                visited.add(normalized)
            }
        }

        // Base domain for same-domain check
        const baseDomains = new Set(
            body.urls.map(url => {
                try {
                    return new URL(url).hostname
                } catch {
                    return null
                }
            }).filter(Boolean)
        )

        const delayMs = 1000 / rateLimit

        emit('log', { message: `Starting crawl with ${queue.length} seed URL(s)`, type: 'info' })

        while (queue.length > 0 && results.length < maxUrls && !isClosed) {
            const item = queue.shift()!

            // Check URL filter
            if (urlFilterRegex && !urlFilterRegex.test(item.url)) {
                continue
            }
            if (!matchesPathFilter(item.url)) {
                continue
            }

            emit('progress', { done: results.length, total: results.length + queue.length + 1, currentUrl: item.url })
            emit('log', { message: `Fetching ${item.url} (depth: ${item.depth})`, type: 'progress' })

            try {
                if (results.length > 0) {
                    await sleep(delayMs)
                }

                const { response, retryCount } = await fetchWithRetry(item.url, settings)

                const contentLength = parseInt(response.headers.get('content-length') || '0')
                if (contentLength > 10 * 1024 * 1024) {
                    throw new Error('Response too large (>10MB)')
                }

                const html = await response.text()
                const links = extractLinks(html, item.url)

                emit('log', { message: `Found ${links.length} links on ${item.url}`, type: 'success' })

                for (const link of links) {
                    if (results.length >= maxUrls || isClosed) break

                    // Apply URL filter to target URLs as well
                    if (urlFilterRegex && !urlFilterRegex.test(link.targetUrl)) {
                        continue
                    }
                    if (!matchesPathFilter(link.targetUrl)) {
                        continue
                    }

                    await sleep(delayMs / 4)
                    const redirectInfo = await getRedirectChain(link.targetUrl, 3, 5000)

                    const result: LinkResult = {
                        sourceUrl: item.url,
                        targetUrl: link.targetUrl,
                        status: redirectInfo.finalStatus,
                        redirectChain: formatRedirectChain(redirectInfo.chain),
                        type: link.isInternal ? 'internal' : 'external',
                        anchorText: link.anchorText,
                        rel: link.rel.join(', '),
                        depth: item.depth,
                        error: redirectInfo.error,
                        retryCount
                    }

                    results.push(result)

                    // Stream result immediately
                    emit('result', result)

                    if (body.recursive &&
                        link.isInternal &&
                        item.depth < body.maxDepth &&
                        !visited.has(link.targetUrl)) {

                        const targetDomain = new URL(link.targetUrl).hostname
                        if (!body.sameDomainOnly || baseDomains.has(targetDomain)) {
                            visited.add(link.targetUrl)
                            queue.push({ url: link.targetUrl, depth: item.depth + 1 })
                        }
                    }

                    await sleep(delayMs / 2)
                }
            } catch (error) {
                const errorResult: LinkResult = {
                    sourceUrl: item.sourceUrl || item.url,
                    targetUrl: item.url,
                    status: 0,
                    redirectChain: '',
                    type: 'internal',
                    anchorText: '',
                    rel: '',
                    depth: item.depth,
                    error: error instanceof Error ? error.message : 'Unknown error'
                }

                results.push(errorResult)
                emit('result', errorResult)
                emit('log', { message: `Error fetching ${item.url}: ${errorResult.error}`, type: 'error' })
            }
        }

        // Abschluss-Event senden
        emit('done', { totalLinks: results.length, visited: visited.size })
        emit('log', { message: `Crawl complete: ${results.length} links found`, type: 'success' })
    } catch (error) {
        emit('error', { message: error instanceof Error ? error.message : 'Unknown error' })
    } finally {
        res.end()
    }
})
