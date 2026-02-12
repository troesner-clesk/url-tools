<script setup lang="ts">
interface RequestSettings {
  timeout: number
  retries: number
  proxy: string
  headers: Record<string, string>
  parallelRequests: number
}

interface Settings {
  recursive: boolean
  maxUrls: number
  maxDepth: number
  rateLimit: number
  sameDomainOnly: boolean
  saveFormat: 'json' | 'csv' | 'both'
  cssSelector: string
  urlFilter: string
  pathInclude: string
  pathExclude: string
  requestSettings: RequestSettings
}

interface HtmlResult {
  url: string
  status: number
  contentType: string
  size: number
  html: string
  error?: string
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
}

interface LogEntry {
  timestamp: string
  message: string
  type: 'info' | 'success' | 'error' | 'progress'
}

// State
const urlInput = ref('')
const mode = ref<'html' | 'links'>('html')
const settings = ref<Settings>({
  recursive: false,
  maxUrls: 100,
  maxDepth: 3,
  rateLimit: 2,
  sameDomainOnly: true,
  saveFormat: 'json',
  cssSelector: '',
  urlFilter: '',
  pathInclude: '',
  pathExclude: '',
  requestSettings: {
    timeout: 30,
    retries: 1,
    proxy: '',
    headers: {},
    parallelRequests: 5
  }
})

const isRunning = ref(false)
const isPaused = ref(false)
const progress = ref({ done: 0, total: 0 })
const htmlResults = ref<HtmlResult[]>([])
const linkResults = ref<LinkResult[]>([])
const savedFiles = ref<string[]>([])
const error = ref<string | null>(null)
const logs = ref<LogEntry[]>([])
const currentUrl = ref<string | null>(null)
const activeTab = ref<'scraper' | 'seo' | 'screenshots' | 'images'>('scraper')
const showClearConfirm = ref(false)
const isClearing = ref(false)
const abortController = ref<AbortController | null>(null)

// Log function
function addLog(message: string, type: LogEntry['type'] = 'info') {
  const now = new Date()
  const timestamp = now.toLocaleTimeString('en-US')
  logs.value.push({ timestamp, message, type })
  // Keep max 100 log entries
  if (logs.value.length > 100) {
    logs.value.shift()
  }
}

// Parse URLs
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
const hasValidUrls = computed(() => parsedUrls.value.length > 0)

// Start scraping
async function startScraping() {
  if (!hasValidUrls.value || isRunning.value) return

  isRunning.value = true
  isPaused.value = false
  error.value = null
  htmlResults.value = []
  linkResults.value = []
  savedFiles.value = []
  logs.value = []
  progress.value = { done: 0, total: parsedUrls.value.length }

  addLog(`Starting ${mode.value === 'html' ? 'HTML' : 'Links'} scraping for ${parsedUrls.value.length} URL(s)`, 'info')

  try {
    if (mode.value === 'html') {
      await scrapeHtml()
    } else {
      await scrapeLinks()
    }
    if (isRunning.value) addLog('Done!', 'success')
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'An error occurred'
    error.value = msg
    addLog(msg, 'error')
  } finally {
    isRunning.value = false
    currentUrl.value = null
  }
}

async function scrapeHtml() {
  const urls = parsedUrls.value
  const results: HtmlResult[] = []
  const batchSize = settings.value.requestSettings.parallelRequests || 5

  addLog(`Starting parallel scraping (${batchSize} concurrent)...`, 'info')

  for (let i = 0; i < urls.length; i += batchSize) {
    const batch = urls.slice(i, i + batchSize)
    currentUrl.value = `Batch ${Math.floor(i / batchSize) + 1}: ${batch.length} URLs...`

    addLog(`[${i + 1}-${Math.min(i + batchSize, urls.length)}/${urls.length}] Loading ${batch.length} URLs...`, 'progress')

    try {
      const response = await $fetch('/api/scrape-html', {
        method: 'POST',
        body: { urls: batch, cssSelector: settings.value.cssSelector }
      })

      for (const result of response.results) {
        results.push(result)
        if (result.error) {
          addLog(`✗ ${result.url}: ${result.error}`, 'error')
        } else {
          addLog(`✓ ${result.url}: ${result.status} (${formatSize(result.size)})`, 'success')
        }
      }
    } catch (e) {
      // On batch error: mark all URLs as failed
      for (const url of batch) {
        addLog(`✗ ${url}: ${e instanceof Error ? e.message : 'Error'}`, 'error')
        results.push({
          url,
          status: 0,
          contentType: 'error',
          size: 0,
          html: '',
          error: e instanceof Error ? e.message : 'Error'
        })
      }
    }

    progress.value.done = Math.min(i + batchSize, urls.length)
    htmlResults.value = [...results]
  }

  // Auto-Save
  addLog('Saving files...', 'info')
  await saveResults(results)
}

