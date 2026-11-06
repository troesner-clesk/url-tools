<script lang="ts">
// Module-level state survives tab switches (the component is unmounted then).
// Log lines already written to the drawer, per crawl: the events stream
// replays recent lines on every reconnect.
const seenLogKeys = new Map<string, Set<string>>()
// Crawls this tab followed live; lets a remount report crawls that finished
// while the tab was closed.
const followedCrawls = new Set<string>()
const remembered: {
  selectedId: string | null
  view: 'overview' | 'issues' | 'urls'
} = { selectedId: null, view: 'overview' }
</script>

<script setup lang="ts">
import { Download, Loader, Play, Radar, RotateCw, Square } from '@lucide/vue'
import {
  apiErrorMessage,
  type CrawlLogEntry,
  type CrawlOverview,
  type CrawlProgress,
  type CrawlStatus,
  type CrawlSummary,
  crawlDurationMs,
  formatDateTime,
  formatDuration,
  formatNumber,
  PHASE_LABELS,
  SITE_AUDIT_LIMITS,
  shortUrl,
} from '~/utils/site-audit'

type View = 'overview' | 'issues' | 'urls'

const { addLog, setRunning, setCurrentUrl } = useTabLogger('site-audit')

// --- Form -----------------------------------------------------------------
const startUrl = ref('')
const maxUrls = ref<number>(SITE_AUDIT_LIMITS.maxUrls.default)
const maxDepth = ref<number>(SITE_AUDIT_LIMITS.maxDepth.default)
const concurrency = ref<number>(SITE_AUDIT_LIMITS.concurrency.default)
const requestsPerSecond = ref<number>(
  SITE_AUDIT_LIMITS.requestsPerSecond.default,
)
const respectRobots = ref(true)
const checkExternal = ref(true)
const useSitemaps = ref(true)
const includeSubdomains = ref(false)
const includePaths = ref('')
const excludePaths = ref('')
const starting = ref(false)
const formError = ref<string | null>(null)

