import { defineEventHandler, readBody, createError } from 'h3'
import { extractLinks, getRedirectChain, formatRedirectChain, normalizeUrl } from '../utils/link-analyzer'
import { isAllowedUrl } from '../utils/url-validator'

interface RequestSettings {
    timeout: number      // Sekunden
    retries: number      // 0-3
    proxy?: string       // Optional: http://host:port
    headers?: Record<string, string>  // Custom Headers
}

interface ScrapeLinksRequest {
    urls: string[]
    recursive: boolean
    maxUrls: number
    maxDepth: number
    rateLimit: number
    sameDomainOnly: boolean
    urlFilter?: string   // Regex-Filter für URLs
    pathInclude?: string // Komma-getrennte Pfade die enthalten sein müssen
    pathExclude?: string // Komma-getrennte Pfade die ausgeschlossen werden
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

// Fetch mit Retry-Logik
async function fetchWithRetry(
    url: string,
    settings: RequestSettings
): Promise<{ response: Response; retryCount: number }> {
    const { timeout, retries, headers } = settings
    let lastError: Error | null = null

    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const controller = new AbortController()
            const timeoutId = setTimeout(() => controller.abort(), timeout * 1000)

            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; HTMLScraper/1.0)',
                    ...headers
                },
                signal: controller.signal
            })
            clearTimeout(timeoutId)

            if (response.status >= 500 && attempt < retries) {
                lastError = new Error(`Server error: ${response.status}`)
                await sleep(1000 * (attempt + 1))
                continue
            }

            return { response, retryCount: attempt }
        } catch (error) {
            lastError = error instanceof Error ? error : new Error('Unknown error')
            if (attempt < retries) {
                await sleep(1000 * (attempt + 1))
                continue
            }
        }
    }

    throw lastError
}

export default defineEventHandler(async (event) => {
    const body = await readBody<ScrapeLinksRequest>(event)

    if (!body.urls || !Array.isArray(body.urls)) {
        throw createError({
            statusCode: 400,
            message: 'urls array required'
        })
    }

    // SSE Headers direkt setzen
    const res = event.node.res
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
    })

    let isClosed = false
    res.on('close', () => { isClosed = true })

    // Helper: SSE-Event senden
    function emit(eventName: string, data: unknown) {
        if (isClosed) return
        res.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`)
    }

    // Default-Settings mit Clamping
    const settings: RequestSettings = {
        timeout: Math.min(Math.max(body.settings?.timeout ?? 30, 1), 120),
        retries: Math.min(Math.max(body.settings?.retries ?? 1, 0), 5),
        proxy: body.settings?.proxy,
        headers: body.settings?.headers
    }

    const maxUrls = Math.min(Math.max(body.maxUrls || 100, 1), 10000)
    const rateLimit = Math.max(body.rateLimit || 2, 0.1)

    // URL-Filter (Regex) - Länge limitieren gegen ReDoS
    let urlFilterRegex: RegExp | null = null
    if (body.urlFilter && body.urlFilter.length <= 200) {
        try {
            urlFilterRegex = new RegExp(body.urlFilter)
        } catch {
            // Ungültiger Regex - ignorieren
        }
    }

    // Pfad-Filter (Include/Exclude)
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

        // Basis-Domain für Same-Domain-Check
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

            // URL-Filter prüfen
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

                const html = await response.text()
                const links = extractLinks(html, item.url)

                emit('log', { message: `Found ${links.length} links on ${item.url}`, type: 'success' })

                for (const link of links) {
                    if (results.length >= maxUrls || isClosed) break

                    // URL-Filter auch auf Target-URLs anwenden
                    if (urlFilterRegex && !urlFilterRegex.test(link.targetUrl)) {
                        continue
                    }
                    if (!matchesPathFilter(link.targetUrl)) {
                        continue
                    }

                    const redirectInfo = await getRedirectChain(link.targetUrl)

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

                    // Ergebnis sofort streamen
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