async function scrapeLinks() {
  addLog('Starting link analysis...', 'info')

  const controller = new AbortController()
  abortController.value = controller

  const response = await fetch('/api/scrape-links-stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      urls: parsedUrls.value,
      recursive: settings.value.recursive,
      maxUrls: settings.value.maxUrls,
      maxDepth: settings.value.maxDepth,
      rateLimit: settings.value.rateLimit,
      sameDomainOnly: settings.value.sameDomainOnly,
      urlFilter: settings.value.urlFilter,
      pathInclude: settings.value.pathInclude,
      pathExclude: settings.value.pathExclude,
      settings: settings.value.requestSettings
    }),
    signal: controller.signal
  })

  if (!response.ok || !response.body) {
    throw new Error(`Server error: ${response.status}`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      while (isPaused.value) {
        await new Promise(resolve => setTimeout(resolve, 100))
      }

      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      // Parse SSE messages from buffer
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
              linkResults.value.push(parsed)
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
              addLog(`${parsed.totalLinks} links found (${parsed.visited} pages visited)`, 'success')
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
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      return
    }
    throw e
  } finally {
    abortController.value = null
  }

  // Auto-Save
  if (linkResults.value.length > 0) {
    addLog('Saving files...', 'info')
    await saveResults(linkResults.value)
  }
}

async function saveResults(results: unknown[]) {
  if (results.length === 0) return

  const response = await $fetch('/api/save-results', {
    method: 'POST',
    body: {
      results,
      format: settings.value.saveFormat,
      mode: mode.value
    }
  })

  savedFiles.value = response.files
  addLog(`${response.files.length} file(s) saved`, 'success')
}

function stopScraping() {
  if (abortController.value) {
    abortController.value.abort()
  }
  isRunning.value = false
  isPaused.value = false
  addLog('Cancelled', 'error')
}

async function openOutputFolder() {
  try {
    await $fetch('/api/open-output', { method: 'POST' })
  } catch {
    // ignore
  }
}

async function clearOutputFolder() {
  isClearing.value = true
  try {
    await $fetch('/api/clear-output', { method: 'POST' })
    savedFiles.value = []
    addLog('Output folder cleared', 'success')
  } catch (e) {
    addLog(`Failed to clear: ${e instanceof Error ? e.message : 'Error'}`, 'error')
  } finally {
    isClearing.value = false
    showClearConfirm.value = false
  }
}


function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

// Auto-scroll Log
const logContainer = ref<HTMLElement | null>(null)
watch(logs, () => {
  nextTick(() => {
    if (logContainer.value) {
      logContainer.value.scrollTop = logContainer.value.scrollHeight
    }
  })
}, { deep: true })
</script>

