import { EventEmitter, setMaxListeners } from 'node:events'
import { parseSitemapXml } from '../utils/sitemap'
import { analyzeCrawl } from './analyze'
import {
  checkUrlStatus,
  DEFAULT_USER_AGENT,
  type FetchError,
  type HttpResponse,
  httpRequest,
  isHtmlMime,
  ROBOTS_TOKEN,
} from './http-client'
import { assertCrawlableUrl } from './net-guard'
import {
  parseLinkHeader,
  parsePage,
  parseRobotsDirectives,
  xRobotsDirectives,
} from './parse-page'
import {
  crawlDelaySeconds,
  fetchRobotsPolicy,
  policyAllows,
  type RobotsPolicy,
} from './robots'
import {
  type CrawlStatus,
  CrawlWriter,
  type FoundVia,
  newCrawlId,
  TOOL_VERSION,
} from './store'
import {
  createScope,
  isInScope,
  matchesPathFilters,
  normalizeCrawlUrl,
  parsePathList,
} from './url-utils'

/**
 * Site crawler: breadth-first over internal links (so `depth` is the click
 * depth), polite by default (robots.txt, request rate, limited concurrency),
 * every request through the SSRF-guarded HTTP client. Writes straight into
 * the crawl file and runs the issue analysis at the end.
 */

export interface CrawlOptions {
  startUrl: string
  /** Internal URLs to fetch. */
  maxUrls?: number
  /** Maximum click depth from the start URL. */
  maxDepth?: number
  concurrency?: number
  requestsPerSecond?: number
  respectRobots?: boolean
  checkExternal?: boolean
  useSitemaps?: boolean
  includeSubdomains?: boolean
  includePaths?: string[] | string
  excludePaths?: string[] | string
  timeoutMs?: number
  userAgent?: string
  headers?: Record<string, string>
  /** Who started the crawl (shown in the crawl list). */
  source?: 'ui' | 'mcp' | 'api'
}

export interface ResolvedCrawlOptions {
  startUrl: string
  maxUrls: number
  maxDepth: number
  concurrency: number
  requestsPerSecond: number
  respectRobots: boolean
  checkExternal: boolean
  useSitemaps: boolean
  includeSubdomains: boolean
  includePaths: string[]
  excludePaths: string[]
  timeoutMs: number
  userAgent: string
  headers: Record<string, string>
  source: 'ui' | 'mcp' | 'api'
}

export const CRAWL_LIMITS = {
  maxUrls: { default: 500, max: 10_000 },
  maxDepth: { default: 10, max: 50 },
  concurrency: { default: 4, max: 10 },
  requestsPerSecond: { default: 5, max: 20 },
  timeoutMs: { default: 15_000, max: 60_000 },
  maxExternalChecks: 5_000,
  maxSitemaps: 50,
  maxSitemapUrls: 50_000,
  maxRunningCrawls: 3,
  maxCrawlDelaySeconds: 10,
} as const

function clamp(value: unknown, min: number, max: number, fallback: number) {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(Math.max(n, min), max)
}

export function resolveCrawlOptions(
  options: CrawlOptions,
): ResolvedCrawlOptions {
  const startUrl = normalizeCrawlUrl(String(options.startUrl ?? ''))
  if (!startUrl) throw new Error('A valid http(s) start URL is required')
  assertCrawlableUrl(startUrl)
  const L = CRAWL_LIMITS
  return {
    startUrl,
    maxUrls: Math.round(
      clamp(options.maxUrls, 1, L.maxUrls.max, L.maxUrls.default),
    ),
    maxDepth: Math.round(
      clamp(options.maxDepth, 0, L.maxDepth.max, L.maxDepth.default),
    ),
    concurrency: Math.round(
      clamp(options.concurrency, 1, L.concurrency.max, L.concurrency.default),
    ),
    requestsPerSecond: clamp(
      options.requestsPerSecond,
      0.2,
      L.requestsPerSecond.max,
      L.requestsPerSecond.default,
    ),
    respectRobots: options.respectRobots !== false,
    checkExternal: options.checkExternal !== false,
    useSitemaps: options.useSitemaps !== false,
    includeSubdomains: options.includeSubdomains === true,
    includePaths: parsePathList(options.includePaths),
    excludePaths: parsePathList(options.excludePaths),
    timeoutMs: Math.round(
      clamp(options.timeoutMs, 1000, L.timeoutMs.max, L.timeoutMs.default),
    ),
    userAgent: options.userAgent?.trim().slice(0, 300) || DEFAULT_USER_AGENT,
    headers: options.headers ?? {},
    source: options.source ?? 'api',
  }
}

