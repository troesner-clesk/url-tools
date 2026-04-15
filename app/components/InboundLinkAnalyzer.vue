<script setup lang="ts">
import {
  Check,
  Copy,
  FileText,
  LayoutGrid,
  Link as LinkIcon,
  Loader,
  Network,
  Table as TableIcon,
} from 'lucide-vue-next'
import type { InboundLink } from '../composables/useInboundAggregation'
import GraphView from './GraphView.vue'
import InboundGroupedView from './InboundGroupedView.vue'

const startUrlInput = ref('')
const targetsInput = ref('')
const targetMode = ref<'single' | 'multi' | 'matrix'>('single')
const crawlScope = ref<'recursive' | 'sitemap'>('recursive')
const maxUrls = ref(200)
const maxDepth = ref(3)
const rateLimit = ref(2)
const pathInclude = ref('')
const pathExclude = ref('')
const saveFormat = ref<'json' | 'csv' | 'both'>('csv')

const requestSettings = ref({
  timeout: 30,
  retries: 1,
  proxy: '',
  headers: {} as Record<string, string>,
  parallelRequests: 5,
})

const { addLog, clearLogs, setProgress, setCurrentUrl, setRunning } =
  useTabLogger('silo')
const { parsedUrls: parsedStartUrls, hasValidUrls } =
  useUrlParser(startUrlInput)

const isRunning = ref(false)
const results = ref<InboundLink[]>([])
const error = ref<string | null>(null)
const abortController = ref<AbortController | null>(null)
const savedFiles = ref<string[]>([])
const view = ref<'flat' | 'grouped' | 'graph'>('flat')
const copySuccess = ref(false)

function isValidUrl(v: string): boolean {
  try {
    const u = new URL(v)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

const rawTargets = computed<string[]>(() => {
  if (targetMode.value === 'matrix') return []
  if (targetMode.value === 'single') {
    const trimmed = targetsInput.value.trim()
    return trimmed ? [trimmed] : []
  }
  return targetsInput.value
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
})

const parsedTargets = computed<string[]>(() =>
  rawTargets.value.filter(isValidUrl),
)

const invalidTargets = computed<string[]>(() =>
  rawTargets.value.filter((t) => !isValidUrl(t)),
)

const canStart = computed(() => {
  if (!hasValidUrls.value || isRunning.value) return false
  if (targetMode.value !== 'matrix' && parsedTargets.value.length === 0)
    return false
  return true
})

const disabledReasons = computed<string[]>(() => {
  const reasons: string[] = []
  if (isRunning.value) reasons.push('Operation is already running')
  if (!hasValidUrls.value)
    reasons.push(
      crawlScope.value === 'sitemap'
        ? 'Sitemap URL required'
        : 'Start URL required',
    )
  if (targetMode.value !== 'matrix' && parsedTargets.value.length === 0) {
    reasons.push(
      targetMode.value === 'single'
        ? 'Target URL required (must start with http:// or https://)'
        : 'At least one valid target URL required',
    )
  }
  return reasons
})

const uniqueTargets = computed(() => {
  const set = new Set<string>()
  for (const r of results.value) set.add(r.targetUrl)
  return set.size
})

const uniqueSources = computed(() => {
  const set = new Set<string>()
  for (const r of results.value) set.add(r.sourceUrl)
  return set.size
})

const showMatrixConfirm = ref(false)
let matrixConfirmed = false

async function start() {
  if (!canStart.value) return

  // Matrix mode can flood with tens of thousands of edges. Warn first.
  if (targetMode.value === 'matrix' && !matrixConfirmed) {
    showMatrixConfirm.value = true
    return
  }
  matrixConfirmed = false

  isRunning.value = true
  setRunning(true)
  error.value = null
  results.value = []
  savedFiles.value = []
  clearLogs()
  setProgress({ done: 0, total: 0 })
  setCurrentUrl(null)

  addLog(
    `Starting inbound link analysis (${crawlScope.value}, ${targetMode.value})`,
    'info',
  )

  const controller = new AbortController()
  abortController.value = controller

  try {
    const response = await fetch('/api/analyze-inbound-links-stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        startUrls: parsedStartUrls.value,
        crawlScope: crawlScope.value,
        targetMode: targetMode.value,
        targets: parsedTargets.value,
        maxUrls: maxUrls.value,
        maxDepth: maxDepth.value,
        rateLimit: rateLimit.value,
        pathInclude: pathInclude.value,
        pathExclude: pathExclude.value,
        settings: requestSettings.value,
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
              setProgress({ done: parsed.done, total: parsed.total })
              setCurrentUrl(parsed.currentUrl)
              break
            case 'log':
              addLog(parsed.message, parsed.type)
              break
            case 'done':
              setProgress({
                done: parsed.pagesProcessed,
                total: parsed.pagesProcessed,
              })
              addLog(
                `${parsed.inboundFound} inbound link(s) across ${parsed.pagesProcessed} page(s)`,
                'success',
              )
              break
            case 'error':
              addLog(parsed.message, 'error')
              break
          }
        } catch {}
      }
    }

    if (results.value.length > 0) {
      addLog('Saving results...', 'info')
      await saveResults()
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      addLog('Cancelled', 'error')
      return
    }
    const msg = e instanceof Error ? e.message : 'Unknown error'
    error.value = msg
    addLog(msg, 'error')
  } finally {
    isRunning.value = false
    setRunning(false)
    abortController.value = null
    setCurrentUrl(null)
  }
}

