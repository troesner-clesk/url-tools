<script setup lang="ts">
import { AlertTriangle, Check, Link as LinkIcon, Loader } from 'lucide-vue-next'

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

const urlInput = ref('')
const { logs, addLog, logContainer } = useLogger()
const { parsedUrls, hasValidUrls } = useUrlParser(urlInput)

const recursive = ref(false)
const maxDepth = ref(2)
const sameDomainOnly = ref(true)
const externalOnly = ref(false)

watch(externalOnly, (val) => {
  if (val) sameDomainOnly.value = false
})
watch(sameDomainOnly, (val) => {
  if (val) externalOnly.value = false
})

const isRunning = ref(false)
const results = ref<BrokenLinkResult[]>([])
const error = ref<string | null>(null)
const abortController = ref<AbortController | null>(null)
const progress = ref({ done: 0, total: 0 })
const currentUrl = ref<string | null>(null)
const filterBrokenOnly = ref(false)
const typeFilter = ref<'all' | 'internal' | 'external'>('all')
const copySuccess = ref(false)

const brokenCount = computed(
  () => results.value.filter((r) => r.isBroken).length,
)
const okCount = computed(() => results.value.filter((r) => !r.isBroken).length)
const internalCount = computed(() => results.value.filter((r) => r.isInternal).length)
const externalCount = computed(() => results.value.filter((r) => !r.isInternal).length)

const filteredResults = computed(() => {
  let filtered = results.value
  if (filterBrokenOnly.value) {
    filtered = filtered.filter((r) => r.isBroken)
  }
  if (typeFilter.value === 'internal') {
    filtered = filtered.filter((r) => r.isInternal)
  } else if (typeFilter.value === 'external') {
    filtered = filtered.filter((r) => !r.isInternal)
  }
  return filtered
})

function getStatusClass(status: number): string {
  if (status === 0) return 'status-error'
  if (status >= 200 && status < 300) return 'status-ok'
  if (status >= 300 && status < 400) return 'status-redirect'
  return 'status-error'
}

async function startCheck() {
  if (!hasValidUrls.value || isRunning.value) return

  isRunning.value = true
  error.value = null
  results.value = []
  logs.value = []
  progress.value = { done: 0, total: 0 }
  currentUrl.value = null
  copySuccess.value = false

  addLog(
    `Starting broken link check for ${parsedUrls.value.length} URL(s)`,
    'info',
  )
  if (recursive.value) {
    addLog(`Recursive crawling enabled (max depth: ${maxDepth.value})`, 'info')
  }

  const controller = new AbortController()
  abortController.value = controller

  try {
    const response = await fetch('/api/check-links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        urls: parsedUrls.value,
        recursive: recursive.value,
        maxDepth: maxDepth.value,
        sameDomainOnly: sameDomainOnly.value,
        externalOnly: externalOnly.value,
      }),
      signal: controller.signal,
    })

    if (!response.ok || !response.body) {
      throw new Error(`Server error: ${response.status}`)
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      const parts = buffer.split('\n\n')
      buffer = parts.pop() || ''

      for (const part of parts) {
        if (!part.trim()) continue
        let eventName = 'message'
        let data = ''
        for (const line of part.split('\n')) {
          if (line.startsWith('event:')) eventName = line.slice(6).trim()
          else if (line.startsWith('data:')) data = line.slice(5).trim()
        }
        if (!data) continue

        try {
          const parsed = JSON.parse(data)
          switch (eventName) {
            case 'result':
              results.value.push(parsed)
              break
            case 'progress':
              progress.value.done = parsed.done
              progress.value.total = parsed.total
              currentUrl.value = parsed.currentUrl
              break
            case 'log':
              addLog(parsed.message, parsed.type)
              break
            case 'done':
              progress.value.done = parsed.totalLinks
              progress.value.total = parsed.totalLinks
              addLog(
                `${parsed.totalLinks} links checked, ${parsed.brokenCount} broken, ${parsed.okCount} OK`,
                'success',
              )
              break
            case 'error':
              addLog(parsed.message, 'error')
              break
          }
        } catch {
          // Skip malformed events
        }
      }
    }

    addLog('Done!', 'success')
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      addLog('Cancelled', 'error')
      return
    }
    const msg = e instanceof Error ? e.message : 'An error occurred'
    error.value = msg
    addLog(msg, 'error')
  } finally {
    isRunning.value = false
    abortController.value = null
    currentUrl.value = null
  }
}

