<script setup lang="ts">
interface LogEntry {
  timestamp: string
  message: string
  type: 'info' | 'success' | 'error' | 'progress'
}

interface SeoAuditResult {
  url: string
  status: number
  loadTime: number
  size: number
  title: { text: string; length: number; isGood: boolean }
  description: { text: string; length: number; isGood: boolean }
  canonical: string | null
  robots: string | null
  headings: { tag: string; text: string; count: number }[]
  h1Count: number
  hasMultipleH1: boolean
  imagesWithoutAlt: number
  totalImages: number
  internalLinks: number
  externalLinks: number
  brokenLinks: { href: string; text: string; status: number; isInternal: boolean; isBroken: boolean }[]
  hasViewport: boolean
  hasCharset: boolean
  hasFavicon: boolean
  hasJsonLd: boolean
  hasOpenGraph: boolean
  hasTwitterCard: boolean
  score: number
  issues: string[]
  error?: string
}

interface BulkResponse {
  results: SeoAuditResult[]
  savedFiles: string[]
  stats: {
    total: number
    success: number
    failed: number
    avgScore: number
  }
}

interface HistoryEntry {
  id: string
  urls: string[]
  timestamp: string
  avgScore: number
  urlCount: number
  checkLinks: boolean
}

const urlInput = ref('')
const checkLinks = ref(false)
const saveResults = ref(true)
const isLoading = ref(false)
const isCancelled = ref(false)
const results = ref<SeoAuditResult[]>([])
const selectedResult = ref<SeoAuditResult | null>(null)
const error = ref<string | null>(null)
const logs = ref<LogEntry[]>([])
const logContainer = ref<HTMLElement | null>(null)
const savedFiles = ref<string[]>([])
const stats = ref<BulkResponse['stats'] | null>(null)
const history = ref<HistoryEntry[]>([])

// Load history from localStorage
onMounted(() => {
  const stored = localStorage.getItem('seo-audit-history')
  if (stored) {
    try {
      history.value = JSON.parse(stored)
    } catch {}
  }
})

// Save history to localStorage
function saveHistory() {
  localStorage.setItem('seo-audit-history', JSON.stringify(history.value.slice(0, 20)))
}

// Add entry to history
function addToHistory(urls: string[], avgScore: number, checkLinksEnabled: boolean) {
  const entry: HistoryEntry = {
    id: Date.now().toString(),
    urls,
    timestamp: new Date().toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' }),
    avgScore,
    urlCount: urls.length,
    checkLinks: checkLinksEnabled
  }
  history.value.unshift(entry)
  if (history.value.length > 20) {
    history.value = history.value.slice(0, 20)
  }
  saveHistory()
}

// Load from history (without running)
function loadFromHistory(entry: HistoryEntry) {
  urlInput.value = entry.urls.join('\n')
  checkLinks.value = entry.checkLinks
}

// Re-run from history
function rerunFromHistory(entry: HistoryEntry) {
  loadFromHistory(entry)
  nextTick(() => {
    runAudit()
  })
}

// Stop the audit
function stopAudit() {
  isCancelled.value = true
  addLog('Stopping...', 'info')
}

// Delete from history
function deleteFromHistory(id: string) {
  history.value = history.value.filter(h => h.id !== id)
  saveHistory()
}

// Clear all history
function clearHistory() {
  history.value = []
  saveHistory()
}

function parseUrls(input: string): string[] {
  return input
    .split(/[\n,]+/)
    .map(url => url.trim())
    .filter(url => {
      if (!url) return false
      try {
        new URL(url)
        return true
      } catch {
        return false
      }
    })
}

const parsedUrls = computed(() => parseUrls(urlInput.value))

function addLog(message: string, type: LogEntry['type'] = 'info') {
  const now = new Date()
  const timestamp = now.toLocaleTimeString('en-US')
  logs.value.push({ timestamp, message, type })
  if (logs.value.length > 100) {
    logs.value.shift()
  }
}

watch(logs, () => {
  nextTick(() => {
    if (logContainer.value) {
      logContainer.value.scrollTop = logContainer.value.scrollHeight
    }
  })
}, { deep: true })