function stop() {
  if (abortController.value) abortController.value.abort()
  // Don't touch isRunning here — the finally block in start() owns that flag,
  // so the button stays disabled until the stream has actually closed.
  addLog('Stopping...', 'info')
}

function confirmMatrix() {
  matrixConfirmed = true
  showMatrixConfirm.value = false
  start()
}

function cancelMatrix() {
  showMatrixConfirm.value = false
}

async function saveResults() {
  try {
    const response = await $fetch<{ files: string[] }>('/api/save-results', {
      method: 'POST',
      body: {
        results: results.value,
        format: saveFormat.value,
        mode: 'inbound-links',
      },
    })
    savedFiles.value = response.files
    addLog(`${response.files.length} file(s) saved`, 'success')
  } catch (e) {
    addLog(
      `Save failed: ${e instanceof Error ? e.message : 'unknown'}`,
      'error',
    )
  }
}

async function copySources() {
  const sources = Array.from(new Set(results.value.map((r) => r.sourceUrl)))
  if (sources.length === 0) return
  try {
    await navigator.clipboard.writeText(sources.join('\n'))
    copySuccess.value = true
    addLog(`${sources.length} source URL(s) copied`, 'success')
    setTimeout(() => {
      copySuccess.value = false
    }, 2000)
  } catch {
    addLog('Failed to copy', 'error')
  }
}

function truncateUrl(url: string, max = 60): string {
  if (url.length <= max) return url
  return `${url.substring(0, max - 3)}...`
}

defineExpose({ isRunning })
</script>