function stopCheck() {
  if (abortController.value) {
    abortController.value.abort()
  }
  isRunning.value = false
  addLog('Stopping...', 'info')
}

async function exportBrokenLinks() {
  const broken = results.value.filter((r) => r.isBroken)
  if (broken.length === 0) return

  const text = broken
    .map((r) => `${r.targetUrl}\t${r.status}\t${r.statusText}\t${r.sourceUrl}`)
    .join('\n')
  try {
    await navigator.clipboard.writeText(text)
    copySuccess.value = true
    addLog(`${broken.length} broken link(s) copied to clipboard`, 'success')
    setTimeout(() => {
      copySuccess.value = false
    }, 2000)
  } catch {
    addLog('Failed to copy to clipboard', 'error')
  }
}

function truncateUrl(url: string, max = 60): string {
  if (url.length <= max) return url
  return `${url.substring(0, max - 3)}...`
}

defineExpose({ isRunning })
</script>

<template>
  <div class="broken-link-container">
    <!-- Left: Input Section -->
    <div class="input-section">
      <h2><LinkIcon :size="18" /> Link Checker</h2>
      <p class="subtitle">Find broken links on your pages</p>

      <div class="url-input">
        <label>URLs (one per line)</label>
        <textarea
          v-model="urlInput"
          placeholder="https://example.com&#10;https://another-site.com"
          :disabled="isRunning"
        ></textarea>
        <div class="url-count">{{ parsedUrls.length }} valid URL(s)</div>
      </div>

      <div class="option checkbox">
        <label>
          <input type="checkbox" v-model="recursive" :disabled="isRunning">
          Recursive crawling
        </label>
      </div>

      <div v-if="recursive" class="option">
        <label>Max depth</label>
        <select v-model.number="maxDepth" :disabled="isRunning">
          <option :value="1">1</option>
          <option :value="2">2</option>
          <option :value="3">3</option>
          <option :value="4">4</option>
          <option :value="5">5</option>
        </select>
      </div>

      <div class="option checkbox">
        <label>
          <input type="checkbox" v-model="sameDomainOnly" :disabled="isRunning">
          Same domain only (crawling)
        </label>
      </div>

      <div class="option checkbox">
        <label>
          <input type="checkbox" v-model="externalOnly" :disabled="isRunning">
          External links only
        </label>
      </div>

      <div class="button-row">
        <button class="btn-primary" @click="startCheck" :disabled="!hasValidUrls || isRunning">
          <template v-if="isRunning"><Loader :size="14" class="spin" /> Checking...</template>
          <template v-else><LinkIcon :size="14" /> Check Links</template>
        </button>
        <button v-if="isRunning" class="btn-stop" @click="stopCheck">
          Stop
        </button>
      </div>

      <!-- Progress -->
      <div v-if="isRunning || progress.done > 0" class="progress">
        <div class="progress-bar">
          <div
            class="progress-fill"
            :style="{ width: `${(progress.done / Math.max(progress.total, 1)) * 100}%` }"
          ></div>
        </div>
        <div class="progress-text">{{ progress.done }} / {{ progress.total }}</div>
      </div>

      <!-- Current URL -->
      <div v-if="currentUrl" class="current-url">
        <Loader :size="14" class="spin" /> {{ currentUrl }}
      </div>

      <!-- Log -->
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

      <div v-if="error" class="error-message">
        {{ error }}
      </div>
    </div>

    <!-- Right: Results Section -->
    <div class="results-section">
      <!-- Stats Bar -->
      <div v-if="results.length > 0" class="stats-bar">
        <div class="stat-item">
          <span class="stat-value">{{ results.length }}</span>
          <span class="stat-label">Total</span>
        </div>
        <div class="stat-item stat-broken">
          <span class="stat-value">{{ brokenCount }}</span>
          <span class="stat-label">Broken</span>
        </div>
        <div class="stat-item stat-ok">
          <span class="stat-value">{{ okCount }}</span>
          <span class="stat-label">OK</span>
        </div>
        <div class="stat-actions">
          <div class="type-filter">
            <button :class="{ active: typeFilter === 'all' }" @click="typeFilter = 'all'">All ({{ results.length }})</button>
            <button :class="{ active: typeFilter === 'internal' }" @click="typeFilter = 'internal'">Internal ({{ internalCount }})</button>
            <button :class="{ active: typeFilter === 'external' }" @click="typeFilter = 'external'">External ({{ externalCount }})</button>
          </div>
          <label class="filter-toggle">
            <input type="checkbox" v-model="filterBrokenOnly">
            Broken only
          </label>
          <button
            class="btn-export"
            @click="exportBrokenLinks"
            :disabled="brokenCount === 0"
          >
            <template v-if="copySuccess"><Check :size="12" /> Copied!</template>
            <template v-else><AlertTriangle :size="12" /> Export Broken</template>
          </button>
        </div>
      </div>

      <!-- Results Table -->
      <div v-if="results.length > 0" class="results-table-wrapper">
        <table class="results-table">
          <thead>
            <tr>
              <th class="col-source">Source</th>
              <th class="col-target">Target</th>
              <th class="col-status">Status</th>
              <th class="col-type">Type</th>
              <th class="col-anchor">Anchor Text</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(result, index) in filteredResults"
              :key="index"
              :class="{ 'row-broken': result.isBroken }"
            >
              <td class="col-source" :title="result.sourceUrl">
                <a :href="result.sourceUrl" target="_blank" rel="noopener noreferrer">{{ truncateUrl(result.sourceUrl, 40) }}</a>
              </td>
              <td class="col-target" :title="result.targetUrl">
                <a :href="result.targetUrl" target="_blank" rel="noopener noreferrer">{{ truncateUrl(result.targetUrl, 50) }}</a>
              </td>
              <td class="col-status">
                <span :class="['status-badge', getStatusClass(result.status)]">
                  {{ result.status || 'ERR' }}
                </span>
                <span class="status-text">{{ result.statusText }}</span>
              </td>
              <td class="col-type">
                <span :class="['type-badge', result.isInternal ? 'type-internal' : 'type-external']">
                  {{ result.isInternal ? 'Internal' : 'External' }}
                </span>
              </td>
              <td class="col-anchor" :title="result.anchorText">
                {{ result.anchorText ? truncateUrl(result.anchorText, 30) : '-' }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Empty state -->
      <div v-else class="empty-state">
        <p>No results yet</p>
        <p class="hint">Enter URLs and click "Check Links" to find broken links</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.broken-link-container {
  display: grid;
  grid-template-columns: 360px 1fr;
  height: 100%;
  overflow: hidden;
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
  margin-bottom: 0;
  color: var(--text-primary);
  font-size: 16px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.subtitle {
  color: var(--text-secondary);
  font-size: 13px;
  margin-bottom: 8px;
}

.url-input label {
  display: block;
  margin-bottom: 6px;
  font-size: 13px;
  color: var(--text-secondary);
}

.url-input textarea {
  width: 100%;
  height: 100px;
  padding: 12px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text-primary);
  font-family: 'SF Mono', Monaco, monospace;
  font-size: 12px;
  resize: vertical;
}

.url-input textarea:focus {
  outline: none;
  border-color: var(--accent);
}

.url-count {
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-muted);
}