async function runAudit() {
  if (parsedUrls.value.length === 0) return

  isLoading.value = true
  isCancelled.value = false
  error.value = null
  results.value = []
  selectedResult.value = null
  logs.value = []
  savedFiles.value = []
  stats.value = null

  const urlCount = parsedUrls.value.length
  addLog(`Starting SEO audit for ${urlCount} URL(s)`, 'info')
  if (checkLinks.value) {
    addLog('Link check enabled (may take longer)', 'info')
  }

  try {
    for (let i = 0; i < parsedUrls.value.length; i++) {
      // Check if cancelled
      if (isCancelled.value) {
        addLog('Cancelled', 'error')
        break
      }

      const url = parsedUrls.value[i]
      addLog(`[${i + 1}/${urlCount}] Analyzing ${url}...`, 'progress')

      const response = await $fetch<SeoAuditResult | BulkResponse>('/api/seo-audit', {
        method: 'POST',
        body: {
          urls: [url],
          checkLinks: checkLinks.value,
          saveResults: false
        }
      })

      const result = 'results' in response ? response.results[0] : response
      if (!result) continue

      results.value.push(result)

      if (result.error) {
        addLog(`✗ ${url}: ${result.error}`, 'error')
      } else {
        addLog(`✓ ${url}: Score ${result.score}/100 (${result.loadTime}ms)`, result.score >= 70 ? 'success' : 'error')
      }
    }

    const successResults = results.value.filter(r => !r.error)
    const avgScore = successResults.length > 0
      ? Math.round(successResults.reduce((sum, r) => sum + r.score, 0) / successResults.length)
      : 0

    stats.value = {
      total: results.value.length,
      success: successResults.length,
      failed: results.value.filter(r => r.error).length,
      avgScore
    }

    // Add to history
    addToHistory(parsedUrls.value, avgScore, checkLinks.value)

    if (saveResults.value && results.value.length > 0) {
      addLog('Saving results...', 'info')
      const saveResponse = await $fetch<BulkResponse>('/api/seo-audit', {
        method: 'POST',
        body: {
          urls: parsedUrls.value,
          checkLinks: false,
          saveResults: true
        }
      })
      savedFiles.value = saveResponse.savedFiles || []
      if (savedFiles.value.length > 0) {
        addLog(`${savedFiles.value.length} file(s) saved`, 'success')
      }
    }

    addLog('Done!', 'success')

    // Auto-select first result
    if (results.value.length > 0 && results.value[0]) {
      selectedResult.value = results.value[0]
    }

  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error during audit'
    error.value = msg
    addLog(`✗ ${msg}`, 'error')
  } finally {
    isLoading.value = false
  }
}

function selectResult(result: SeoAuditResult) {
  selectedResult.value = result
}