<template>
  <div class="silo-container">
    <!-- Left: Input -->
    <div class="input-section">
      <h2><Network :size="18" /> Silo / Inbound Links</h2>
      <p class="subtitle">Find which pages link to your target URL(s)</p>

      <!-- Target mode -->
      <div class="option">
        <label>Target mode <HelpTooltip text="Single: one target URL. Multi: several targets (one per line). Matrix: every internal page becomes a target." /></label>
        <div class="radio-row">
          <label><input type="radio" v-model="targetMode" value="single" :disabled="isRunning"> Single</label>
          <label><input type="radio" v-model="targetMode" value="multi" :disabled="isRunning"> Multi</label>
          <label><input type="radio" v-model="targetMode" value="matrix" :disabled="isRunning"> Matrix</label>
        </div>
      </div>

      <div v-if="targetMode === 'single'" class="option">
        <label>Target URL</label>
        <input
          v-model="targetsInput"
          type="text"
          placeholder="https://example.com/target-page"
          :disabled="isRunning"
        >
      </div>

      <div v-else-if="targetMode === 'multi'" class="option">
        <label>Target URLs (one per line)</label>
        <textarea
          v-model="targetsInput"
          rows="3"
          placeholder="https://example.com/page-a&#10;https://example.com/page-b"
          :disabled="isRunning"
        ></textarea>
      </div>

      <div v-if="invalidTargets.length > 0" class="warning-message">
        {{ invalidTargets.length }} invalid target URL(s) will be ignored (must start with http:// or https://)
      </div>

      <!-- Crawl scope -->
      <div class="option">
        <label>Crawl scope <HelpTooltip text="Recursive: follow internal links from the start URL. Sitemap: fetch the site's sitemap.xml and only analyze listed pages." /></label>
        <div class="radio-row">
          <label><input type="radio" v-model="crawlScope" value="recursive" :disabled="isRunning"> Recursive</label>
          <label><input type="radio" v-model="crawlScope" value="sitemap" :disabled="isRunning"> Sitemap</label>
        </div>
      </div>

      <div class="option">
        <label>{{ crawlScope === 'sitemap' ? 'Sitemap URL(s)' : 'Start URL(s)' }} (one per line)</label>
        <textarea
          v-model="startUrlInput"
          :placeholder="crawlScope === 'sitemap' ? 'https://example.com/sitemap.xml' : 'https://example.com'"
          :disabled="isRunning"
          rows="2"
        ></textarea>
        <div class="url-count">{{ parsedStartUrls.length }} valid URL(s)</div>
      </div>

      <RequestSettings v-model:settings="requestSettings" />

      <div class="option-row">
        <div class="option">
          <label>Max pages</label>
          <input type="number" v-model.number="maxUrls" min="1" :disabled="isRunning">
        </div>
        <div v-if="crawlScope === 'recursive'" class="option">
          <label>Max depth</label>
          <select v-model.number="maxDepth" :disabled="isRunning">
            <option :value="1">1</option>
            <option :value="2">2</option>
            <option :value="3">3</option>
            <option :value="4">4</option>
            <option :value="5">5</option>
          </select>
        </div>
        <div class="option">
          <label>Rate limit (req/s)</label>
          <input type="number" v-model.number="rateLimit" min="0.1" step="0.1" :disabled="isRunning">
        </div>
      </div>

      <div class="option">
        <label>Path include (comma-separated)</label>
        <input type="text" v-model="pathInclude" placeholder="/de/, /blog/" :disabled="isRunning">
      </div>
      <div class="option">
        <label>Path exclude</label>
        <input type="text" v-model="pathExclude" placeholder="/admin/, /cart/" :disabled="isRunning">
      </div>

      <div class="option">
        <label>Save format</label>
        <select v-model="saveFormat" :disabled="isRunning">
          <option value="csv">CSV + TXT</option>
          <option value="json">JSON + TXT</option>
          <option value="both">All (JSON + CSV + TXT)</option>
        </select>
      </div>

      <div class="button-row">
        <span
          class="btn-wrap"
          :title="disabledReasons.length > 0 ? `Cannot start yet:\n• ${disabledReasons.join('\n• ')}` : ''"
        >
          <button class="btn-primary" @click="start" :disabled="!canStart">
            <template v-if="isRunning"><Loader :size="14" class="spin" /> Analyzing...</template>
            <template v-else><Network :size="14" /> Analyze</template>
          </button>
        </span>
        <HelpTooltip
          v-if="!canStart && !isRunning && disabledReasons.length > 0"
          :text="`Cannot start yet: ${disabledReasons.join(' · ')}`"
        />
        <button v-if="isRunning" class="btn-stop" @click="stop">Stop</button>
      </div>
      <div v-if="!canStart && !isRunning && disabledReasons.length > 0" class="disabled-hint">
        {{ disabledReasons.join(' · ') }}
      </div>

      <div v-if="error" class="error-message">{{ error }}</div>
    </div>

    <!-- Right: Results -->
    <div class="results-section">
      <div v-if="results.length > 0" class="stats-bar">
        <div class="stat-item">
          <span class="stat-value">{{ results.length }}</span>
          <span class="stat-label">Inbound links</span>
        </div>
        <div class="stat-item">
          <span class="stat-value">{{ uniqueTargets }}</span>
          <span class="stat-label">Targets</span>
        </div>
        <div class="stat-item">
          <span class="stat-value">{{ uniqueSources }}</span>
          <span class="stat-label">Source pages</span>
        </div>
        <div class="stat-actions">
          <div class="view-switcher">
            <button :class="{ active: view === 'flat' }" @click="view = 'flat'">
              <TableIcon :size="12" /> Flat
            </button>
            <button :class="{ active: view === 'grouped' }" @click="view = 'grouped'">
              <LayoutGrid :size="12" /> Grouped
            </button>
            <button :class="{ active: view === 'graph' }" @click="view = 'graph'">
              <Network :size="12" /> Graph
            </button>
          </div>
          <button class="btn-export" @click="copySources">
            <template v-if="copySuccess"><Check :size="12" /> Copied!</template>
            <template v-else><Copy :size="12" /> Copy sources</template>
          </button>
        </div>
      </div>

      <div v-if="results.length === 0" class="empty-state">
        <p>No results yet</p>
        <p class="hint">Enter a start URL and target, then click "Analyze"</p>
      </div>

      <!-- Flat view -->
      <div v-else-if="view === 'flat'" class="results-table-wrapper">
        <table class="results-table">
          <thead>
            <tr>
              <th>Source</th>
              <th>Target</th>
              <th>Anchor</th>
              <th>Rel</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(r, idx) in results" :key="idx">
              <td :title="r.sourceUrl">
                <a :href="r.sourceUrl" target="_blank" rel="noopener noreferrer">{{ truncateUrl(r.sourceUrl, 50) }}</a>
              </td>
              <td :title="r.targetUrl">
                <a :href="r.targetUrl" target="_blank" rel="noopener noreferrer">{{ truncateUrl(r.targetUrl, 50) }}</a>
              </td>
              <td :title="r.anchorText">{{ truncateUrl(r.anchorText, 30) || '-' }}</td>
              <td>{{ r.rel || '-' }}</td>
              <td>{{ r.sourceStatus }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Grouped view -->
      <InboundGroupedView v-else-if="view === 'grouped'" :results="results" />

      <!-- Graph view -->
      <GraphView
        v-else
        :results="results"
        :targets="parsedTargets"
      />

      <div v-if="savedFiles.length > 0" class="saved-files">
        <FileText :size="12" /> Saved {{ savedFiles.length }} file(s)
      </div>
    </div>

    <!-- Matrix-mode confirmation -->
    <div v-if="showMatrixConfirm" class="modal-overlay" @click.self="cancelMatrix">
      <div class="modal">
        <h3>Matrix mode can produce a lot of data</h3>
        <p>
          Matrix mode emits one entry per internal link found across the crawl.
          On a typical 1 000-page site this can mean 5 000–50 000 results.
          The cap is 50 000 — beyond that the stream stops early.
        </p>
        <p>Continue?</p>
        <div class="modal-actions">
          <button class="btn-secondary" @click="cancelMatrix">Cancel</button>
          <button class="btn-primary" @click="confirmMatrix">Continue</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.silo-container {
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

.option label {
  display: block;
  font-size: 13px;
  color: var(--text-secondary);
  margin-bottom: 4px;
}

.option input[type="text"],
.option input[type="number"],
.option select,
.option textarea {
  width: 100%;
  padding: 8px 12px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text-primary);
  font-size: 13px;
  font-family: inherit;
}

.option textarea {
  font-family: 'SF Mono', Monaco, monospace;
  font-size: 12px;
  resize: vertical;
}

.option input:focus,
.option select:focus,
.option textarea:focus {
  outline: none;
  border-color: var(--accent);
}

.radio-row {
  display: flex;
  gap: 12px;
}

.radio-row label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  cursor: pointer;
}

.option-row {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 8px;
}

.url-count {
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-muted);
}

