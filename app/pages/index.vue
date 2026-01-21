<script setup lang="ts">
interface Settings {
  recursive: boolean
  maxUrls: number
  maxDepth: number
  rateLimit: number
  sameDomainOnly: boolean
  saveFormat: 'json' | 'csv' | 'both'
  cssSelector: string
  parallelRequests: number
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
  parallelRequests: 5
})

const isRunning = ref(false)
const progress = ref({ done: 0, total: 0 })
const htmlResults = ref<HtmlResult[]>([])
const linkResults = ref<LinkResult[]>([])
const savedFiles = ref<string[]>([])
const error = ref<string | null>(null)
const logs = ref<LogEntry[]>([])
const currentUrl = ref<string | null>(null)
const activeTab = ref<'scraper' | 'output'>('scraper')
const outputDir = ref('')

// Log-Funktion
function addLog(message: string, type: LogEntry['type'] = 'info') {
  const now = new Date()
  const timestamp = now.toLocaleTimeString('de-DE')
  logs.value.push({ timestamp, message, type })
  // Max 100 Log-Einträge behalten
  if (logs.value.length > 100) {
    logs.value.shift()
  }
}

// URLs parsen
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

// Scraping starten
async function startScraping() {
  if (!hasValidUrls.value || isRunning.value) return

  isRunning.value = true
  error.value = null
  htmlResults.value = []
  linkResults.value = []
  savedFiles.value = []
  logs.value = []
  progress.value = { done: 0, total: parsedUrls.value.length }

  addLog(`Starte ${mode.value === 'html' ? 'HTML' : 'Links'}-Scraping für ${parsedUrls.value.length} URL(s)`, 'info')

  try {
    if (mode.value === 'html') {
      await scrapeHtml()
    } else {
      await scrapeLinks()
    }
    addLog('Fertig!', 'success')
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Ein Fehler ist aufgetreten'
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
  const batchSize = settings.value.parallelRequests || 5
  
  addLog(`Starte paralleles Scraping (${batchSize} gleichzeitig)...`, 'info')
  
  for (let i = 0; i < urls.length; i += batchSize) {
    const batch = urls.slice(i, i + batchSize)
    currentUrl.value = `Batch ${Math.floor(i / batchSize) + 1}: ${batch.length} URLs...`
    
    addLog(`[${i + 1}-${Math.min(i + batchSize, urls.length)}/${urls.length}] Lade ${batch.length} URLs...`, 'progress')
    
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
      // Bei Batch-Fehler: alle URLs als Fehler markieren
      for (const url of batch) {
        addLog(`✗ ${url}: ${e instanceof Error ? e.message : 'Fehler'}`, 'error')
        results.push({
          url,
          status: 0,
          contentType: 'error',
          size: 0,
          html: '',
          error: e instanceof Error ? e.message : 'Fehler'
        })
      }
    }
    
    progress.value.done = Math.min(i + batchSize, urls.length)
    htmlResults.value = [...results]
  }

  // Auto-Save
  addLog('Speichere Dateien...', 'info')
  await saveResults(results)
}

async function scrapeLinks() {
  addLog('Starte Link-Analyse...', 'info')
  
  const response = await $fetch('/api/scrape-links', {
    method: 'POST',
    body: {
      urls: parsedUrls.value,
      recursive: settings.value.recursive,
      maxUrls: settings.value.maxUrls,
      maxDepth: settings.value.maxDepth,
      rateLimit: settings.value.rateLimit,
      sameDomainOnly: settings.value.sameDomainOnly
    }
  })

  linkResults.value = response.results
  progress.value.done = response.stats.totalLinks
  progress.value.total = response.stats.totalLinks
  
  addLog(`${response.stats.totalLinks} Links gefunden`, 'success')

  // Auto-Save
  addLog('Speichere Dateien...', 'info')
  await saveResults(response.results)
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
  addLog(`${response.files.length} Datei(en) gespeichert`, 'success')
}

function stopScraping() {
  isRunning.value = false
  addLog('Abgebrochen', 'error')
}

async function openOutputFolder() {
  try {
    await $fetch('/api/open-folder', {
      query: { path: outputDir.value || process.cwd() + '/output' }
    })
  } catch (error) {
    console.error('Failed to open folder:', error)
  }
}

// Output-Dir laden für den Button
onMounted(async () => {
  try {
    const response = await $fetch('/api/get-output-dir')
    outputDir.value = response.outputDir
  } catch {}
})

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
      <h1>HTML/JSON Scraper</h1>
      <nav class="tabs">
        <button 
          :class="['tab', { active: activeTab === 'scraper' }]" 
          @click="activeTab = 'scraper'"
        >
          Scraper
        </button>
        <button 
          :class="['tab', { active: activeTab === 'output' }]" 
          @click="activeTab = 'output'"
        >
          📁 Output
        </button>
      </nav>
    </header>

    <main>
      <div class="input-section">
        <!-- URL Input -->
        <div class="url-input">
          <label>URLs (eine pro Zeile oder mit Komma getrennt)</label>
          <textarea 
            v-model="urlInput" 
            placeholder="https://example.com&#10;https://example.org"
            :disabled="isRunning"
          ></textarea>
          <div class="url-count">{{ parsedUrls.length }} gültige URL(s)</div>
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
            {{ isRunning ? 'Läuft...' : 'Go' }}
          </button>
          <button 
            v-if="isRunning" 
            class="btn-secondary" 
            @click="stopScraping"
          >
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
            <span>✓ Gespeichert:</span>
            <button class="btn-folder" @click="openOutputFolder">📂 Ordner öffnen</button>
          </div>
          <ul>
            <li v-for="file in savedFiles" :key="file">{{ file }}</li>
          </ul>
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

    <!-- Output Browser Tab -->
    <div v-if="activeTab === 'output'" class="output-tab">
      <OutputBrowser />
    </div>
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
}

header h1 {
  font-size: 18px;
  font-weight: 600;
}

.tabs {
  display: flex;
  gap: 4px;
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
}

.output-tab {
  flex: 1;
  overflow: hidden;
}

.input-section {
  padding: 16px;
  border-right: 1px solid #333;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
  max-height: calc(100vh - 60px);
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
</style>