function getScoreColor(score: number): string {
  if (score >= 80) return '#22c55e'
  if (score >= 60) return '#eab308'
  if (score >= 40) return '#f97316'
  return '#ef4444'
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

</script>

<template>
  <div class="seo-audit-container">
    <!-- Left: Input Section -->
    <div class="input-section">
      <h2>🔍 SEO Audit</h2>
      <p class="subtitle">Analyze URLs for SEO factors</p>

      <div class="url-input">
        <label>URLs (one per line)</label>
        <textarea
          v-model="urlInput"
          placeholder="https://example.com&#10;https://another-site.com"
          :disabled="isLoading"
        ></textarea>
        <div class="url-count">{{ parsedUrls.length }} valid URL(s)</div>
      </div>

      <div class="option checkbox">
        <label>
          <input type="checkbox" v-model="checkLinks" :disabled="isLoading">
          Check links for 404 errors
        </label>
      </div>
      <div class="option checkbox">
        <label>
          <input type="checkbox" v-model="saveResults" :disabled="isLoading">
          Auto-save results
        </label>
      </div>

      <div class="button-row">
        <button class="btn-primary" @click="runAudit" :disabled="parsedUrls.length === 0 || isLoading">
          {{ isLoading ? '⏳ Analyzing...' : '🔍 Analyze' }}
        </button>
        <button v-if="isLoading" class="btn-stop" @click="stopAudit">
          Stop
        </button>
      </div>

      <div v-if="logs.length" class="log-container" ref="logContainer">
        <div
          v-for="(log, index) in logs"
          :key="index"
          :class="['log-entry', `log-${log.type}`]"
        >
          <span class="log-time">{{ log.timestamp }}</span>
          <span class="log-message">{{ log.message }}</span>
        </div>
      </div>

      <div v-if="savedFiles.length" class="saved-files">
        <span>✓ Saved</span>
        <RecentJobsMenu tool-type="seo" />
      </div>

      <!-- History in input section -->
      <div v-if="history.length > 0" class="history-section">
        <div class="history-header">
          <h4>Recent</h4>
          <button class="btn-clear" @click="clearHistory">Clear</button>
        </div>
        <div class="history-items">
          <div
            v-for="entry in history.slice(0, 5)"
            :key="entry.id"
            class="history-item"
          >
            <div class="history-info" @click="loadFromHistory(entry)">
              <div class="history-urls">{{ entry.urlCount === 1 ? entry.urls[0] : `${entry.urlCount} URLs` }}</div>
              <div class="history-meta">
                <span class="history-score" :style="{ color: getScoreColor(entry.avgScore) }">{{ entry.avgScore }} pts</span>
                <span class="history-time">{{ entry.timestamp }}</span>
              </div>
            </div>
            <button class="btn-rerun" @click="rerunFromHistory(entry)" title="Re-run">↻</button>
          </div>
        </div>
      </div>

      <div v-if="error" class="error-message">
        {{ error }}
      </div>
    </div>

    <!-- Right: Results Section -->
    <div class="results-section">

      <!-- Results Area: Side-by-side layout -->
      <div v-if="results.length > 0" class="results-area">
        <!-- Left: Results List -->
        <div class="results-list">
          <div class="bulk-header">
            <h3>Results ({{ stats?.success }}/{{ stats?.total }})</h3>
            <div v-if="stats" class="avg-score" :style="{ color: getScoreColor(stats.avgScore) }">
              Avg {{ stats.avgScore }} pts
            </div>
          </div>

          <div class="results-table">
            <div class="table-header">
              <span class="col-url">URL</span>
              <span class="col-score">Score</span>
              <span class="col-issues">Issues</span>
            </div>
            <div
              v-for="result in results"
              :key="result.url"
              :class="['table-row', { active: selectedResult?.url === result.url, error: result.error }]"
              @click="selectResult(result)"
            >
              <span class="col-url">{{ result.url }}</span>
              <span class="col-score" :style="{ color: getScoreColor(result.score) }">
                {{ result.error ? '—' : result.score }}
              </span>
              <span class="col-issues">{{ result.error ? 'Error' : result.issues.length }}</span>
            </div>
          </div>
        </div>

        <!-- Right: Detail View -->
        <div class="results-detail">
          <div v-if="!selectedResult" class="detail-empty">
            <p>Select a result to view details</p>
          </div>

          <div v-else-if="selectedResult.error" class="detail-error">
            <h3>{{ selectedResult.url }}</h3>
            <p class="error-text">{{ selectedResult.error }}</p>
          </div>

          <div v-else class="results">

        <div class="score-card">
          <div
            class="score-circle"
            :style="{ borderColor: getScoreColor(selectedResult.score) }"
          >
            <span class="score-value" :style="{ color: getScoreColor(selectedResult.score) }">
              {{ selectedResult.score }}
            </span>
            <span class="score-label">/ 100</span>
          </div>
          <div class="score-info">
            <div class="score-status">{{ selectedResult.status }} • {{ selectedResult.loadTime }}ms • {{ formatBytes(selectedResult.size) }}</div>
            <div v-if="selectedResult.issues.length" class="issues-count">
              {{ selectedResult.issues.length }} issue{{ selectedResult.issues.length !== 1 ? 's' : '' }} found
            </div>
          </div>
        </div>

        <div v-if="selectedResult.issues.length" class="card issues-card">
          <h3>Issues</h3>
          <ul>
            <li v-for="issue in selectedResult.issues" :key="issue">{{ issue }}</li>
          </ul>
        </div>

        <div class="card">
          <h3>Meta Tags</h3>
          <div class="meta-item">
            <div class="meta-label">
              Title
              <span :class="['badge', selectedResult.title.isGood ? 'badge-good' : 'badge-warn']">
                {{ selectedResult.title.length }} chars
              </span>
            </div>
            <div class="meta-value">{{ selectedResult.title.text || '(not set)' }}</div>
          </div>
          <div class="meta-item">
            <div class="meta-label">
              Description
              <span :class="['badge', selectedResult.description.isGood ? 'badge-good' : 'badge-warn']">
                {{ selectedResult.description.length }} chars
              </span>
            </div>
            <div class="meta-value">{{ selectedResult.description.text || '(not set)' }}</div>
          </div>
          <div class="meta-item">
            <div class="meta-label">Canonical</div>
            <div class="meta-value">{{ selectedResult.canonical || '(not set)' }}</div>
          </div>
          <div class="meta-item">
            <div class="meta-label">Robots</div>
            <div class="meta-value">{{ selectedResult.robots || '(not set)' }}</div>
          </div>
        </div>

        <div class="card">
          <h3>Headings</h3>
          <div class="headings-summary">
            <span :class="['badge', selectedResult.h1Count === 1 ? 'badge-good' : 'badge-warn']">
              {{ selectedResult.h1Count }} H1
            </span>
            <span class="badge">{{ selectedResult.headings.filter(h => h.tag === 'h2').length }} H2</span>
            <span class="badge">{{ selectedResult.headings.filter(h => h.tag === 'h3').length }} H3</span>
          </div>
          <div class="headings-list">
            <div
              v-for="(heading, i) in selectedResult.headings.slice(0, 20)"
              :key="i"
              class="heading-item"
              :style="{ paddingLeft: `${(Number(heading.tag.charAt(1)) - 1) * 16}px` }"
            >
              <span class="heading-tag">{{ heading.tag.toUpperCase() }}</span>
              <span class="heading-text">{{ heading.text }}</span>
            </div>
          </div>
        </div>

        <div class="card">
          <h3>Links & Images</h3>
          <div class="stats-grid">
            <div class="stat">
              <span class="stat-value">{{ selectedResult.internalLinks }}</span>
              <span class="stat-label">Internal Links</span>
            </div>
            <div class="stat">
              <span class="stat-value">{{ selectedResult.externalLinks }}</span>
              <span class="stat-label">External Links</span>
            </div>
            <div class="stat">
              <span class="stat-value">{{ selectedResult.totalImages }}</span>
              <span class="stat-label">Images</span>
            </div>
            <div class="stat" :class="{ 'stat-warn': selectedResult.imagesWithoutAlt > 0 }">
              <span class="stat-value">{{ selectedResult.imagesWithoutAlt }}</span>
              <span class="stat-label">Missing Alt</span>
            </div>
          </div>

          <div v-if="selectedResult.brokenLinks.length" class="broken-links">
            <h4>Broken Links</h4>
            <div v-for="link in selectedResult.brokenLinks" :key="link.href" class="broken-link">
              <span class="link-status">{{ link.status || 'Timeout' }}</span>
              <a :href="link.href" target="_blank">{{ link.href }}</a>
            </div>
          </div>
        </div>

        <div class="card">
          <h3>Technical</h3>
          <div class="tech-checks">
            <div :class="['check', selectedResult.hasViewport ? 'check-pass' : 'check-fail']">
              {{ selectedResult.hasViewport ? '✓' : '✗' }} Viewport Meta
            </div>
            <div :class="['check', selectedResult.hasCharset ? 'check-pass' : 'check-fail']">
              {{ selectedResult.hasCharset ? '✓' : '✗' }} Charset
            </div>
            <div :class="['check', selectedResult.hasFavicon ? 'check-pass' : 'check-fail']">
              {{ selectedResult.hasFavicon ? '✓' : '✗' }} Favicon
            </div>
            <div :class="['check', selectedResult.hasJsonLd ? 'check-pass' : 'check-fail']">
              {{ selectedResult.hasJsonLd ? '✓' : '✗' }} JSON-LD Schema
            </div>
            <div :class="['check', selectedResult.hasOpenGraph ? 'check-pass' : 'check-fail']">
              {{ selectedResult.hasOpenGraph ? '✓' : '✗' }} Open Graph
            </div>
            <div :class="['check', selectedResult.hasTwitterCard ? 'check-pass' : 'check-fail']">
              {{ selectedResult.hasTwitterCard ? '✓' : '✗' }} Twitter Card
            </div>
          </div>
        </div>
          </div>
        </div>
      </div>

      <!-- Empty state -->
      <div v-else class="empty-state">
        <p>No results yet</p>
        <p class="hint">Enter URLs and click "Analyze" to audit</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.seo-audit-container {
  display: grid;
  grid-template-columns: 360px 1fr;
  height: 100%;
  overflow: hidden;
}

.input-section {
  padding: 16px;
  border-right: 1px solid #333;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
}

.input-section h2 {
  margin-bottom: 0;
  color: #fff;
  font-size: 16px;
}

.subtitle {
  color: #888;
  font-size: 13px;
  margin-bottom: 8px;
}

.url-input label {
  display: block;
  margin-bottom: 6px;
  font-size: 13px;
  color: #888;
}

.url-input textarea {
  width: 100%;
  height: 100px;
  padding: 12px;
  background: #1a1a1a;
  border: 1px solid #333;
  border-radius: 4px;
  color: #fff;
  font-family: 'SF Mono', Monaco, monospace;
  font-size: 12px;
  resize: vertical;
}

.url-input textarea:focus {
  outline: none;
  border-color: #0066cc;
}

.url-count {
  margin-top: 4px;
  font-size: 12px;
  color: #666;
}

.option.checkbox label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #888;
  cursor: pointer;
}

