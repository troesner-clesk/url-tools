<script setup lang="ts">
import {
  Camera,
  Check,
  FolderOpen,
  Globe,
  Hourglass,
  Image,
  Link2,
  Loader,
  Map as MapIcon,
  Moon,
  Pause,
  Play,
  Search,
  Square,
  Sun,
  Trash2,
} from 'lucide-vue-next'

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

// Theme
const { theme, toggleTheme, initTheme } = useTheme()
onMounted(() => initTheme())

// State
const urlInput = ref('')
const { logs, addLog, logContainer } = useLogger()
const { parsedUrls, hasValidUrls } = useUrlParser(urlInput)
const { formatSize } = useFormatters()
const mode = ref<'html' | 'links'>('html')
const settings = ref<Settings>({
  recursive: false,
  maxUrls: 100,
  maxDepth: 3,
  rateLimit: 2,
  sameDomainOnly: true,
  saveFormat: 'csv',
  cssSelector: '',
  urlFilter: '',
  pathInclude: '',
  pathExclude: '',
  requestSettings: {
    timeout: 30,
    retries: 1,
    proxy: '',
    headers: {},
    parallelRequests: 5,
  },
})

const isRunning = ref(false)
const isPaused = ref(false)
const progress = ref({ done: 0, total: 0 })
const htmlResults = ref<HtmlResult[]>([])
const linkResults = ref<LinkResult[]>([])
const savedFiles = ref<string[]>([])
const errorMessage = ref<string | null>(null)
const currentUrl = ref<string | null>(null)
const activeTab = ref<
  'scraper' | 'seo' | 'screenshots' | 'images' | 'sitemap' | 'broken-links'
>('scraper')
const showClearConfirm = ref(false)
const isClearing = ref(false)
const abortController = ref<AbortController | null>(null)

// Template refs for child components
const seoAuditRef = ref<{ isRunning: boolean } | null>(null)
const screenshotsRef = ref<{ isRunning: boolean } | null>(null)
const imageScraperRef = ref<{ isRunning: boolean } | null>(null)
const sitemapRef = ref<{ isRunning: boolean } | null>(null)
const brokenLinksRef = ref<{ isRunning: boolean } | null>(null)

// Tab switch warning
const showTabSwitchWarning = ref(false)
const pendingTab = ref<typeof activeTab.value | null>(null)

function isOperationRunning(): boolean {
  if (activeTab.value === 'scraper') return isRunning.value
  if (activeTab.value === 'seo') return seoAuditRef.value?.isRunning ?? false
  if (activeTab.value === 'screenshots')
    return screenshotsRef.value?.isRunning ?? false
  if (activeTab.value === 'images')
    return imageScraperRef.value?.isRunning ?? false
  if (activeTab.value === 'sitemap')
    return sitemapRef.value?.isRunning ?? false
  if (activeTab.value === 'broken-links')
    return brokenLinksRef.value?.isRunning ?? false
  return false
}

function switchTab(tab: typeof activeTab.value) {
  if (tab === activeTab.value) return
  if (isOperationRunning()) {
    pendingTab.value = tab
    showTabSwitchWarning.value = true
    return
  }
  activeTab.value = tab
}

function confirmTabSwitch() {
  if (pendingTab.value) {
    activeTab.value = pendingTab.value
  }
  pendingTab.value = null
  showTabSwitchWarning.value = false
}

function cancelTabSwitch() {
  pendingTab.value = null
  showTabSwitchWarning.value = false
}

// Warn before page reload when operation is running
watchEffect((onCleanup) => {
  if (isOperationRunning()) {
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
    }
    window.addEventListener('beforeunload', handler)
    onCleanup(() => window.removeEventListener('beforeunload', handler))
  }
})