.option.checkbox label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text-secondary);
  cursor: pointer;
}

.option label {
  display: block;
  font-size: 13px;
  color: var(--text-secondary);
  margin-bottom: 4px;
}

.option select {
  width: 100%;
  padding: 8px 12px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text-primary);
  font-size: 13px;
}

.option select:focus {
  outline: none;
  border-color: var(--accent);
}

.button-row {
  display: flex;
  gap: 8px;
}

.btn-primary {
  flex: 1;
  padding: 12px 24px;
  background: var(--accent);
  border: none;
  border-radius: 4px;
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.btn-primary:hover:not(:disabled) {
  background: var(--accent-hover);
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

.progress {
  display: flex;
  align-items: center;
  gap: 12px;
}

.progress-bar {
  flex: 1;
  height: 6px;
  background: var(--border);
  border-radius: 3px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: var(--accent);
  transition: width 0.3s ease;
}

.progress-text {
  font-size: 12px;
  color: var(--text-secondary);
  min-width: 60px;
  text-align: right;
}

.current-url {
  padding: 8px 12px;
  background: var(--info-bg);
  border-radius: 4px;
  font-family: 'SF Mono', Monaco, monospace;
  font-size: 11px;
  color: var(--info);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  display: flex;
  align-items: center;
  gap: 6px;
}

.log-container {
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: 4px;
  max-height: 150px;
  overflow-y: auto;
  font-family: 'SF Mono', Monaco, monospace;
  font-size: 11px;
}

.log-entry {
  padding: 4px 8px;
  border-bottom: 1px solid var(--bg-secondary);
  display: flex;
  gap: 8px;
}

.log-entry:last-child {
  border-bottom: none;
}

.log-time {
  color: var(--text-muted);
  flex-shrink: 0;
}

.log-message {
  word-break: break-all;
}

.log-info { color: var(--text-secondary); }
.log-success { color: var(--success); }
.log-error { color: var(--error); }
.log-progress { color: var(--info); }

.error-message {
  padding: 12px;
  background: var(--error-bg);
  border-radius: 4px;
  color: var(--error);
  font-size: 13px;
}

/* Results Section */
.results-section {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg-primary);
}

.stats-bar {
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 12px 16px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.stat-item {
  display: flex;
  align-items: center;
  gap: 6px;
}

.stat-value {
  font-size: 18px;
  font-weight: 700;
  color: var(--text-primary);
}

.stat-label {
  font-size: 12px;
  color: var(--text-secondary);
}

.stat-broken .stat-value {
  color: var(--error);
}

.stat-ok .stat-value {
  color: var(--success);
}

.stat-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 12px;
}

.filter-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-secondary);
  cursor: pointer;
}

