<script setup lang="ts">
import { Camera, Check, FileText, Image, Loader, X } from 'lucide-vue-next'

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
const { logs, addLog, logContainer } = useLogger()
const { parsedUrls } = useUrlParser(urlInput)
const { formatSize } = useFormatters()
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
const previewUrl = ref<string | null>(null)

const viewportPresets = [
  { label: 'Desktop (1920x1080)', width: 1920, height: 1080 },
  { label: '4K (3840x2160)', width: 3840, height: 2160 },
  { label: 'Laptop (1366x768)', width: 1366, height: 768 },
  { label: 'Tablet (768x1024)', width: 768, height: 1024 },
  { label: 'Mobile (375x812)', width: 375, height: 812 },
]

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
  addLog(
    `Format: ${format.value.toUpperCase()}, Viewport: ${viewport.value.width}x${viewport.value.height}`,
    'info',
  )
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
            startIndex: i, // Continue numbering from current index
          },
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
            addLog(
              `✓ ${url}: ${result.filename} (${formatSize(result.size || 0)})`,
              'success',
            )
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
          error: errMsg,
        } as ScreenshotResult)
      }
    }

    addLog(
      `${successCount}/${urlCount} successful`,
      failCount > 0 ? 'error' : 'success',
    )
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
        query: { path: result.path, base64: true },
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
  get: () =>
    viewportPresets.findIndex(
      (p) =>
        p.width === viewport.value.width && p.height === viewport.value.height,
    ),
  set: (index: number) => {
    const preset = viewportPresets[index]
    if (preset) {
      viewport.value = { width: preset.width, height: preset.height }
    }
  },
})

defineExpose({ isRunning: isLoading })
</script>

<template>
  <div class="screenshots-container">
    <!-- Left: Input Section -->
    <div class="input-section">
      <h2><Camera :size="18" /> Screenshots & PDF</h2>
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
        <label>Format <span class="help-icon" data-tooltip="PNG (lossless), JPG (smaller file size), or PDF (A4 document)">?</span></label>
        <select v-model="format" :disabled="isLoading">
          <option value="png">PNG (lossless)</option>
          <option value="jpg">JPG (compressed)</option>
          <option value="pdf">PDF (document)</option>
        </select>
      </div>

      <div class="option">
        <label>Viewport <span class="help-icon" data-tooltip="Screen resolution to simulate — affects layout and responsive design">?</span></label>
        <select v-model="selectedPresetIndex" :disabled="isLoading">
          <option v-for="(preset, index) in viewportPresets" :key="preset.label" :value="index">
            {{ preset.label }}
          </option>
        </select>
      </div>

      <div v-if="format !== 'pdf'" class="option checkbox">
        <label title="Capture the entire scrollable page, not just the visible viewport">
          <input type="checkbox" v-model="fullPage" :disabled="isLoading">
          Full page (scroll height) <span class="help-icon">?</span>
        </label>
      </div>

      <div v-if="format === 'jpg'" class="option">
        <label title="JPG compression level — lower means smaller file but less detail">Quality: {{ quality }}% <span class="help-icon">?</span></label>
        <input type="range" v-model.number="quality" min="10" max="100" step="5" :disabled="isLoading">
      </div>

      <div class="button-row">
        <button
          class="btn-primary"
          @click="takeScreenshots"
          :disabled="parsedUrls.length === 0 || isLoading"
        >
          <template v-if="isLoading"><Loader :size="14" class="spin" /> Creating...</template>
          <template v-else><Camera :size="14" /> Create</template>
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
              <span class="result-status"><Check v-if="result.success" :size="16" /><X v-else :size="16" /></span>
              <div class="result-info">
                <div class="result-url">{{ result.url }}</div>
                <div v-if="result.success" class="result-meta">
                  {{ result.filename }} • {{ formatSize(result.size || 0) }}
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
              <span class="detail-size">{{ formatSize(selectedResult.size || 0) }}</span>
            </div>
            <div class="detail-url">{{ selectedResult.url }}</div>

            <!-- Image Preview -->
            <div v-if="previewUrl" class="preview-image">
              <img :src="previewUrl" :alt="selectedResult.filename">
            </div>
            <div v-else-if="format === 'pdf'" class="preview-placeholder">
              <span class="preview-icon"><FileText :size="48" /></span>
              <p>PDF preview not available</p>
              <p class="hint">Click "Open" to view in Finder</p>
            </div>
            <div v-else class="preview-placeholder">
              <span class="preview-icon"><Image :size="48" /></span>
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

.option label {
  display: block;
  font-size: 13px;
  color: var(--text-secondary);
  margin-bottom: 4px;
}

.option select,
.option input[type="range"] {
  width: 100%;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-secondary);
  color: var(--text-primary);
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
  background: var(--accent);
  border: none;
  border-radius: 4px;
  color: var(--text-primary);
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
  padding: 12px 16px;
  background: var(--error);
  border: none;
  border-radius: 4px;
  color: var(--text-primary);
  font-weight: 600;
  cursor: pointer;
}

.btn-stop:hover {
  background: var(--error);
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

.results-area {
  display: grid;
  grid-template-columns: 320px 1fr;
  height: 100%;
  overflow: hidden;
}

.results-list {
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.results-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
}

.results-header h3 {
  font-size: 14px;
  color: var(--text-primary);
  margin: 0;
}

.btn-folder {
  padding: 6px 12px;
  background: var(--bg-tertiary);
  border: none;
  border-radius: 4px;
  color: var(--text-primary);
  cursor: pointer;
  font-size: 12px;
}

.btn-folder:hover {
  background: var(--bg-tertiary);
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
  border-bottom: 1px solid var(--bg-secondary);
  cursor: pointer;
  border-left: 3px solid transparent;
}

.result-item:hover {
  background: var(--bg-secondary);
}

.result-item.active {
  background: color-mix(in srgb, var(--accent) 13%, transparent);
  border-left-color: var(--accent);
}

.result-item.success .result-status {
  color: var(--success);
}

.result-item.failed .result-status {
  color: var(--error);
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
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.result-meta {
  font-size: 11px;
  color: var(--text-secondary);
  margin-top: 2px;
}

.result-error {
  font-size: 11px;
  color: var(--error);
  margin-top: 2px;
}

/* Detail Panel */
.detail-panel {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg-primary);
}

.detail-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-muted);
}

.detail-error {
  padding: 24px;
}

.detail-error h3 {
  font-size: 14px;
  color: var(--text-primary);
  margin-bottom: 8px;
  word-break: break-all;
}

.detail-error .error-text {
  color: var(--error);
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
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
}

.detail-header h3 {
  font-size: 14px;
  color: var(--text-primary);
  margin: 0;
}

.detail-size {
  font-size: 12px;
  color: var(--text-secondary);
}

.detail-url {
  padding: 8px 16px;
  font-size: 12px;
  color: var(--text-secondary);
  background: var(--bg-primary);
  border-bottom: 1px solid var(--border);
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
  color: var(--text-muted);
}

.preview-icon {
  font-size: 48px;
  margin-bottom: 12px;
}

.preview-placeholder .hint {
  font-size: 12px;
  margin-top: 4px;
}

.spin { animation: spin 1s linear infinite; }
@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
</style>