export interface CrawlProgress {
  crawlId: string
  status: CrawlStatus
  startUrl: string
  fetched: number
  queued: number
  discovered: number
  failed: number
  blocked: number
  externalChecked: number
  externalQueued: number
  currentUrl: string | null
  phase:
    | 'starting'
    | 'crawling'
    | 'sitemaps'
    | 'externals'
    | 'analyzing'
    | 'done'
  elapsedMs: number
  issueCount?: number
  error?: string
}

export interface CrawlLogEntry {
  time: string
  message: string
  type: 'info' | 'success' | 'warning' | 'error' | 'progress'
}

interface QueueItem {
  id: number
  url: string
  depth: number | null
  /** Hops from the seed used for maxDepth; equals depth for linked pages. */
  hop: number
}

/** Resolves after `ms` or as soon as the signal aborts; never leaks listeners. */
function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0 || signal.aborted) return Promise.resolve()
  return new Promise<void>((resolve) => {
    const onAbort = () => {
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/** Global request pacing shared by all workers of one crawl. */
class RateLimiter {
  private next = 0
  constructor(private intervalMs: number) {}
  setMinInterval(ms: number) {
    this.intervalMs = Math.max(this.intervalMs, ms)
  }
  wait(signal: AbortSignal): Promise<void> {
    const now = Date.now()
    const slot = Math.max(now, this.next)
    this.next = slot + this.intervalMs
    return abortableDelay(slot - now, signal)
  }
}

/** Same pacing per host, for status checks of external URLs. */
class HostPacer {
  private readonly next = new Map<string, number>()
  constructor(private readonly intervalMs: number) {}
  wait(url: string, signal: AbortSignal): Promise<void> {
    let host = url
    try {
      host = new URL(url).host
    } catch {
      // keep the raw value as key
    }
    const now = Date.now()
    const slot = Math.max(now, this.next.get(host) ?? 0)
    this.next.set(host, slot + this.intervalMs)
    return abortableDelay(slot - now, signal)
  }
}

export class CrawlJob extends EventEmitter {
  readonly crawlId: string
  readonly options: ResolvedCrawlOptions
  readonly startedAt = Date.now()
  private finishedAt: number | null = null
  private readonly abort = new AbortController()
  private readonly logs: CrawlLogEntry[] = []
  private progressState: CrawlProgress
  private lastEmit = 0
  done: Promise<CrawlProgress>

  constructor(options: ResolvedCrawlOptions) {
    super()
    this.setMaxListeners(50)
    // Every in-flight request and pacing wait listens to the abort signal.
    setMaxListeners(100, this.abort.signal)
    this.options = options
    this.crawlId = newCrawlId(options.startUrl)
    this.progressState = {
      crawlId: this.crawlId,
      status: 'running',
      startUrl: options.startUrl,
      fetched: 0,
      queued: 0,
      discovered: 0,
      failed: 0,
      blocked: 0,
      externalChecked: 0,
      externalQueued: 0,
      currentUrl: null,
      phase: 'starting',
      elapsedMs: 0,
    }
    this.done = Promise.resolve(this.progressState)
  }

  get progress(): CrawlProgress {
    const end = this.finishedAt ?? Date.now()
    return { ...this.progressState, elapsedMs: end - this.startedAt }
  }

  get recentLogs(): CrawlLogEntry[] {
    return [...this.logs]
  }

  get isRunning(): boolean {
    return this.progressState.status === 'running'
  }

  stop(): void {
    if (!this.abort.signal.aborted) {
      this.log('Stop requested, finishing up', 'warning')
      this.abort.abort()
    }
  }

  log(message: string, type: CrawlLogEntry['type'] = 'info') {
    const entry = { time: new Date().toISOString(), message, type }
    this.logs.push(entry)
    if (this.logs.length > 200) this.logs.shift()
    this.emit('log', entry)
  }

  private update(patch: Partial<CrawlProgress>, force = false) {
    Object.assign(this.progressState, patch)
    if (patch.status && patch.status !== 'running' && !this.finishedAt) {
      this.finishedAt = Date.now()
    }
    const now = Date.now()
    if (force || now - this.lastEmit > 250) {
      this.lastEmit = now
      this.emit('progress', this.progress)
    }
  }

  /** Starts the crawl in the background. */
  start(): this {
    this.done = this.run().then(
      () => this.progress,
      (error) => {
        this.update(
          {
            status: 'failed',
            phase: 'done',
            error: String(error?.message ?? error),
          },
          true,
        )
        this.log(`Crawl failed: ${error?.message ?? error}`, 'error')
        this.emit('done', this.progress)
        return this.progress
      },
    )
    return this
  }

  private async run(): Promise<void> {
    const o = this.options
    const signal = this.abort.signal
    const writer = CrawlWriter.create(this.crawlId)
    const scope = createScope(o.startUrl, o.includeSubdomains)
    const limiter = new RateLimiter(1000 / o.requestsPerSecond)
    const externalPacer = new HostPacer(1000 / o.requestsPerSecond)
    const request = {
      timeoutMs: o.timeoutMs,
      userAgent: o.userAgent,
      headers: o.headers,
      signal,
    }
    // Custom headers are meant for the audited site, never for third parties.
    const foreignRequest = { ...request, headers: {} }
    const requestFor = (url: string) =>
      isInScope(url, scope) ? request : foreignRequest

    writer.setMeta('tool', 'url-tools')
    writer.setMeta('tool_version', TOOL_VERSION)
    writer.setMeta('crawl_id', this.crawlId)
    writer.setMeta('start_url', o.startUrl)
    writer.setMeta('started_at', new Date(this.startedAt).toISOString())
    writer.setMeta('status', 'running')
    writer.setMeta('source', o.source)
    writer.setMeta('config', { ...o, headers: Object.keys(o.headers) })

    const queue: QueueItem[] = []
    let head = 0
    const sitemapUrls = new Map<string, string>()
    const externalQueue: Array<{ id: number; url: string }> = []
    const externalSeen = new Set<number>()
    let fetchedCount = 0
    let finalStatus: CrawlStatus = 'completed'

    let discoveredCount = 0

    const ensure = (
      url: string,
      foundVia: FoundVia,
      depth: number | null,
    ): { id: number; created: boolean; internal: boolean } => {
      const internal = isInScope(url, scope)
      const result = writer.ensureUrl(url, internal, foundVia, depth)
      if (result.created) this.update({ discovered: ++discoveredCount })
      return { ...result, internal }
    }

    const enqueue = (
      url: string,
      foundVia: FoundVia,
      depth: number | null,
      hop: number,
    ) => {
      const { id, created, internal } = ensure(url, foundVia, depth)
      if (!internal) {
        if (o.checkExternal && !externalSeen.has(id)) {
          externalSeen.add(id)
          if (externalSeen.size <= CRAWL_LIMITS.maxExternalChecks) {
            externalQueue.push({ id, url })
          } else {
            writer.markState(id, 'not_checked', 'External check limit reached')
          }
        } else if (!o.checkExternal && created) {
          writer.markState(id, 'not_checked')
        }
        return id
      }
      if (!created) return id
      if (hop > o.maxDepth) {
        writer.markState(
          id,
          'skipped_limit',
          `Deeper than ${o.maxDepth} clicks`,
        )
        return id
      }
      if (!matchesPathFilters(url, o.includePaths, o.excludePaths) && hop > 0) {
        writer.markState(id, 'excluded', 'Excluded by path filter')
        return id
      }
      queue.push({ id, url, depth, hop })
      return id
    }

    // robots.txt per origin
    const robotsCache = new Map<string, Promise<RobotsPolicy>>()
    const robotsFor = (url: string): Promise<RobotsPolicy> => {
      const origin = new URL(url).origin
      let policy = robotsCache.get(origin)
      if (!policy) {
        policy = fetchRobotsPolicy(origin, request).then((result) => {
          if (result.kind === 'rules') {
            const delay = crawlDelaySeconds(result.robots, ROBOTS_TOKEN)
            if (delay && o.respectRobots) {
              const capped = Math.min(delay, CRAWL_LIMITS.maxCrawlDelaySeconds)
              limiter.setMinInterval(capped * 1000)
              this.log(
                `robots.txt asks for ${delay}s crawl delay (using ${capped}s)`,
                'warning',
              )
            }
          } else {
            this.log(
              `${origin}: ${result.reason}`,
              result.kind === 'disallow-all' ? 'warning' : 'info',
            )
          }
          return result
        })
        robotsCache.set(origin, policy)
      }
      return policy
    }

    const processResponse = (item: QueueItem, response: HttpResponse) => {
      const headers = response.headers
      const location = headers.location ? String(headers.location) : null
      const redirectUrl =
        response.status >= 300 && response.status < 400 && location
          ? normalizeCrawlUrl(location, item.url)
          : null
      const xRobots = xRobotsDirectives(headers['x-robots-tag'])
      const html = isHtmlMime(response.mime)

      writer.transaction(() => {
        writer.recordResponse(item.id, {
          statusCode: response.status,
          contentType: response.mime || null,
          isHtml: html,
          redirectUrl,
          responseMs: response.timeMs,
          sizeBytes: response.bytes,
          xRobotsTag: xRobots || null,
        })
        if (redirectUrl) {
          if (
            item.hop === 0 &&
            item.depth === 0 &&
            !isInScope(redirectUrl, scope)
          ) {
            this.log(
              `Start URL redirects to ${redirectUrl}, which is outside the crawl scope. Start the crawl there instead.`,
              'warning',
            )
          }
          // A redirect is not a click: the target keeps the depth.
          enqueue(redirectUrl, 'redirect', item.depth, item.hop)
          return
        }
        if (!html || response.body === null || response.status >= 400) return
        if (response.status < 200 || response.status >= 300) return

        const facts = parsePage(response.body, item.url)
        const headerLinks = parseLinkHeader(headers.link, item.url)
        const canonicals = [
          ...facts.canonicals,
          ...headerLinks
            .filter((l) => l.rel.includes('canonical'))
            .map((l) => l.url),
        ]
        const distinctCanonicals = [...new Set(canonicals)]
        const metaDirectives = parseRobotsDirectives(facts.metaRobots)
        const headerDirectives = parseRobotsDirectives(xRobots)
        writer.recordPage(item.id, {
          title: facts.title,
          titleCount: facts.titleCount,
          metaDescription: facts.metaDescription,
          metaDescriptionCount: facts.metaDescriptionCount,
          h1: facts.h1,
          h1Count: facts.h1Count,
          h2Count: facts.h2Count,
          metaRobots: facts.metaRobots,
          noindex: metaDirectives.noindex || headerDirectives.noindex,
          nofollow: metaDirectives.nofollow || headerDirectives.nofollow,
          canonicalUrl: distinctCanonicals[0] ?? null,
          canonicalCount: distinctCanonicals.length,
          canonicalRelative: facts.canonicalIsRelative,
          lang: facts.lang,
          metaRefreshUrl: facts.metaRefreshUrl,
          wordCount: facts.wordCount,
          contentHash: facts.contentHash,
          simhash: facts.simhash,
          imagesTotal: facts.imagesTotal,
          imagesMissingAlt: facts.imagesMissingAlt,
          insecureResources: facts.insecureResources,
        })

        const childDepth = item.depth === null ? null : item.depth + 1
        for (const link of facts.links) {
          const targetId = enqueue(link.url, 'link', childDepth, item.hop + 1)
          writer.addLink(
            item.id,
            targetId,
            link.anchor,
            link.rel,
            link.nofollow,
          )
        }
        // Canonical and hreflang targets are crawled too, so their status is known.
        for (const canonical of distinctCanonicals) {
          if (canonical !== item.url) {
            enqueue(canonical, 'canonical', childDepth, item.hop + 1)
          }
        }
        const alternates = [
          ...facts.hreflang,
          ...headerLinks
            .filter((l) => l.rel.includes('alternate') && l.hreflang)
            .map((l) => ({ lang: l.hreflang as string, url: l.url })),
        ]
        for (const alternate of alternates) {
          const targetId =
            alternate.url === item.url
              ? item.id
              : enqueue(alternate.url, 'hreflang', childDepth, item.hop + 1)
          writer.addHreflang(item.id, alternate.lang, targetId)
        }
      })
    }

    const crawlOne = async (item: QueueItem) => {
      this.update({ currentUrl: item.url })
      if (o.respectRobots) {
        const policy = await robotsFor(item.url)
        if (!policyAllows(policy, item.url, ROBOTS_TOKEN)) {
          writer.markState(
            item.id,
            'blocked_robots',
            policy.kind === 'disallow-all'
              ? policy.reason
              : 'Disallowed by robots.txt',
          )
          this.update({ blocked: this.progressState.blocked + 1 })
          return
        }
      }
      if (fetchedCount >= o.maxUrls) {
        writer.markState(
          item.id,
          'skipped_limit',
          `URL limit (${o.maxUrls}) reached`,
        )
        return
      }
      fetchedCount++
      await limiter.wait(signal)
      if (signal.aborted) {
        fetchedCount--
        return
      }
      try {
        const response = await httpRequest(item.url, {
          ...request,
          method: 'GET',
          wantBody: (status, mime) =>
            status >= 200 && status < 300 && isHtmlMime(mime),
        })
        processResponse(item, response)
        this.update({ fetched: this.progressState.fetched + 1 })
      } catch (error) {
        const err = error as FetchError
        if (err.code === 'aborted') {
          fetchedCount--
          return
        }
        writer.markState(
          item.id,
          err.code === 'blocked_target' ? 'blocked_target' : 'failed',
          err.message,
        )
        this.update({ failed: this.progressState.failed + 1 })
        this.log(`${item.url}: ${err.message}`, 'error')
      }
    }

    const internalWorkers = async () => {
      let active = 0
      const worker = async () => {
        while (!signal.aborted) {
          const item = queue[head]
          if (!item) {
            // Other workers may still add URLs; wait for them before quitting.
            if (active === 0) return
            await new Promise((resolve) => setTimeout(resolve, 20))
            continue
          }
          head++
          active++
          try {
            await crawlOne(item)
          } finally {
            active--
            this.update({ queued: queue.length - head })
          }
        }
      }
      await Promise.all(Array.from({ length: o.concurrency }, worker))
    }

    const externalWorkers = async (internalsDone: () => boolean) => {
      let index = 0
      const worker = async () => {
        while (!signal.aborted) {
          const next = externalQueue[index]
          if (next === undefined) {
            if (internalsDone()) return
            await new Promise((resolve) => setTimeout(resolve, 50))
            continue
          }
          index++
          const { id, url } = next
          await externalPacer.wait(url, signal)
          if (signal.aborted) return
          const result = await checkUrlStatus(url, foreignRequest)
          if (result.errorCode === 'aborted') return
          writer.recordExternal(id, {
            state: result.errorCode
              ? result.errorCode === 'blocked_target'
                ? 'blocked_target'
                : 'failed'
              : 'fetched',
            statusCode: result.status || null,
            finalUrl: result.finalUrl,
            finalStatus: result.finalStatus || null,
            redirectHops: result.hops,
            error: result.error ?? null,
          })
          this.update({
            externalChecked: this.progressState.externalChecked + 1,
            externalQueued: externalQueue.length - index,
          })
        }
      }
      await Promise.all(Array.from({ length: 4 }, worker))
    }

    try {
      this.log(`Crawling ${o.startUrl}`, 'info')
      this.update({ phase: 'crawling' }, true)
      const seed = enqueue(o.startUrl, 'seed', 0, 0)

      // Sitemap discovery runs before the crawl but its URLs are only crawled
      // after the link frontier, so link depth stays accurate.
      if (o.useSitemaps) {
        await this.discoverSitemaps(
          o.startUrl,
          requestFor,
          robotsFor,
          sitemapUrls,
          (s) => limiter.wait(s),
        )
      }

      let internalsDone = false
      const externals = externalWorkers(() => internalsDone)
      await internalWorkers()

      // Sitemap URLs: flag the ones already known, crawl the ones only found
      // in the sitemap (orphan candidates) as far as the URL budget allows.
      if (sitemapUrls.size > 0) {
        this.update({ phase: 'sitemaps' }, true)
        let budget = signal.aborted ? 0 : Math.max(o.maxUrls - fetchedCount, 0)
        let added = 0
        let skipped = 0
        writer.transaction(() => {
          for (const [url, sitemap] of sitemapUrls) {
            const known = writer.idOf(url)
            if (known !== undefined) {
              writer.addSitemapUrl(known, sitemap)
              continue
            }
            if (!isInScope(url, scope) || budget <= 0) {
              skipped++
              continue
            }
            if (!matchesPathFilters(url, o.includePaths, o.excludePaths)) {
              skipped++
              continue
            }
            const { id } = ensure(url, 'sitemap', null)
            writer.addSitemapUrl(id, sitemap)
            queue.push({ id, url, depth: null, hop: 0 })
            budget--
            added++
          }
        })
        if (skipped > 0) {
          this.log(
            `${skipped} sitemap URLs not crawled (other host, path filter or URL limit)`,
            'info',
          )
        }
        if (added > 0) {
          this.log(
            `${added} URLs only found in the sitemap, crawling them`,
            'info',
          )
          await internalWorkers()
        }
      }
      internalsDone = true
      this.update({ phase: 'externals' }, true)
      await externals

      if (signal.aborted) finalStatus = 'stopped'

      // Mark everything that was discovered but never fetched.
      writer.db.exec(
        `UPDATE urls SET crawl_state = 'skipped_limit', error = COALESCE(error, 'Crawl stopped before this URL')
         WHERE crawl_state = 'pending'`,
      )

      this.update({ phase: 'analyzing', currentUrl: null }, true)
      this.log('Analyzing crawl data', 'info')
      const counts = analyzeCrawl(writer.db, {
        startUrlId: seed,
        sitemapsChecked: o.useSitemaps,
        sitemapUrlCount: sitemapUrls.size,
      })
      const issueCount = Object.values(counts).reduce((a, b) => a + b, 0)
      writer.setMeta('issue_counts', counts)
      writer.setMeta('stats', {
        fetched: this.progressState.fetched,
        failed: this.progressState.failed,
        blocked: this.progressState.blocked,
        discovered: discoveredCount,
        externalChecked: this.progressState.externalChecked,
        sitemapUrls: sitemapUrls.size,
        durationMs: Date.now() - this.startedAt,
      })
      writer.setMeta('finished_at', new Date().toISOString())
      writer.setMeta('status', finalStatus)
      this.update({ status: finalStatus, phase: 'done', issueCount }, true)
      this.log(
        `Crawl ${finalStatus}: ${this.progressState.fetched} URLs fetched, ${issueCount} findings`,
        'success',
      )
    } catch (error) {
      writer.setMeta('status', 'failed')
      writer.setMeta('error', String((error as Error)?.message ?? error))
      writer.setMeta('finished_at', new Date().toISOString())
      throw error
    } finally {
      writer.close()
    }
    this.emit('done', this.progress)
  }

  private async discoverSitemaps(
    startUrl: string,
    requestFor: (url: string) => {
      timeoutMs: number
      userAgent: string
      headers: Record<string, string>
      signal: AbortSignal
    },
    robotsFor: (url: string) => Promise<RobotsPolicy>,
    found: Map<string, string>,
    pace: (signal: AbortSignal) => Promise<void>,
  ) {
    const policy = await robotsFor(startUrl)
    const origin = new URL(startUrl).origin
    const declared =
      policy.kind === 'rules'
        ? policy.robots.sitemaps
            .map((url) => normalizeCrawlUrl(url, origin))
            .filter((url): url is string => Boolean(url))
        : []
    const roots = declared.length > 0 ? declared : [`${origin}/sitemap.xml`]
    const queue = [...new Set(roots)]
    const seen = new Set<string>()
    while (queue.length > 0 && seen.size < CRAWL_LIMITS.maxSitemaps) {
      const url = queue.shift() as string
      if (seen.has(url)) continue
      seen.add(url)
      const request = requestFor(url)
      if (request.signal.aborted) return
      if (/\.gz$/i.test(new URL(url).pathname)) {
        this.log(
          `Sitemap ${url}: gzip files are not supported yet, skipped`,
          'warning',
        )
        continue
      }
      try {
        await pace(request.signal)
        const response = await httpRequest(url, { ...request, method: 'GET' })
        if (response.status !== 200 || !response.body) continue
        const { entries, childSitemaps } = parseSitemapXml(response.body, url)
        for (const entry of entries) {
          if (found.size >= CRAWL_LIMITS.maxSitemapUrls) break
          const normalized = normalizeCrawlUrl(entry.loc)
          if (normalized && !found.has(normalized)) found.set(normalized, url)
        }
        for (const child of childSitemaps) {
          const normalized = normalizeCrawlUrl(child)
          if (normalized) queue.push(normalized)
        }
      } catch (error) {
        this.log(`Sitemap ${url}: ${(error as Error).message}`, 'warning')
      }
    }
    if (found.size > 0) {
      this.log(`Sitemaps: ${found.size} URLs in ${seen.size} file(s)`, 'info')
    }
  }
}

// --- Job registry (in-memory; finished crawls live in their files) ---

const jobs = new Map<string, CrawlJob>()

export function startCrawl(options: CrawlOptions): CrawlJob {
  const running = [...jobs.values()].filter((job) => job.isRunning).length
  if (running >= CRAWL_LIMITS.maxRunningCrawls) {
    throw new Error(
      `${running} crawls are already running, wait for one to finish or stop one`,
    )
  }
  const job = new CrawlJob(resolveCrawlOptions(options))
  jobs.set(job.crawlId, job)
  job.start()
  // Forget finished jobs after a while; the crawl file stays.
  job.done.finally(() => {
    setTimeout(() => jobs.delete(job.crawlId), 10 * 60_000).unref?.()
  })
  return job
}

export function getCrawlJob(crawlId: string): CrawlJob | undefined {
  return jobs.get(crawlId)
}

export function runningCrawlJobs(): CrawlJob[] {
  return [...jobs.values()].filter((job) => job.isRunning)
}