// Start scraping
async function startScraping() {
  if (!hasValidUrls.value || isRunning.value) return

  isRunning.value = true
  isPaused.value = false
  errorMessage.value = null
  htmlResults.value = []
  linkResults.value = []
  savedFiles.value = []
  logs.value = []
  progress.value = { done: 0, total: parsedUrls.value.length }

  addLog(
    `Starting ${mode.value === 'html' ? 'HTML' : 'Links'} scraping for ${parsedUrls.value.length} URL(s)`,
    'info',
  )

  try {
    if (mode.value === 'html') {
      await scrapeHtml()
    } else {
      await scrapeLinks()
    }
    if (isRunning.value) addLog('Done!', 'success')
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'An error occurred'
    errorMessage.value = msg
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

    addLog(
      `[${i + 1}-${Math.min(i + batchSize, urls.length)}/${urls.length}] Loading ${batch.length} URLs...`,
      'progress',
    )

    try {
      const response = await $fetch('/api/scrape-html', {
        method: 'POST',
        body: { urls: batch, cssSelector: settings.value.cssSelector },
      })

      for (const result of response.results) {
        results.push(result)
        if (result.error) {
          addLog(`✗ ${result.url}: ${result.error}`, 'error')
        } else {
          addLog(
            `✓ ${result.url}: ${result.status} (${formatSize(result.size)})`,
            'success',
          )
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
          error: e instanceof Error ? e.message : 'Error',
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
      settings: settings.value.requestSettings,
    }),
    signal: controller.signal,
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
        await new Promise((resolve) => setTimeout(resolve, 100))
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
              addLog(
                `${parsed.totalLinks} links found (${parsed.visited} pages visited)`,
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
      mode: mode.value,
    },
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
    addLog(
      `Failed to clear: ${e instanceof Error ? e.message : 'Error'}`,
      'error',
    )
  } finally {
    isClearing.value = false
    showClearConfirm.value = false
  }
}
</script>

<template>
  <div class="app">
    <header>
      <h1><Globe :size="18" /> URL Tools <span class="subtitle">(Scraping, SEO, Screenshots, Images, Links)</span></h1>
      <nav class="tabs">
        <button
          :class="['tab', { active: activeTab === 'scraper' }]"
          @click="switchTab('scraper')"
        >
          <Globe :size="14" /> Scraper
        </button>
        <button
          :class="['tab', { active: activeTab === 'seo' }]"
          @click="switchTab('seo')"
        >
          <Search :size="14" /> SEO Audit
        </button>
        <button
          :class="['tab', { active: activeTab === 'screenshots' }]"
          @click="switchTab('screenshots')"
        >
          <Camera :size="14" /> Screenshots
        </button>
        <button
          :class="['tab', { active: activeTab === 'images' }]"
          @click="switchTab('images')"
        >
          <Image :size="14" /> Images
        </button>
        <button
          :class="['tab', { active: activeTab === 'sitemap' }]"
          @click="switchTab('sitemap')"
        >
          <MapIcon :size="14" /> Sitemap
        </button>
        <button
          :class="['tab', { active: activeTab === 'broken-links' }]"
          @click="switchTab('broken-links')"
        >
          <Link2 :size="14" /> Link Checker
        </button>
        <button class="tab tab-output" @click="openOutputFolder">
          <FolderOpen :size="14" /> Output
        </button>
        <button class="tab tab-theme" @click="toggleTheme" :aria-label="theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'">
          <Sun v-if="theme === 'dark'" :size="14" />
          <Moon v-else :size="14" />
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
            <template v-if="isRunning && isPaused"><Pause :size="14" /> Paused</template>
            <template v-else-if="isRunning"><Loader :size="14" class="spin" /> Running...</template>
            <template v-else><Play :size="14" /> Start</template>
          </button>
          <button
            v-if="isRunning && !isPaused"
            class="btn-secondary"
            @click="isPaused = true"
          >
            <Pause :size="14" /> Pause
          </button>
          <button
            v-if="isRunning && isPaused"
            class="btn-secondary"
            @click="isPaused = false"
          >
            <Play :size="14" /> Resume
          </button>
          <button
            v-if="isRunning"
            class="btn-danger"
            @click="stopScraping"
          >
            <Square :size="14" /> Stop
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
            <span><Check :size="14" /> Saved:</span>
            <RecentJobsMenu :tool-type="mode === 'html' ? 'html' : 'links'" />
          </div>
          <ul>
            <li v-for="file in savedFiles" :key="file">{{ file }}</li>
          </ul>
        </div>

        <!-- Clear Output -->
        <button class="btn-clear-output" @click="showClearConfirm = true" :disabled="isClearing">
          <Trash2 :size="14" /> Clear Output Folder
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
        <div v-if="errorMessage" class="error">{{ errorMessage }}</div>
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
      <SeoAudit ref="seoAuditRef" />
    </main>

    <!-- Screenshots Tab -->
    <main v-else-if="activeTab === 'screenshots'" class="full-page">
      <Screenshots ref="screenshotsRef" />
    </main>

    <!-- Image Scraper Tab -->
    <main v-else-if="activeTab === 'images'" class="full-page">
      <ImageScraper ref="imageScraperRef" />
    </main>

    <!-- Broken Link Checker Tab -->
    <!-- Sitemap Parser Tab -->
    <main v-else-if="activeTab === 'sitemap'" class="full-page">
      <SitemapParser ref="sitemapRef" />
    </main>

    <!-- Broken Link Checker Tab -->
    <main v-else-if="activeTab === 'broken-links'" class="full-page">
      <BrokenLinkChecker ref="brokenLinksRef" />
    </main>

    <!-- Tab Switch Warning Modal -->
    <div v-if="showTabSwitchWarning" class="modal-overlay" @click.self="cancelTabSwitch">
      <div class="modal">
        <h3>Operation in Progress</h3>
        <p>An operation is still running. Switching tabs will stop it and discard its results.</p>
        <div class="modal-actions">
          <button class="btn-secondary" @click="cancelTabSwitch">Stay</button>
          <button class="btn-danger" @click="confirmTabSwitch">Switch Anyway</button>
        </div>
      </div>
    </div>

  </div>
</template>

<style>
:root,
[data-theme="dark"] {
    --bg-primary: #0a0a0a;
    --bg-secondary: #1a1a1a;
    --bg-tertiary: #252525;
    --text-primary: #e0e0e0;
    --text-secondary: #888;
    --text-muted: #666;
    --border: #333;
    --accent: #0066cc;
    --accent-hover: #0077ee;
    --success: #4ade80;
    --success-bg: #1a3d1a;
    --error: #f87171;
    --error-bg: #4d1a1a;
    --warning: #f97316;
    --info: #38bdf8;
    --info-bg: #1a1a3d;
}

[data-theme="light"] {
    --bg-primary: #ffffff;
    --bg-secondary: #f5f5f5;
    --bg-tertiary: #e8e8e8;
    --text-primary: #1a1a1a;
    --text-secondary: #555;
    --text-muted: #888;
    --border: #ddd;
    --accent: #0066cc;
    --accent-hover: #0055aa;
    --success: #16a34a;
    --success-bg: #dcfce7;
    --error: #dc2626;
    --error-bg: #fef2f2;
    --warning: #ea580c;
    --info: #0284c7;
    --info-bg: #e0f2fe;
}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: var(--bg-primary);
  color: var(--text-primary);
  line-height: 1.5;
}

