<script setup lang="ts">
interface LogEntry {
  timestamp: string
  message: string
  type: 'info' | 'success' | 'error' | 'progress'
}

interface ScreenshotResult {
  url: string
  success: boolean
  filename?: string
  path?: string
  size?: number
  error?: string
}

interface ScreenshotResponse {
  results: ScreenshotResult[]
  outputDir: string
  stats: {
    total: number
    success: number
    failed: number
  }
}

const urlInput = ref('')
const format = ref<'png' | 'jpg' | 'pdf'>('png')
const viewport = ref({ width: 1920, height: 1080 })
const fullPage = ref(true)
const quality = ref(80)

const isLoading = ref(false)
const isCancelled = ref(false)
const results = ref<ScreenshotResult[]>([])
const selectedResult = ref<ScreenshotResult | null>(null)
const outputDir = ref('')
const error = ref<string | null>(null)
const logs = ref<LogEntry[]>([])
const logContainer = ref<HTMLElement | null>(null)
const previewUrl = ref<string | null>(null)

function addLog(message: string, type: LogEntry['type'] = 'info') {
  const now = new Date()
  const timestamp = now.toLocaleTimeString('en-US')
  logs.value.push({ timestamp, message, type })
  if (logs.value.length > 100) {
    logs.value.shift()
  }
}

// Auto-scroll Log
watch(logs, () => {
  nextTick(() => {
    if (logContainer.value) {
      logContainer.value.scrollTop = logContainer.value.scrollHeight
    }
  })
}, { deep: true })

const viewportPresets = [
  { label: 'Desktop (1920x1080)', width: 1920, height: 1080 },
  { label: '4K (3840x2160)', width: 3840, height: 2160 },
  { label: 'Laptop (1366x768)', width: 1366, height: 768 },
  { label: 'Tablet (768x1024)', width: 768, height: 1024 },
  { label: 'Mobile (375x812)', width: 375, height: 812 }
]

const parsedUrls = computed(() => {
  return urlInput.value
    .split(/[\n,]+/)
    .map(u => u.trim())
    .filter(u => {
      try {
        new URL(u)
        return true
      } catch {
        return false
      }
    })
})

function stopScreenshots() {
  isCancelled.value = true
  addLog('Stopping...', 'info')
}