.button-row {
  display: flex;
  gap: 8px;
}

.btn-wrap {
  flex: 1;
  display: flex;
}

.btn-wrap .btn-primary {
  width: 100%;
}

.disabled-hint {
  font-size: 11px;
  color: var(--text-muted);
  padding: 4px 2px 0;
  line-height: 1.4;
}

.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
}

.modal {
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 20px 24px;
  max-width: 480px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
}

.modal h3 {
  margin: 0 0 12px;
  font-size: 15px;
  color: var(--text-primary);
}

.modal p {
  margin: 0 0 12px;
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.5;
}

.modal-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 16px;
}

.btn-secondary {
  padding: 8px 16px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text-primary);
  cursor: pointer;
  font-size: 13px;
}

.btn-secondary:hover {
  border-color: var(--accent);
}

.btn-primary {
  flex: 1;
  padding: 12px 24px;
  background: var(--accent);
  border: none;
  border-radius: 4px;
  color: #fff;
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

.log-time { color: var(--text-muted); flex-shrink: 0; }
.log-message { word-break: break-all; }
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

.warning-message {
  padding: 8px 12px;
  background: color-mix(in srgb, var(--warning) 15%, transparent);
  border-radius: 4px;
  color: var(--warning);
  font-size: 12px;
}

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

.stat-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 12px;
}

.view-switcher {
  display: flex;
  gap: 2px;
  background: var(--bg-primary);
  border-radius: 4px;
  padding: 2px;
}

.view-switcher button {
  padding: 4px 10px;
  border: none;
  border-radius: 3px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 4px;
}

.view-switcher button:hover {
  color: var(--text-primary);
}

.view-switcher button.active {
  background: var(--accent);
  color: #fff;
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
  border-color: var(--accent);
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
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.results-table tr:hover td {
  background: var(--bg-secondary);
}

.results-table a {
  color: var(--info);
  text-decoration: none;
  font-family: 'SF Mono', Monaco, monospace;
  font-size: 11px;
}

.results-table a:hover {
  text-decoration: underline;
}

.saved-files {
  padding: 8px 16px;
  border-top: 1px solid var(--border);
  color: var(--text-secondary);
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 6px;
  background: var(--bg-secondary);
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