.btn-export {
  padding: 6px 12px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text-primary);
  cursor: pointer;
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 4px;
}

.btn-export:hover:not(:disabled) {
  border-color: var(--warning);
  color: var(--warning);
}

.btn-export:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* Results Table */
.results-table-wrapper {
  flex: 1;
  overflow: auto;
}

.results-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.results-table thead {
  position: sticky;
  top: 0;
  z-index: 1;
}

.results-table th {
  background: var(--bg-secondary);
  padding: 10px 12px;
  text-align: left;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
}

.results-table td {
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  color: var(--text-primary);
}

.results-table tr:hover td {
  background: var(--bg-secondary);
}

.row-broken td {
  background: color-mix(in srgb, var(--error-bg) 30%, transparent);
}

.row-broken:hover td {
  background: color-mix(in srgb, var(--error-bg) 50%, transparent);
}

.col-source {
  max-width: 200px;
}

.col-target {
  max-width: 280px;
}

.col-source a,
.col-target a {
  color: var(--info);
  text-decoration: none;
  font-family: 'SF Mono', Monaco, monospace;
  font-size: 11px;
}

.col-source a:hover,
.col-target a:hover {
  text-decoration: underline;
}

.col-status {
  white-space: nowrap;
}

.status-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 3px;
  font-size: 11px;
  font-weight: 600;
  font-family: 'SF Mono', Monaco, monospace;
}

.status-ok {
  background: color-mix(in srgb, var(--success) 20%, transparent);
  color: var(--success);
}

.status-redirect {
  background: color-mix(in srgb, var(--warning) 20%, transparent);
  color: var(--warning);
}

.status-error {
  background: color-mix(in srgb, var(--error) 20%, transparent);
  color: var(--error);
}

.status-text {
  margin-left: 6px;
  color: var(--text-muted);
  font-size: 11px;
}

.type-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 3px;
  font-size: 11px;
}

.type-internal {
  background: color-mix(in srgb, var(--info) 15%, transparent);
  color: var(--info);
}

.type-external {
  background: var(--bg-tertiary);
  color: var(--text-secondary);
}

.col-anchor {
  color: var(--text-muted);
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.type-filter {
  display: flex;
  gap: 2px;
  background: var(--bg-primary);
  border-radius: 4px;
  padding: 2px;
}

.type-filter button {
  padding: 3px 8px;
  border: none;
  border-radius: 3px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 12px;
  white-space: nowrap;
}

.type-filter button:hover {
  color: var(--text-primary);
}

.type-filter button.active {
  background: var(--accent);
  color: #fff;
}
</style>