.app {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

header {
  padding: 16px 24px;
  border-bottom: 1px solid var(--border);
  display: flex;
  justify-content: space-between;
  align-items: center;
  position: sticky;
  top: 0;
  background: var(--bg-primary);
  z-index: 100;
}

header h1 {
  font-size: 18px;
  font-weight: 600;
}

header h1 .subtitle {
  font-size: 12px;
  font-weight: 400;
  color: var(--text-muted);
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
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 13px;
}

.tab:hover {
  background: var(--bg-secondary);
  color: var(--text-primary);
}

.tab.active {
  background: var(--accent);
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
  background: var(--bg-primary);
}

.input-section {
  padding: 16px;
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
}

.url-input label {
  display: block;
  margin-bottom: 6px;
  font-size: 13px;
  color: var(--text-secondary);
}

.url-input textarea {
  width: 100%;
  height: 120px;
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

.btn-secondary {
  padding: 12px 16px;
  background: var(--border);
  border: none;
  border-radius: 4px;
  color: var(--text-primary);
  cursor: pointer;
}

.btn-secondary:hover {
  background: var(--bg-tertiary);
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
}

.log-container {
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: 4px;
  max-height: 200px;
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

.saved-files {
  padding: 12px;
  background: var(--success-bg);
  border-radius: 4px;
  font-size: 13px;
  color: var(--success);
}

.saved-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.btn-folder {
  padding: 4px 8px;
  background: var(--success-bg);
  border: none;
  border-radius: 3px;
  color: var(--success);
  cursor: pointer;
  font-size: 11px;
}

.btn-folder:hover {
  background: var(--bg-tertiary);
}

.saved-files ul {
  margin-top: 8px;
  margin-left: 20px;
  font-family: 'SF Mono', Monaco, monospace;
  font-size: 11px;
}

.error {
  padding: 12px;
  background: var(--error-bg);
  border-radius: 4px;
  color: var(--error);
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
  background: var(--bg-primary);
}

.placeholder {
  text-align: center;
  padding: 40px;
}

.placeholder h2 {
  font-size: 24px;
  margin-bottom: 12px;
  color: var(--text-primary);
}

.placeholder p {
  color: var(--text-secondary);
  margin-bottom: 8px;
}

.placeholder .hint {
  color: var(--text-muted);
  font-size: 14px;
  margin-top: 16px;
}

.btn-clear-output {
  width: 100%;
  padding: 10px;
  background: transparent;
  border: 1px dashed var(--border);
  border-radius: 4px;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 13px;
}

.btn-clear-output:hover:not(:disabled) {
  border-color: var(--error);
  color: var(--error);
  background: color-mix(in srgb, var(--error-bg) 30%, transparent);
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
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 24px;
  max-width: 400px;
  width: 90%;
}

.modal h3 {
  margin-bottom: 12px;
  color: var(--text-primary);
}

.modal p {
  color: var(--text-secondary);
  margin-bottom: 20px;
  font-size: 14px;
}

.modal-actions {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
}

.spin {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

@media (max-width: 768px) {
    header {
        flex-direction: column;
        gap: 8px;
        padding: 12px 16px;
    }

    .tabs {
        flex-wrap: wrap;
        width: 100%;
    }

    .tab {
        flex: 1;
        text-align: center;
        min-width: 0;
        padding: 8px 8px;
        font-size: 12px;
    }

    .tab-output, .tab-theme {
        flex: none;
    }

    main {
        grid-template-columns: 1fr;
        height: auto;
    }

    .input-section {
        border-right: none;
        border-bottom: 1px solid var(--border);
        max-height: 50vh;
    }
}
</style>