async function takeScreenshots() {
  if (parsedUrls.value.length === 0) return

  isLoading.value = true
  isCancelled.value = false
  error.value = null
  results.value = []
  selectedResult.value = null
  outputDir.value = ''
  logs.value = []
  previewUrl.value = null

  const urlCount = parsedUrls.value.length
  addLog(`Starting screenshot creation for ${urlCount} URL(s)`, 'info')
  addLog(`Format: ${format.value.toUpperCase()}, Viewport: ${viewport.value.width}x${viewport.value.height}`, 'info')
  if (fullPage.value && format.value !== 'pdf') {
    addLog('Full-page mode enabled', 'info')
  }

  let successCount = 0
  let failCount = 0

  try {
    for (let i = 0; i < parsedUrls.value.length; i++) {
      if (isCancelled.value) {
        addLog('Cancelled', 'error')
        break
      }

      const url = parsedUrls.value[i]
      addLog(`[${i + 1}/${urlCount}] Processing ${url}...`, 'progress')

      try {
        const currentOutputDir: string = outputDir.value
        const response: ScreenshotResponse = await $fetch('/api/screenshot', {
          method: 'POST',
          body: {
            urls: [url],
            format: format.value,
            viewport: viewport.value,
            fullPage: fullPage.value,
            quality: format.value === 'jpg' ? quality.value : undefined,
            timeout: 30,
            outputDir: currentOutputDir || undefined, // Reuse same folder for all URLs
            startIndex: i // Continue numbering from current index
          }
        })

        // Store the output dir from first response to reuse for subsequent URLs
        if (!outputDir.value && response.outputDir) {
          outputDir.value = response.outputDir
        }

        const result = response.results[0]
        if (result) {
          // Store the full path
          if (result.filename && response.outputDir) {
            result.path = `${response.outputDir}/${result.filename}`
          }
          results.value.push(result)

          if (result.success) {
            successCount++
            addLog(`✓ ${url}: ${result.filename} (${formatBytes(result.size || 0)})`, 'success')
            // Auto-select first successful result
            if (!selectedResult.value) {
              selectResult(result)
            }
          } else {
            failCount++
            addLog(`✗ ${url}: ${result.error}`, 'error')
          }
        }
      } catch (e) {
        failCount++
        const errMsg: string = e instanceof Error ? e.message : 'Unknown error'
        addLog(`✗ ${url}: ${errMsg}`, 'error')
        results.value.push({
          url,
          success: false,
          error: errMsg
        } as ScreenshotResult)
      }
    }

    addLog(`${successCount}/${urlCount} successful`, failCount > 0 ? 'error' : 'success')
    if (!isCancelled.value) {
      addLog('Done!', 'success')
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Screenshot error'
    error.value = msg
    addLog(`✗ ${msg}`, 'error')
  } finally {
    isLoading.value = false
  }
}

async function selectResult(result: ScreenshotResult) {
  selectedResult.value = result
  previewUrl.value = null

  if (result.success && result.path && format.value !== 'pdf') {
    try {
      const response = await $fetch<{ content: string }>('/api/read-file', {
        query: { path: result.path, base64: true }
      })
      if (response.content) {
        const mimeType = format.value === 'png' ? 'image/png' : 'image/jpeg'
        previewUrl.value = `data:${mimeType};base64,${response.content}`
      }
    } catch {
      // Preview not available
    }
  }
}

const selectedPresetIndex = computed({
  get: () => viewportPresets.findIndex(p => p.width === viewport.value.width && p.height === viewport.value.height),
  set: (index: number) => {
    const preset = viewportPresets[index]
    if (preset) {
      viewport.value = { width: preset.width, height: preset.height }
    }
  }
})

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

</script>

<template>
  <div class="screenshots-container">
    <!-- Left: Input Section -->
    <div class="input-section">
      <h2>📸 Screenshots & PDF</h2>
      <p class="subtitle">Create screenshots or PDFs of web pages</p>

      <div class="url-input">
        <label>URLs (one per line)</label>
        <textarea
          v-model="urlInput"
          placeholder="https://example.com&#10;https://another-site.com"
          :disabled="isLoading"
        ></textarea>
        <div class="url-count">{{ parsedUrls.length }} URL{{ parsedUrls.length !== 1 ? 's' : '' }}</div>
      </div>

      <div class="option">
        <label>Format</label>
        <select v-model="format" :disabled="isLoading">
          <option value="png">PNG (lossless)</option>
          <option value="jpg">JPG (compressed)</option>
          <option value="pdf">PDF (document)</option>
        </select>
      </div>

      <div class="option">
        <label>Viewport</label>
        <select v-model="selectedPresetIndex" :disabled="isLoading">
          <option v-for="(preset, index) in viewportPresets" :key="preset.label" :value="index">
            {{ preset.label }}
          </option>
        </select>
      </div>

      <div v-if="format !== 'pdf'" class="option checkbox">
        <label>
          <input type="checkbox" v-model="fullPage" :disabled="isLoading">
          Full page (scroll height)
        </label>
      </div>

      <div v-if="format === 'jpg'" class="option">
        <label>Quality: {{ quality }}%</label>
        <input type="range" v-model.number="quality" min="10" max="100" step="5" :disabled="isLoading">
      </div>

      <div class="button-row">
        <button
          class="btn-primary"
          @click="takeScreenshots"
          :disabled="parsedUrls.length === 0 || isLoading"
        >
          {{ isLoading ? '⏳ Creating...' : '📸 Create' }}
        </button>
        <button v-if="isLoading" class="btn-stop" @click="stopScreenshots">
          Stop
        </button>
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

      <div v-if="error" class="error-message">
        {{ error }}
      </div>
    </div>

    <!-- Right: Results Section -->
    <div class="results-section">
      <div v-if="results.length === 0" class="empty-state">
        <p>No results yet</p>
        <p class="hint">Enter URLs and click "Create" to generate screenshots</p>
      </div>

      <div v-else class="results-area">
        <!-- Results List -->
        <div class="results-list">
          <div class="results-header">
            <h3>Results ({{ results.filter(r => r.success).length }}/{{ results.length }})</h3>
            <RecentJobsMenu tool-type="screenshots" />
          </div>

          <div class="results-items">
            <div
              v-for="result in results"
              :key="result.url"
              :class="['result-item', { active: selectedResult?.url === result.url, success: result.success, failed: !result.success }]"
              @click="selectResult(result)"
            >
              <span class="result-status">{{ result.success ? '✓' : '✗' }}</span>
              <div class="result-info">
                <div class="result-url">{{ result.url }}</div>
                <div v-if="result.success" class="result-meta">
                  {{ result.filename }} • {{ formatBytes(result.size || 0) }}
                </div>
                <div v-else class="result-error">{{ result.error }}</div>
              </div>
            </div>
          </div>
        </div>

        <!-- Detail/Preview Panel -->
        <div class="detail-panel">
          <div v-if="!selectedResult" class="detail-empty">
            <p>Select a result to preview</p>
          </div>

          <div v-else-if="!selectedResult.success" class="detail-error">
            <h3>{{ selectedResult.url }}</h3>
            <p class="error-text">{{ selectedResult.error }}</p>
          </div>

          <div v-else class="detail-content">
            <div class="detail-header">
              <h3>{{ selectedResult.filename }}</h3>
              <span class="detail-size">{{ formatBytes(selectedResult.size || 0) }}</span>
            </div>
            <div class="detail-url">{{ selectedResult.url }}</div>

            <!-- Image Preview -->
            <div v-if="previewUrl" class="preview-image">
              <img :src="previewUrl" :alt="selectedResult.filename">
            </div>
            <div v-else-if="format === 'pdf'" class="preview-placeholder">
              <span class="preview-icon">📄</span>
              <p>PDF preview not available</p>
              <p class="hint">Click "Open" to view in Finder</p>
            </div>
            <div v-else class="preview-placeholder">
              <span class="preview-icon">🖼️</span>
              <p>Loading preview...</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.screenshots-container {
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

.option label {
  display: block;
  font-size: 13px;
  color: #888;
  margin-bottom: 4px;
}

.option select,
.option input[type="range"] {
  width: 100%;
  padding: 8px;
  border: 1px solid #333;
  border-radius: 4px;
  background: #1a1a1a;
  color: #fff;
}

.option.checkbox label {
  display: flex;
  align-items: center;
  gap: 8px;
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
  max-height: 150px;
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

.error-message {
  padding: 12px;
  background: #4d1a1a;
  border-radius: 4px;
  color: #f87171;
  font-size: 13px;
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

.results-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: #1a1a1a;
  border-bottom: 1px solid #333;
}

.results-header h3 {
  font-size: 14px;
  color: #fff;
  margin: 0;
}

.btn-folder {
  padding: 6px 12px;
  background: #333;
  border: none;
  border-radius: 4px;
  color: #fff;
  cursor: pointer;
  font-size: 12px;
}

.btn-folder:hover {
  background: #444;
}

.results-items {
  flex: 1;
  overflow-y: auto;
}

.result-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid #1a1a1a;
  cursor: pointer;
  border-left: 3px solid transparent;
}

.result-item:hover {
  background: #1a1a1a;
}

.result-item.active {
  background: #0066cc22;
  border-left-color: #0066cc;
}

.result-item.success .result-status {
  color: #22c55e;
}

.result-item.failed .result-status {
  color: #ef4444;
}

.result-status {
  font-size: 16px;
  flex-shrink: 0;
}

.result-info {
  flex: 1;
  min-width: 0;
}

.result-url {
  font-size: 12px;
  color: #e0e0e0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.result-meta {
  font-size: 11px;
  color: #888;
  margin-top: 2px;
}

.result-error {
  font-size: 11px;
  color: #f87171;
  margin-top: 2px;
}

/* Detail Panel */
.detail-panel {
  display: flex;
  flex-direction: column;
  overflow: hidden;
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
  padding: 24px;
}

.detail-error h3 {
  font-size: 14px;
  color: #fff;
  margin-bottom: 8px;
  word-break: break-all;
}

.detail-error .error-text {
  color: #f87171;
}

.detail-content {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.detail-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: #1a1a1a;
  border-bottom: 1px solid #333;
}

.detail-header h3 {
  font-size: 14px;
  color: #fff;
  margin: 0;
}

.detail-size {
  font-size: 12px;
  color: #888;
}

.detail-url {
  padding: 8px 16px;
  font-size: 12px;
  color: #888;
  background: #0a0a0a;
  border-bottom: 1px solid #333;
  word-break: break-all;
}

.preview-image {
  flex: 1;
  overflow: auto;
  padding: 16px;
  display: flex;
  align-items: flex-start;
  justify-content: center;
}

.preview-image img {
  max-width: 100%;
  height: auto;
  border-radius: 4px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

.preview-placeholder {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #666;
}

.preview-icon {
  font-size: 48px;
  margin-bottom: 12px;
}

.preview-placeholder .hint {
  font-size: 12px;
  margin-top: 4px;
}
</style>