function normalizeStartUrl(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`
  try {
    const url = new URL(withScheme)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.toString()
  } catch {
    return null
  }
}

function clampInt(value: unknown, min: number, max: number, fallback: number) {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n)) return fallback
  return Math.min(Math.max(n, min), max)
}

const normalizedStartUrl = computed(() => normalizeStartUrl(startUrl.value))

// --- Crawl list and live progress -----------------------------------------
const crawls = ref<CrawlSummary[]>([])
const listLoading = ref(false)
const listError = ref<string | null>(null)
const progressById = reactive<Record<string, CrawlProgress>>({})
const stopping = reactive<Record<string, boolean>>({})
const sources = new Map<string, EventSource>()
let retryTimer: ReturnType<typeof setTimeout> | null = null
let unmounted = false

async function loadCrawls() {
  listLoading.value = true
  listError.value = null
  try {
    const data = await $fetch<{ crawls: CrawlSummary[] }>(
      '/api/site-audit/crawls',
    )
    if (unmounted) return
    crawls.value = data.crawls
    for (const crawl of data.crawls) {
      if (crawl.status === 'running') {
        if (crawl.progress) progressById[crawl.crawlId] = crawl.progress
        connect(crawl.crawlId)
      }
    }
  } catch (e) {
    listError.value = apiErrorMessage(e, 'Could not load crawls')
  } finally {
    listLoading.value = false
  }
}

function logFromServer(crawlId: string, entry: CrawlLogEntry) {
  let seen = seenLogKeys.get(crawlId)
  if (!seen) {
    seen = new Set()
    seenLogKeys.set(crawlId, seen)
  }
  const key = `${entry.time}|${entry.message}`
  if (seen.has(key)) return
  seen.add(key)
  if (seen.size > 1000) {
    const oldest = seen.values().next().value
    if (oldest) seen.delete(oldest)
  }
  const prefix = sources.size > 1 ? `[${hostOf(crawlId)}] ` : ''
  if (entry.type === 'warning') {
    addLog(`${prefix}Warning: ${entry.message}`, 'info')
  } else {
    addLog(`${prefix}${entry.message}`, entry.type)
  }
}

function hostOf(crawlId: string): string {
  const url =
    progressById[crawlId]?.startUrl ??
    crawls.value.find((c) => c.crawlId === crawlId)?.startUrl
  try {
    return url ? new URL(url).host : crawlId
  } catch {
    return crawlId
  }
}

function parse<T>(event: MessageEvent): T | null {
  try {
    return JSON.parse(event.data) as T
  } catch {
    return null
  }
}

function connect(crawlId: string) {
  if (sources.has(crawlId) || unmounted) return
  const es = new EventSource(
    `/api/site-audit/crawls/${encodeURIComponent(crawlId)}/events`,
  )
  sources.set(crawlId, es)
  followedCrawls.add(crawlId)
  syncRunningState()

  es.addEventListener('progress', (event) => {
    const progress = parse<CrawlProgress>(event as MessageEvent)
    if (!progress) return
    progressById[crawlId] = progress
    syncRunningState()
  })
  es.addEventListener('log', (event) => {
    const entry = parse<CrawlLogEntry>(event as MessageEvent)
    if (entry) logFromServer(crawlId, entry)
  })
  es.addEventListener('done', () => {
    disconnect(crawlId)
    delete progressById[crawlId]
    delete stopping[crawlId]
    syncRunningState()
    onCrawlFinished(crawlId)
  })
  es.onerror = () => {
    // Server restart or network hiccup: drop the stream and re-check the
    // list shortly; loadCrawls() reconnects crawls that are still running.
    disconnect(crawlId)
    syncRunningState()
    if (!retryTimer && !unmounted) {
      retryTimer = setTimeout(() => {
        retryTimer = null
        loadCrawls()
      }, 3000)
    }
  }
}

function disconnect(crawlId: string) {
  sources.get(crawlId)?.close()
  sources.delete(crawlId)
}

/**
 * A followed crawl ended. While the stream is open the server logs the
 * summary itself; a crawl that ended while the tab was closed gets one here.
 */
async function onCrawlFinished(crawlId: string, endedWhileAway = false) {
  followedCrawls.delete(crawlId)
  if (!endedWhileAway) await loadCrawls()
  const crawl = crawls.value.find((c) => c.crawlId === crawlId)
  if (crawl && endedWhileAway) {
    const total = crawl.issues.error + crawl.issues.warning + crawl.issues.notice
    addLog(
      `Crawl of ${hostOf(crawlId)} ${crawl.status} while this tab was closed: ${formatNumber(crawl.urlsFetched)} URLs, ${formatNumber(total)} issues`,
      crawl.status === 'completed' ? 'success' : 'info',
    )
  }
  if (selectedId.value === crawlId) {
    await loadOverview()
    reloadKey.value++
  }
}

const runningIds = computed(() =>
  Object.keys(progressById).filter(
    (id) => progressById[id]?.status === 'running',
  ),
)

/** The running crawl shown in the progress block: the selected one, else the newest. */
const activeProgress = computed<CrawlProgress | null>(() => {
  if (selectedId.value && runningIds.value.includes(selectedId.value)) {
    return progressById[selectedId.value] ?? null
  }
  const newest = crawls.value.find((c) => runningIds.value.includes(c.crawlId))
  const id = newest?.crawlId ?? runningIds.value[0]
  return id ? (progressById[id] ?? null) : null
})

function syncRunningState() {
  setRunning(sources.size > 0)
  setCurrentUrl(activeProgress.value?.currentUrl ?? null)
}

async function startCrawl() {
  formError.value = null
  const url = normalizedStartUrl.value
  if (!url) {
    formError.value = 'Enter a valid http(s) URL.'
    return
  }
  const L = SITE_AUDIT_LIMITS
  const body = {
    startUrl: url,
    maxUrls: clampInt(maxUrls.value, 1, L.maxUrls.max, L.maxUrls.default),
    maxDepth: clampInt(maxDepth.value, 0, L.maxDepth.max, L.maxDepth.default),
    concurrency: clampInt(
      concurrency.value,
      1,
      L.concurrency.max,
      L.concurrency.default,
    ),
    requestsPerSecond: clampInt(
      requestsPerSecond.value,
      1,
      L.requestsPerSecond.max,
      L.requestsPerSecond.default,
    ),
    respectRobots: respectRobots.value,
    checkExternal: checkExternal.value,
    useSitemaps: useSitemaps.value,
    includeSubdomains: includeSubdomains.value,
    includePaths: includePaths.value.trim(),
    excludePaths: excludePaths.value.trim(),
  }
  starting.value = true
  try {
    const res = await $fetch<{ crawlId: string; progress: CrawlProgress }>(
      '/api/site-audit/crawls',
      { method: 'POST', body },
    )
    progressById[res.crawlId] = res.progress
    addLog(
      `Started crawl of ${url} (max ${formatNumber(body.maxUrls)} URLs, depth ${body.maxDepth})`,
      'info',
    )
    selectCrawl(res.crawlId)
    connect(res.crawlId)
    await loadCrawls()
  } catch (e) {
    const message = apiErrorMessage(e, 'Could not start the crawl')
    formError.value = message
    addLog(`Start failed: ${message}`, 'error')
  } finally {
    starting.value = false
  }
}

async function stopCrawl(crawlId: string) {
  if (stopping[crawlId]) return
  stopping[crawlId] = true
  addLog(`Stopping crawl of ${hostOf(crawlId)}...`, 'info')
  try {
    await $fetch(
      `/api/site-audit/crawls/${encodeURIComponent(crawlId)}/stop`,
      { method: 'POST' },
    )
  } catch (e) {
    stopping[crawlId] = false
    addLog(`Stop failed: ${apiErrorMessage(e)}`, 'error')
  }
}

// --- Selected crawl -------------------------------------------------------
const selectedId = ref<string | null>(null)
const view = ref<View>(remembered.view)
const overview = ref<CrawlOverview | null>(null)
const overviewLoading = ref(false)
const overviewError = ref<string | null>(null)
const selectedIssueId = ref<string | null>(null)
const urlFilter = ref('all')
const detailUrl = ref<string | null>(null)
const reloadKey = ref(0)

const selectedCrawl = computed(
  () => crawls.value.find((c) => c.crawlId === selectedId.value) ?? null,
)
const selectedRunning = computed(
  () =>
    !!selectedId.value &&
    (runningIds.value.includes(selectedId.value) ||
      selectedCrawl.value?.status === 'running'),
)

function selectCrawl(crawlId: string) {
  if (selectedId.value === crawlId) return
  selectedId.value = crawlId
  remembered.selectedId = crawlId
  selectedIssueId.value = null
  urlFilter.value = 'all'
  detailUrl.value = null
  overview.value = null
  loadOverview()
}

let overviewSeq = 0
async function loadOverview() {
  const id = selectedId.value
  if (!id) return
  const seq = ++overviewSeq
  overviewLoading.value = true
  overviewError.value = null
  try {
    const data = await $fetch<CrawlOverview>(
      `/api/site-audit/crawls/${encodeURIComponent(id)}/overview`,
    )
    if (seq === overviewSeq) overview.value = data
  } catch (e) {
    if (seq === overviewSeq) {
      overviewError.value = apiErrorMessage(e, 'Could not load the crawl')
    }
  } finally {
    if (seq === overviewSeq) overviewLoading.value = false
  }
}

function refreshSelected() {
  loadOverview()
  reloadKey.value++
}

watch(view, (v) => {
  remembered.view = v
})

function openIssue(issueId: string | null) {
  if (issueId) selectedIssueId.value = issueId
  view.value = 'issues'
}

function openUrls(filter: string) {
  urlFilter.value = filter
  view.value = 'urls'
}

function openUrl(url: string) {
  detailUrl.value = url
}

function exportHref(kind: 'issues' | 'urls' | 'links') {
  return `/api/site-audit/crawls/${encodeURIComponent(selectedId.value ?? '')}/export?kind=${kind}`
}

const headerCrawl = computed(() => overview.value?.crawl ?? selectedCrawl.value)

const issueTotal = computed(() => {
  const c = headerCrawl.value
  return c ? c.issues.error + c.issues.warning + c.issues.notice : 0
})

const STATUS_LABELS: Record<CrawlStatus, string> = {
  running: 'Running',
  completed: 'Completed',
  stopped: 'Stopped',
  failed: 'Failed',
  interrupted: 'Interrupted',
}

function statusLabel(crawl: CrawlSummary): string {
  if (runningIds.value.includes(crawl.crawlId)) return 'Running'
  return STATUS_LABELS[crawl.status] ?? crawl.status
}

function statusClass(crawl: CrawlSummary): string {
  if (runningIds.value.includes(crawl.crawlId)) return 'st-running'
  return `st-${crawl.status}`
}

function liveDuration(crawl: CrawlSummary): string {
  const progress = progressById[crawl.crawlId]
  if (progress && progress.status === 'running') {
    return formatDuration(progress.elapsedMs)
  }
  return formatDuration(crawlDurationMs(crawl))
}

function fetchedCount(crawl: CrawlSummary): number {
  return progressById[crawl.crawlId]?.fetched ?? crawl.urlsFetched
}

// --- Lifecycle ------------------------------------------------------------
// The parent <main> has no definite height for percentages, so the panel
// height is derived from its offset to keep the inner areas scrollable.
const rootEl = ref<HTMLElement | null>(null)
const panelTop = ref(60)
function measurePanelTop() {
  const top = rootEl.value?.parentElement?.getBoundingClientRect().top
  if (top !== undefined) panelTop.value = Math.max(0, Math.round(top))
}

onMounted(async () => {
  unmounted = false
  measurePanelTop()
  window.addEventListener('resize', measurePanelTop)
  await loadCrawls()
  for (const id of [...followedCrawls]) {
    if (!sources.has(id)) onCrawlFinished(id, true)
  }
  const remember = remembered.selectedId
  const initial =
    (remember && crawls.value.some((c) => c.crawlId === remember)
      ? remember
      : null) ?? crawls.value[0]?.crawlId
  if (initial) selectCrawl(initial)
})

onBeforeUnmount(() => {
  unmounted = true
  window.removeEventListener('resize', measurePanelTop)
  if (retryTimer) clearTimeout(retryTimer)
  retryTimer = null
  for (const id of [...sources.keys()]) disconnect(id)
  // The crawl keeps running on the server; the drawer just stops following.
  setRunning(false)
  setCurrentUrl(null)
})
</script>

<template>
  <div
    ref="rootEl"
    class="site-audit-container"
    :style="{ '--sa-panel-top': `${panelTop}px` }"
  >
    <!-- Left: Input Section -->
    <div class="input-section">
      <h2><Radar :size="18" /> Site Audit</h2>
      <p class="subtitle">
        Crawl a whole website and find technical SEO issues
        <HelpTooltip text="The crawler follows internal links from the start URL, stores every URL with its links, then runs site-wide checks (redirects, canonicals, duplicates, indexability and more). Crawls keep running on the server when you switch tabs." />
      </p>

      <form class="start-form" @submit.prevent="startCrawl">
        <div class="url-input">
          <label for="site-audit-start-url">Start URL</label>
          <input
            id="site-audit-start-url"
            v-model="startUrl"
            type="text"
            inputmode="url"
            autocomplete="url"
            spellcheck="false"
            placeholder="https://example.com/"
            :aria-invalid="startUrl.trim() !== '' && !normalizedStartUrl"
          >
        </div>

        <AdvancedOptions tab-id="site-audit">
          <div class="option-grid">
            <div class="option">
              <label for="sa-max-urls">Max URLs <HelpTooltip :text="`Stop after this many internal URLs have been fetched (1 to ${formatNumber(SITE_AUDIT_LIMITS.maxUrls.max)}).`" /></label>
              <input id="sa-max-urls" v-model.number="maxUrls" type="number" min="1" :max="SITE_AUDIT_LIMITS.maxUrls.max">
            </div>
            <div class="option">
              <label for="sa-max-depth">Max depth <HelpTooltip :text="`How many clicks away from the start URL the crawler may go (0 to ${SITE_AUDIT_LIMITS.maxDepth.max}).`" /></label>
              <input id="sa-max-depth" v-model.number="maxDepth" type="number" min="0" :max="SITE_AUDIT_LIMITS.maxDepth.max">
            </div>
            <div class="option">
              <label for="sa-concurrency">Parallel requests <HelpTooltip :text="`How many URLs are fetched at the same time (1 to ${SITE_AUDIT_LIMITS.concurrency.max}).`" /></label>
              <input id="sa-concurrency" v-model.number="concurrency" type="number" min="1" :max="SITE_AUDIT_LIMITS.concurrency.max">
            </div>
            <div class="option">
              <label for="sa-rps">Requests per second <HelpTooltip :text="`Upper limit for requests per second against the site (1 to ${SITE_AUDIT_LIMITS.requestsPerSecond.max}). A crawl-delay in robots.txt can slow this down further.`" /></label>
              <input id="sa-rps" v-model.number="requestsPerSecond" type="number" min="1" :max="SITE_AUDIT_LIMITS.requestsPerSecond.max">
            </div>
          </div>

          <div class="option checkbox">
            <label>
              <input v-model="respectRobots" type="checkbox">
              Respect robots.txt <HelpTooltip text="Skip URLs that robots.txt disallows and honour its crawl-delay. If you turn this off, disallowed URLs are crawled too." />
            </label>
          </div>
          <div class="option checkbox">
            <label>
              <input v-model="checkExternal" type="checkbox">
              Check external links <HelpTooltip text="Send a request to every linked external URL to find broken outbound links. If you turn this off, external links are listed but not checked." />
            </label>
          </div>
          <div class="option checkbox">
            <label>
              <input v-model="useSitemaps" type="checkbox">
              Use XML sitemaps <HelpTooltip text="Read the sitemaps from robots.txt and /sitemap.xml, crawl the URLs listed there and compare them with the linked pages." />
            </label>
          </div>
          <div class="option checkbox">
            <label>
              <input v-model="includeSubdomains" type="checkbox">
              Include subdomains <HelpTooltip text="Treat subdomains (e.g. blog.example.com) as part of the site. Otherwise only the start URL's host is crawled." />
            </label>
          </div>

          <div class="option">
            <label for="sa-include">Include paths <HelpTooltip text="Comma-separated path prefixes, e.g. /blog, /shop. Only matching URLs are crawled. Leave empty to crawl everything." /></label>
            <input id="sa-include" v-model="includePaths" type="text" placeholder="/blog, /shop" spellcheck="false">
          </div>
          <div class="option">
            <label for="sa-exclude">Exclude paths <HelpTooltip text="Comma-separated path prefixes that are never crawled, e.g. /cart, /search." /></label>
            <input id="sa-exclude" v-model="excludePaths" type="text" placeholder="/cart, /search" spellcheck="false">
          </div>
        </AdvancedOptions>

        <div class="button-row">
          <button type="submit" class="btn-primary" :disabled="!normalizedStartUrl || starting">
            <template v-if="starting"><Loader :size="14" class="spin" /> Starting...</template>
            <template v-else><Play :size="14" /> Start crawl</template>
          </button>
          <button
            v-if="activeProgress"
            type="button"
            class="btn-stop"
            :disabled="stopping[activeProgress.crawlId]"
            @click="stopCrawl(activeProgress.crawlId)"
          >
            <Square :size="12" /> {{ stopping[activeProgress.crawlId] ? 'Stopping...' : 'Stop' }}
          </button>
        </div>
      </form>

      <div v-if="formError" class="error-message" role="alert">{{ formError }}</div>

      <!-- Live progress of a running crawl -->
      <section v-if="activeProgress" class="progress-block" aria-live="polite" aria-label="Crawl progress">
        <div class="progress-head">
          <Loader :size="13" class="spin" aria-hidden="true" />
          <span class="progress-host" :title="activeProgress.startUrl">{{ shortUrl(activeProgress.startUrl) }}</span>
          <span class="phase-badge">{{ PHASE_LABELS[activeProgress.phase] ?? activeProgress.phase }}</span>
        </div>
        <dl class="progress-grid">
          <div><dt>Fetched</dt><dd>{{ formatNumber(activeProgress.fetched) }}</dd></div>
          <div><dt>Queued</dt><dd>{{ formatNumber(activeProgress.queued) }}</dd></div>
          <div><dt>Failed</dt><dd>{{ formatNumber(activeProgress.failed) }}</dd></div>
          <div><dt>Blocked</dt><dd>{{ formatNumber(activeProgress.blocked) }}</dd></div>
          <div>
            <dt>External</dt>
            <dd>{{ formatNumber(activeProgress.externalChecked) }}<span v-if="activeProgress.externalQueued" class="muted"> / {{ formatNumber(activeProgress.externalChecked + activeProgress.externalQueued) }}</span></dd>
          </div>
          <div><dt>Elapsed</dt><dd>{{ formatDuration(activeProgress.elapsedMs) }}</dd></div>
        </dl>
        <div v-if="activeProgress.currentUrl" class="current-url" :title="activeProgress.currentUrl">
          {{ activeProgress.currentUrl }}
        </div>
        <p v-if="runningIds.length > 1" class="muted small">
          {{ runningIds.length }} crawls are running.
        </p>
      </section>

      <!-- Previous crawls -->
      <section class="history-section" aria-labelledby="site-audit-crawls-title">
        <div class="history-header">
          <h4 id="site-audit-crawls-title">Crawls</h4>
          <button
            type="button"
            class="btn-clear"
            :disabled="listLoading"
            aria-label="Reload crawl list"
            title="Reload"
            @click="loadCrawls"
          >
            <RotateCw :size="11" />
          </button>
        </div>
        <div v-if="listError" class="error-message" role="alert">{{ listError }}</div>
        <p v-else-if="!crawls.length && !listLoading" class="muted small">No crawls yet.</p>
        <ul class="crawl-list">
          <li v-for="crawl in crawls" :key="crawl.crawlId">
            <button
              type="button"
              :class="['crawl-item', { active: crawl.crawlId === selectedId }]"
              :aria-current="crawl.crawlId === selectedId ? 'true' : undefined"
              @click="selectCrawl(crawl.crawlId)"
            >
              <span class="crawl-top">
                <span class="crawl-url" :title="crawl.startUrl">{{ shortUrl(crawl.startUrl) }}</span>
                <span :class="['status-badge', statusClass(crawl)]">{{ statusLabel(crawl) }}</span>
              </span>
              <span class="crawl-meta">
                <span>{{ formatDateTime(crawl.startedAt) }}</span>
                <span>{{ formatNumber(fetchedCount(crawl)) }} URLs</span>
              </span>
              <span class="crawl-counts">
                <span><span class="sev-error">{{ formatNumber(crawl.issues.error) }}</span> errors</span>
                <span><span class="sev-warning">{{ formatNumber(crawl.issues.warning) }}</span> warnings</span>
                <span><span class="sev-notice">{{ formatNumber(crawl.issues.notice) }}</span> notices</span>
              </span>
            </button>
          </li>
        </ul>
      </section>
    </div>

    <!-- Right: Results Section -->
    <div class="results-section">
      <template v-if="selectedId && headerCrawl">
        <div class="crawl-header">
          <div class="crawl-title-row">
            <h3 class="crawl-title" :title="headerCrawl.startUrl">{{ headerCrawl.startUrl }}</h3>
            <span :class="['status-badge', statusClass(headerCrawl)]">{{ statusLabel(headerCrawl) }}</span>
          </div>
          <div class="crawl-facts">
            <span>Started {{ formatDateTime(headerCrawl.startedAt) }}</span>
            <span>Duration {{ liveDuration(headerCrawl) }}</span>
            <span>{{ formatNumber(fetchedCount(headerCrawl)) }} URLs fetched</span>
            <span class="export-links">
              <Download :size="12" aria-hidden="true" />
              <a :href="exportHref('issues')" download>Issues CSV</a>
              <a :href="exportHref('urls')" download>URLs CSV</a>
              <a :href="exportHref('links')" download>Links CSV</a>
            </span>
          </div>
        </div>

        <div v-if="selectedRunning" class="running-note">
          <span>Crawl in progress. Issues are calculated when the crawl finishes; the URL table already shows what has been fetched.</span>
          <button type="button" class="btn-secondary-sm" @click="refreshSelected">Refresh</button>
        </div>

        <nav class="view-tabs" aria-label="Crawl views">
          <button
            type="button"
            :class="['view-tab', { active: view === 'overview' }]"
            :aria-current="view === 'overview' ? 'page' : undefined"
            @click="view = 'overview'"
          >Overview</button>
          <button
            type="button"
            :class="['view-tab', { active: view === 'issues' }]"
            :aria-current="view === 'issues' ? 'page' : undefined"
            @click="view = 'issues'"
          >Issues <span class="tab-count">{{ formatNumber(issueTotal) }}</span></button>
          <button
            type="button"
            :class="['view-tab', { active: view === 'urls' }]"
            :aria-current="view === 'urls' ? 'page' : undefined"
            @click="view = 'urls'"
          >URLs <span v-if="overview" class="tab-count">{{ formatNumber(overview.totals.urls) }}</span></button>
        </nav>

        <div :class="['view-body', `view-${view}`]">
          <template v-if="view === 'overview'">
            <div v-if="overviewError" class="error-message" role="alert">{{ overviewError }}</div>
            <SiteAuditOverview
              v-else-if="overview"
              :overview="overview"
              @open-issue="openIssue"
              @open-urls="openUrls"
            />
            <p v-else-if="overviewLoading" class="muted">Loading overview...</p>
          </template>

          <SiteAuditIssues
            v-else-if="view === 'issues'"
            v-model:selected-id="selectedIssueId"
            :crawl-id="selectedId"
            :running="selectedRunning"
            :reload-key="reloadKey"
            @open-url="openUrl"
          />

          <SiteAuditUrlTable
            v-else
            v-model:filter="urlFilter"
            :crawl-id="selectedId"
            :reload-key="reloadKey"
            show-filter
            @open-url="openUrl"
          />
        </div>

        <SiteAuditUrlDetail
          :crawl-id="selectedId"
          :url="detailUrl"
          @close="detailUrl = null"
          @open-issue="openIssue"
        />
      </template>

      <div v-else-if="listLoading" class="empty-state">
        <p>Loading crawls...</p>
      </div>

      <div v-else class="empty-state">
        <p>No crawl selected</p>
        <p class="hint">Enter a start URL and click "Start crawl", or open a previous crawl.</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.site-audit-container {
  display: grid;
  grid-template-columns: 360px 1fr;
  height: calc(100vh - var(--sa-panel-top, 60px));
  overflow: hidden;
}

/* Link colour with enough contrast on both themes (accent is too dark on
   the dark background). Inherited by the subcomponents and the dialog. */
.site-audit-container {
  --sa-link: var(--accent);
}

[data-theme="dark"] .site-audit-container {
  --sa-link: var(--info);
}

.input-section {
  padding: 16px;
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
}

.input-section h2 {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text-primary);
  font-size: 16px;
}

.subtitle {
  color: var(--text-secondary);
  font-size: 13px;
  margin-bottom: 4px;
}

.start-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.url-input label,
.option label {
  display: block;
  margin-bottom: 6px;
  font-size: 13px;
  color: var(--text-secondary);
}

.url-input input,
.option input[type="number"],
.option input[type="text"] {
  width: 100%;
  padding: 10px 12px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text-primary);
  font-family: 'SF Mono', Monaco, monospace;
  font-size: 12px;
}

.option input[type="number"],
.option input[type="text"] {
  padding: 8px 10px;
}

.url-input input:focus,
.option input:focus {
  outline: none;
  border-color: var(--accent);
}

.url-input input[aria-invalid="true"] {
  border-color: var(--error);
}

.option-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.option-grid .option label {
  font-size: 12px;
  white-space: nowrap;
}

.option.checkbox label {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 0;
  font-size: 13px;
  cursor: pointer;
}

.button-row {
  display: flex;
  gap: 8px;
}

.btn-primary {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 12px 24px;
  background: var(--accent);
  border: none;
  border-radius: 4px;
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

.btn-primary:hover:not(:disabled) {
  background: var(--accent-hover);
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-stop {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 12px 16px;
  background: var(--error);
  border: none;
  border-radius: 4px;
  color: var(--bg-primary);
  font-weight: 600;
  cursor: pointer;
}

.btn-stop:disabled {
  opacity: 0.6;
  cursor: wait;
}

.error-message {
  padding: 10px 12px;
  background: var(--error-bg);
  border-radius: 4px;
  color: var(--error);
  font-size: 13px;
  word-break: break-word;
}

/* Progress */
.progress-block {
  padding: 12px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 6px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.progress-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text-primary);
  min-width: 0;
}

.progress-head .spin {
  color: var(--info);
  flex-shrink: 0;
}

.progress-host {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}

.phase-badge {
  flex-shrink: 0;
  padding: 1px 8px;
  border-radius: 4px;
  background: var(--info-bg);
  color: var(--info);
  font-size: 11px;
  font-weight: 600;
}

.progress-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}

.progress-grid div {
  padding: 6px 8px;
  background: var(--bg-primary);
  border-radius: 4px;
}

.progress-grid dt {
  font-size: 10px;
  color: var(--text-secondary);
}

.progress-grid dd {
  font-size: 14px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.current-url {
  padding: 6px 8px;
  background: var(--info-bg);
  border-radius: 4px;
  font-family: 'SF Mono', Monaco, monospace;
  font-size: 11px;
  color: var(--info);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Crawl list */
.history-section {
  padding-top: 12px;
  border-top: 1px solid var(--border);
}

.history-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.history-header h4 {
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 600;
}

.btn-clear {
  display: inline-flex;
  align-items: center;
  padding: 3px 6px;
  background: transparent;
  border: 1px solid var(--bg-tertiary);
  border-radius: 3px;
  color: var(--text-muted);
  cursor: pointer;
}

.btn-clear:hover:not(:disabled) {
  border-color: var(--text-muted);
  color: var(--text-primary);
}

.crawl-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.crawl-item {
  display: flex;
  flex-direction: column;
  gap: 3px;
  width: 100%;
  padding: 8px 10px;
  background: var(--bg-secondary);
  border: 1px solid transparent;
  border-radius: 4px;
  font: inherit;
  color: var(--text-primary);
  text-align: left;
  cursor: pointer;
}

.crawl-item:hover,
.crawl-item:focus-visible {
  border-color: var(--border);
}

.crawl-item.active {
  border-color: var(--accent);
  background: var(--info-bg);
}

.crawl-top {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.crawl-url {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 600;
}

.crawl-meta,
.crawl-counts {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  font-size: 11px;
  color: var(--text-muted);
}

.crawl-counts {
  color: var(--text-secondary);
}

.crawl-counts .sev-error,
.crawl-counts .sev-warning,
.crawl-counts .sev-notice {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.status-badge {
  flex-shrink: 0;
  display: inline-block;
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 10px;
  font-weight: 600;
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  white-space: nowrap;
}

.st-completed {
  background: var(--success-bg);
  color: var(--success);
}

.st-running {
  background: var(--info-bg);
  color: var(--info);
}

.st-stopped,
.st-interrupted {
  color: var(--warning);
}

.st-failed {
  background: var(--error-bg);
  color: var(--error);
}

.sev-error {
  color: var(--error);
}

.sev-warning {
  color: var(--warning);
}

.sev-notice {
  color: var(--info);
}

/* Results */
.results-section {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
  background: var(--bg-primary);
}

.crawl-header {
  padding: 14px 20px 10px;
  border-bottom: 1px solid var(--border);
}

.crawl-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.crawl-title {
  font-size: 15px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.crawl-facts {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 16px;
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-secondary);
}

.export-links {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  margin-left: auto;
}

.export-links a {
  color: var(--sa-link, var(--accent));
  text-decoration: none;
}

.export-links a:hover {
  text-decoration: underline;
}

.running-note {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 20px;
  background: var(--info-bg);
  color: var(--info);
  font-size: 12px;
}

.running-note span {
  flex: 1;
}

.btn-secondary-sm {
  padding: 4px 10px;
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text-primary);
  font-size: 12px;
  cursor: pointer;
}

.btn-secondary-sm:hover {
  border-color: var(--accent);
}

.view-tabs {
  display: flex;
  gap: 4px;
  padding: 8px 20px 0;
  border-bottom: 1px solid var(--border);
}

.view-tab {
  padding: 8px 14px;
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  color: var(--text-secondary);
  font-size: 13px;
  cursor: pointer;
}

.view-tab:hover {
  color: var(--text-primary);
}

.view-tab.active {
  color: var(--text-primary);
  border-bottom-color: var(--accent);
  font-weight: 600;
}

.tab-count {
  margin-left: 4px;
  padding: 0 6px;
  border-radius: 8px;
  background: var(--bg-tertiary);
  font-size: 11px;
  font-weight: 400;
  color: var(--text-secondary);
}

.view-body {
  flex: 1;
  min-height: 0;
  padding: 0 20px;
}

.view-overview {
  overflow-y: auto;
  padding-top: 16px;
  padding-bottom: 24px;
}

.view-issues {
  overflow: hidden;
}

.view-urls {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding-bottom: 16px;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-muted);
}

.empty-state .hint {
  font-size: 13px;
  margin-top: 4px;
}

.muted {
  color: var(--text-muted);
}

.small {
  font-size: 12px;
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 768px) {
  .site-audit-container {
    grid-template-columns: 1fr;
    height: auto;
    overflow: visible;
  }

  .input-section {
    border-right: none;
    border-bottom: 1px solid var(--border);
  }

  .results-section {
    min-height: 70vh;
  }
}
</style>