<template>
  <div class="app">
    <header>
      <h1>🌐 URL Tools <span class="subtitle">(Scraping, SEO, Screenshots, Images)</span></h1>
      <nav class="tabs">
        <button
          :class="['tab', { active: activeTab === 'scraper' }]"
          @click="activeTab = 'scraper'"
        >
          🌐 Scraper
        </button>
        <button
          :class="['tab', { active: activeTab === 'seo' }]"
          @click="activeTab = 'seo'"
        >
          🔍 SEO Audit
        </button>
        <button
          :class="['tab', { active: activeTab === 'screenshots' }]"
          @click="activeTab = 'screenshots'"
        >
          📸 Screenshots
        </button>
        <button
          :class="['tab', { active: activeTab === 'images' }]"
          @click="activeTab = 'images'"
        >
          🖼️ Images
        </button>
        <button class="tab tab-output" @click="openOutputFolder">
          📂 Output
        </button>
      </nav>
    </header>

    <!-- Scraper Tab -->
    <main v-if="activeTab === 'scraper'">
      <div class="input-section">
        <!-- URL Input -->
        <div class="url-input">
          <label>URLs (one per line or comma-separated)</label>
          <textarea
            v-model="urlInput"
            placeholder="https://example.com&#10;https://example.org"
            :disabled="isRunning"
          ></textarea>
          <div class="url-count">{{ parsedUrls.length }} valid URL(s)</div>
        </div>

        <!-- Mode Selection -->
        <div class="mode-selection">
          <label>
            <input type="radio" v-model="mode" value="html" :disabled="isRunning">
            Scrape HTML
          </label>
          <label>
            <input type="radio" v-model="mode" value="links" :disabled="isRunning">
            Scrape Links
          </label>
        </div>

        <!-- Settings -->
        <SettingsPanel :mode="mode" v-model:settings="settings" />

        <!-- Actions -->
        <div class="actions">
          <button
            class="btn-primary"
            @click="startScraping"
            :disabled="!hasValidUrls || isRunning"
          >
            {{ isRunning ? (isPaused ? '⏸ Paused' : '⏳ Running...') : '▶ Start' }}
          </button>
          <button
            v-if="isRunning && !isPaused"
            class="btn-secondary"
            @click="isPaused = true"
          >
            ⏸ Pause
          </button>
          <button
            v-if="isRunning && isPaused"
            class="btn-secondary"
            @click="isPaused = false"
          >
            ▶ Resume
          </button>
          <button
            v-if="isRunning"
            class="btn-danger"
            @click="stopScraping"
          >
            ⏹ Stop
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
          ⏳ {{ currentUrl }}
        </div>

        <!-- Live Log -->
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

        <!-- Saved Files -->
        <div v-if="savedFiles.length" class="saved-files">
          <div class="saved-header">
            <span>✓ Saved:</span>
            <RecentJobsMenu :tool-type="mode === 'html' ? 'html' : 'links'" />
          </div>
          <ul>
            <li v-for="file in savedFiles" :key="file">{{ file }}</li>
          </ul>
        </div>

        <!-- Clear Output -->
        <button class="btn-clear-output" @click="showClearConfirm = true" :disabled="isClearing">
          🗑 Clear Output Folder
        </button>

        <!-- Clear Confirmation Modal -->
        <div v-if="showClearConfirm" class="modal-overlay" @click.self="showClearConfirm = false">
          <div class="modal">
            <h3>Clear Output Folder?</h3>
            <p>This will delete all scraped data, screenshots and exports.</p>
            <div class="modal-actions">
              <button class="btn-secondary" @click="showClearConfirm = false">Cancel</button>
              <button class="btn-danger" @click="clearOutputFolder" :disabled="isClearing">
                {{ isClearing ? 'Clearing...' : 'Yes, Delete All' }}
              </button>
            </div>
          </div>
        </div>

        <!-- Error -->
        <div v-if="error" class="error">{{ error }}</div>
      </div>

      <!-- Results -->
      <div class="results-section">
        <ResultsTable
          :mode="mode"
          :html-results="htmlResults"
          :link-results="linkResults"
        />
      </div>
    </main>

    <!-- SEO Audit Tab -->
    <main v-else-if="activeTab === 'seo'" class="full-page">
      <SeoAudit />
    </main>

    <!-- Screenshots Tab -->
    <main v-else-if="activeTab === 'screenshots'" class="full-page">
      <Screenshots />
    </main>

    <!-- Image Scraper Tab -->
    <main v-else-if="activeTab === 'images'" class="full-page">
      <ImageScraper />
    </main>

  </div>
</template>

<style>
* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: #0a0a0a;
  color: #e0e0e0;
  line-height: 1.5;
}