.button-row {
  display: flex;
  gap: 8px;
}

.btn-primary {
  flex: 1;
  padding: 12px 24px;
  background: #0066cc;
  border: none;
  border-radius: 4px;
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

.btn-primary:hover:not(:disabled) {
  background: #0077ee;
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-stop {
  padding: 12px 16px;
  background: #cc3333;
  border: none;
  border-radius: 4px;
  color: #fff;
  font-weight: 600;
  cursor: pointer;
}

.btn-stop:hover {
  background: #dd4444;
}

.log-container {
  background: #0a0a0a;
  border: 1px solid #333;
  border-radius: 4px;
  max-height: 120px;
  overflow-y: auto;
  font-family: 'SF Mono', Monaco, monospace;
  font-size: 11px;
}

.log-entry {
  padding: 4px 8px;
  border-bottom: 1px solid #1a1a1a;
  display: flex;
  gap: 8px;
}

.log-entry:last-child {
  border-bottom: none;
}

.log-time {
  color: #666;
  flex-shrink: 0;
}

.log-message {
  word-break: break-all;
}

.log-info { color: #888; }
.log-success { color: #4ade80; }
.log-error { color: #f87171; }
.log-progress { color: #38bdf8; }

.saved-files {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: #1a3d1a;
  border-radius: 4px;
  font-size: 12px;
  color: #4ade80;
}

.btn-folder {
  padding: 4px 8px;
  background: #2a5a2a;
  border: none;
  border-radius: 3px;
  color: #4ade80;
  cursor: pointer;
  font-size: 11px;
}

.btn-folder:hover {
  background: #3a6a3a;
}

.error-message {
  padding: 12px;
  background: #4d1a1a;
  border-radius: 4px;
  color: #f87171;
  font-size: 13px;
}

/* History Section in Input */
.history-section {
  margin-top: 8px;
  padding-top: 12px;
  border-top: 1px solid #333;
}

.history-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.history-header h4 {
  color: #888;
  font-size: 12px;
  font-weight: 600;
  margin: 0;
}

.btn-clear {
  padding: 2px 6px;
  background: transparent;
  border: 1px solid #444;
  border-radius: 3px;
  color: #666;
  cursor: pointer;
  font-size: 10px;
}

.btn-clear:hover {
  border-color: #666;
  color: #fff;
}

.history-items {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.history-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  background: #0a0a0a;
  border-radius: 4px;
}

.history-info {
  flex: 1;
  min-width: 0;
  cursor: pointer;
}

.history-info:hover .history-urls {
  color: #0088ff;
}

.history-urls {
  font-size: 11px;
  color: #e0e0e0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.history-meta {
  display: flex;
  gap: 6px;
  font-size: 10px;
  margin-top: 2px;
}

.history-score {
  font-weight: 600;
}

.history-time {
  color: #666;
}

.btn-rerun {
  width: 20px;
  height: 20px;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: 3px;
  color: #888;
  cursor: pointer;
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.btn-rerun:hover {
  background: #0066cc;
  color: #fff;
}

/* Results Section */
.results-section {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #0a0a0a;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #666;
}

.empty-state .hint {
  font-size: 13px;
  margin-top: 4px;
}

.results-area {
  display: grid;
  grid-template-columns: 320px 1fr;
  height: 100%;
  overflow: hidden;
}

.results-list {
  border-right: 1px solid #333;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.results-detail {
  overflow-y: auto;
  padding: 16px;
  background: #0f0f0f;
}

.detail-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #666;
}

.detail-error {
  padding: 16px;
}

.detail-error h3 {
  color: #fff;
  font-size: 14px;
  margin-bottom: 8px;
  word-break: break-all;
}

.detail-error .error-text {
  color: #f87171;
}

.bulk-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: #0a0a0a;
  border-bottom: 1px solid #333;
}

.bulk-header h3 {
  color: #fff;
  font-size: 14px;
  margin: 0;
}

.avg-score {
  font-size: 14px;
  font-weight: 600;
}

.results-table {
  flex: 1;
  overflow-y: auto;
}

.table-header {
  display: grid;
  grid-template-columns: 1fr 50px 50px;
  gap: 8px;
  padding: 8px 12px;
  background: #0a0a0a;
  font-size: 11px;
  color: #888;
  font-weight: 600;
  position: sticky;
  top: 0;
}

.table-row {
  display: grid;
  grid-template-columns: 1fr 50px 50px;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid #333;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.2s;
}

.table-row:hover {
  background: #252525;
}

.table-row.active {
  background: #0066cc33;
}

.table-row.error {
  color: #f87171;
}

.table-row:last-child {
  border-bottom: none;
}

.col-url {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #e0e0e0;
}

.col-score {
  text-align: center;
  font-weight: 600;
}

.col-issues {
  text-align: center;
  color: #888;
}

.col-time {
  text-align: right;
  color: #888;
}

/* Detail View */
.score-card {
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 24px;
  background: #1a1a1a;
  border-radius: 12px;
  margin-bottom: 16px;
}

.score-circle {
  width: 100px;
  height: 100px;
  border-radius: 50%;
  border: 4px solid;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.score-value {
  font-size: 32px;
  font-weight: 700;
}

.score-label {
  font-size: 14px;
  color: #666;
}

.score-status {
  color: #888;
  font-size: 14px;
}

.issues-count {
  color: #f97316;
  font-size: 14px;
  margin-top: 4px;
}

.card {
  background: #1a1a1a;
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 12px;
}

.card h3 {
  margin-bottom: 12px;
  font-size: 14px;
  color: #fff;
}

.issues-card ul {
  list-style: none;
  padding: 0;
}

.issues-card li {
  padding: 8px 0;
  border-bottom: 1px solid #333;
  color: #f97316;
  font-size: 13px;
}

.issues-card li:last-child {
  border-bottom: none;
}

.meta-item {
  margin-bottom: 12px;
}

.meta-label {
  font-size: 12px;
  color: #888;
  margin-bottom: 4px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.meta-value {
  font-size: 13px;
  color: #e0e0e0;
  word-break: break-word;
}

.badge {
  display: inline-block;
  padding: 2px 8px;
  background: #333;
  border-radius: 4px;
  font-size: 11px;
  color: #888;
}

.badge-good {
  background: #14532d;
  color: #22c55e;
}

.badge-warn {
  background: #451a03;
  color: #f97316;
}

.headings-summary {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}

.headings-list {
  max-height: 200px;
  overflow-y: auto;
}

.heading-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
  font-size: 12px;
}

.heading-tag {
  background: #333;
  padding: 2px 6px;
  border-radius: 3px;
  color: #888;
  font-size: 10px;
}

.heading-text {
  color: #e0e0e0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}

.stat {
  text-align: center;
  padding: 12px;
  background: #0a0a0a;
  border-radius: 6px;
}

.stat-value {
  display: block;
  font-size: 24px;
  font-weight: 600;
  color: #fff;
}

.stat-label {
  font-size: 11px;
  color: #888;
}

.stat-warn .stat-value {
  color: #f97316;
}

.broken-links {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid #333;
}

.broken-links h4 {
  font-size: 13px;
  margin-bottom: 8px;
  color: #f87171;
}

.broken-link {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
  font-size: 12px;
}

.link-status {
  background: #4d1a1a;
  color: #f87171;
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 10px;
}

.broken-link a {
  color: #888;
  text-decoration: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tech-checks {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}

.check {
  padding: 8px 12px;
  border-radius: 4px;
  font-size: 13px;
}

.check-pass {
  background: #14532d33;
  color: #22c55e;
}

.check-fail {
  background: #4d1a1a33;
  color: #f87171;
}
</style>