.app {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

header {
  padding: 16px 24px;
  border-bottom: 1px solid #333;
  display: flex;
  justify-content: space-between;
  align-items: center;
  position: sticky;
  top: 0;
  background: #0a0a0a;
  z-index: 100;
}

header h1 {
  font-size: 18px;
  font-weight: 600;
}

header h1 .subtitle {
  font-size: 12px;
  font-weight: 400;
  color: #666;
  margin-left: 8px;
}

.tabs {
  display: flex;
  gap: 4px;
}

.tab-output {
  margin-left: auto;
}

.tab {
  padding: 8px 16px;
  background: transparent;
  border: none;
  border-radius: 4px;
  color: #888;
  cursor: pointer;
  font-size: 13px;
}

.tab:hover {
  background: #1a1a1a;
  color: #fff;
}

.tab.active {
  background: #0066cc;
  color: #fff;
}

main {
  display: grid;
  grid-template-columns: 360px 1fr;
  flex: 1;
  overflow: hidden;
  height: calc(100vh - 60px);
}

.output-tab {
  flex: 1;
  overflow: hidden;
}

.full-page {
  display: block;
  height: calc(100vh - 60px);
  overflow-y: auto;
  background: #0a0a0a;
}

.input-section {
  padding: 16px;
  border-right: 1px solid #333;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
}

.url-input label {
  display: block;
  margin-bottom: 6px;
  font-size: 13px;
  color: #888;
}

.url-input textarea {
  width: 100%;
  height: 120px;
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

.mode-selection {
  display: flex;
  gap: 16px;
}

.mode-selection label {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}

.actions {
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

.btn-secondary {
  padding: 12px 16px;
  background: #333;
  border: none;
  border-radius: 4px;
  color: #fff;
  cursor: pointer;
}

.btn-secondary:hover {
  background: #444;
}

.progress {
  display: flex;
  align-items: center;
  gap: 12px;
}

.progress-bar {
  flex: 1;
  height: 6px;
  background: #333;
  border-radius: 3px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: #0066cc;
  transition: width 0.3s ease;
}

.progress-text {
  font-size: 12px;
  color: #888;
  min-width: 60px;
  text-align: right;
}

.current-url {
  padding: 8px 12px;
  background: #1a1a3d;
  border-radius: 4px;
  font-family: 'SF Mono', Monaco, monospace;
  font-size: 11px;
  color: #818cf8;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.log-container {
  background: #0a0a0a;
  border: 1px solid #333;
  border-radius: 4px;
  max-height: 200px;
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
  padding: 12px;
  background: #1a3d1a;
  border-radius: 4px;
  font-size: 13px;
  color: #4ade80;
}

.saved-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
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

.saved-files ul {
  margin-top: 8px;
  margin-left: 20px;
  font-family: 'SF Mono', Monaco, monospace;
  font-size: 11px;
}

.error {
  padding: 12px;
  background: #4d1a1a;
  border-radius: 4px;
  color: #f87171;
  font-size: 13px;
}

.results-section {
  padding: 16px;
  overflow: auto;
}

.btn-danger {
  padding: 12px 16px;
  background: #cc3333;
  border: none;
  border-radius: 4px;
  color: #fff;
  cursor: pointer;
}

.btn-danger:hover {
  background: #dd4444;
}

.coming-soon {
  display: flex;
  align-items: center;
  justify-content: center;
  height: calc(100vh - 60px);
  background: #0a0a0a;
}

.placeholder {
  text-align: center;
  padding: 40px;
}

.placeholder h2 {
  font-size: 24px;
  margin-bottom: 12px;
  color: #fff;
}

.placeholder p {
  color: #888;
  margin-bottom: 8px;
}

.placeholder .hint {
  color: #666;
  font-size: 14px;
  margin-top: 16px;
}

.btn-clear-output {
  width: 100%;
  padding: 10px;
  background: transparent;
  border: 1px dashed #444;
  border-radius: 4px;
  color: #888;
  cursor: pointer;
  font-size: 13px;
}

.btn-clear-output:hover:not(:disabled) {
  border-color: #f87171;
  color: #f87171;
  background: #4d1a1a33;
}

.btn-clear-output:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal {
  background: #1a1a1a;
  border: 1px solid #333;
  border-radius: 8px;
  padding: 24px;
  max-width: 400px;
  width: 90%;
}

.modal h3 {
  margin-bottom: 12px;
  color: #fff;
}

.modal p {
  color: #888;
  margin-bottom: 20px;
  font-size: 14px;
}

.modal-actions {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
}
</style>
