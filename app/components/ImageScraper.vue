<script setup lang="ts">
import { AlertTriangle, Check, Image, Loader } from 'lucide-vue-next'

interface LogEntry {
  timestamp: string
  message: string
  type: 'info' | 'success' | 'error' | 'progress'
}

interface ImageResult {
  src: string
  alt: string
  width?: number
  height?: number
  size?: number
  filename?: string
  localPath?: string
  error?: string
}

interface ScrapeResult {
  sourceUrl: string
  images: ImageResult[]
  total: number
  downloaded: number
  error?: string
}

interface ApiResponse {
  results: ScrapeResult[]
  outputDir: string | null
  stats: {
    pages: number
    totalImages: number
    downloaded: number
  }
}

const urlInput = ref('')
const download = ref(true)
const subfolderPerUrl = ref(false)
const minWidth = ref(0)
const minHeight = ref(0)
const selectedFormats = ref<string[]>([])
const formatOptions = ['jpg', 'png', 'gif', 'webp', 'svg']

const isLoading = ref(false)
const isCancelled = ref(false)
const results = ref<ScrapeResult[]>([])
const selectedPageIndex = ref<number | null>(null)
const selectedImage = ref<ImageResult | null>(null)
const outputDir = ref<string | null>(null)
const error = ref<string | null>(null)
const logs = ref<LogEntry[]>([])
const logContainer = ref<HTMLElement | null>(null)
const previewUrl = ref<string | null>(null)
const stats = ref<ApiResponse['stats'] | null>(null)

function addLog(message: string, type: LogEntry['type'] = 'info') {
  const now = new Date()
  const timestamp = now.toLocaleTimeString('en-US')
  logs.value.push({ timestamp, message, type })
  if (logs.value.length > 100) {
    logs.value.shift()
  }
}

watch(
  logs,
  () => {
    nextTick(() => {
      if (logContainer.value) {
        logContainer.value.scrollTop = logContainer.value.scrollHeight
      }
    })
  },
  { deep: true },
)

const parsedUrls = computed(() => {
  return urlInput.value
    .split(/[\n,]+/)
    .map((u) => u.trim())
    .filter((u) => {
      try {
        new URL(u)
        return true
      } catch {
        return false
      }
    })
})

function stopScraping() {
  isCancelled.value = true
  addLog('Stopping...', 'info')
}

async function scrapeImages() {
  if (parsedUrls.value.length === 0) return

  isLoading.value = true
  isCancelled.value = false
  error.value = null
  results.value = []
  selectedPageIndex.value = null
  selectedImage.value = null
  outputDir.value = null
  logs.value = []
  previewUrl.value = null
  stats.value = null

  const urlCount = parsedUrls.value.length
  addLog(`Starting image scraping for ${urlCount} URL(s)`, 'info')
  if (download.value) {
    addLog('Download mode enabled', 'info')
  }
  if (selectedFormats.value.length > 0) {
    addLog(`Filtering: ${selectedFormats.value.join(', ')}`, 'info')
  }

  try {
    for (let i = 0; i < parsedUrls.value.length; i++) {
      if (isCancelled.value) {
        addLog('Cancelled', 'error')
        break
      }

      const url = parsedUrls.value[i]
      if (!url) continue

      addLog(`[${i + 1}/${urlCount}] Scanning ${url}...`, 'progress')

      try {
        const currentOutputDir: string | null = outputDir.value
        const response: ApiResponse = await $fetch('/api/scrape-images', {
          method: 'POST',
          body: {
            urls: [url],
            download: download.value,
            minWidth: minWidth.value > 0 ? minWidth.value : undefined,
            minHeight: minHeight.value > 0 ? minHeight.value : undefined,
            formats:
              selectedFormats.value.length > 0
                ? selectedFormats.value
                : undefined,
            outputDir: currentOutputDir || undefined, // Reuse same folder for all URLs
            subfolderPerUrl: subfolderPerUrl.value,
          },
        })

        // Store the output dir from first response to reuse for subsequent URLs
        if (!outputDir.value && response.outputDir) {
          outputDir.value = response.outputDir
        }

        const result = response.results[0]
        if (result) {
          results.value.push(result)

          if (result.error) {
            addLog(`✗ ${url}: ${result.error}`, 'error')
          } else {
            const downloadInfo = download.value
              ? `, ${result.downloaded} downloaded`
              : ''
            addLog(
              `✓ ${url}: ${result.total} images found${downloadInfo}`,
              'success',
            )

            // Auto-select first page
            if (selectedPageIndex.value === null) {
              selectPage(0)
            }
          }
        }
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : 'Unknown error'
        addLog(`✗ ${url}: ${errMsg}`, 'error')
        results.value.push({
          sourceUrl: url,
          images: [],
          total: 0,
          downloaded: 0,
          error: errMsg,
        })
      }
    }

    // Calculate stats
    stats.value = {
      pages: results.value.length,
      totalImages: results.value.reduce((sum, r) => sum + r.total, 0),
      downloaded: results.value.reduce((sum, r) => sum + r.downloaded, 0),
    }

    if (!isCancelled.value) {
      addLog(`Done! ${stats.value.totalImages} images found`, 'success')
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Scraping error'
    error.value = msg
    addLog(`✗ ${msg}`, 'error')
  } finally {
    isLoading.value = false
  }
}

function selectPage(index: number) {
  selectedPageIndex.value = index
  selectedImage.value = null
  previewUrl.value = null

  // Auto-select first image
  const page = results.value[index]
  const firstImage = page?.images[0]
  if (page && firstImage) {
    selectImage(firstImage)
  }
}

async function selectImage(image: ImageResult) {
  selectedImage.value = image
  previewUrl.value = null

  // If downloaded locally, load from file
  if (image.localPath) {
    try {
      const response = await $fetch<{ content: string }>('/api/read-file', {
        query: { path: image.localPath, base64: true },
      })
      if (response.content) {
        const ext = image.filename?.split('.').pop()?.toLowerCase() || 'jpg'
        const mimeTypes: Record<string, string> = {
          jpg: 'image/jpeg',
          jpeg: 'image/jpeg',
          png: 'image/png',
          gif: 'image/gif',
          webp: 'image/webp',
          svg: 'image/svg+xml',
        }
        const mimeType = mimeTypes[ext] || 'image/jpeg'
        previewUrl.value = `data:${mimeType};base64,${response.content}`
      }
    } catch {
      // Fall back to remote URL
      previewUrl.value = image.src
    }
  } else {
    // Use remote URL directly
    previewUrl.value = image.src
  }
}

const { formatSize } = useFormatters()

const selectedPage = computed(() => {
  if (selectedPageIndex.value === null) return null
  return results.value[selectedPageIndex.value] || null
})

defineExpose({ isRunning: isLoading })
</script>

<template>
  <div class="image-scraper-container">
    <!-- Left: Input Section -->
    <div class="input-section">
      <h2><Image :size="18" /> Image Scraper</h2>
      <p class="subtitle">Extract and download images from web pages</p>

      <div class="url-input">
        <label>URLs (one per line)</label>
        <textarea
          v-model="urlInput"
          placeholder="https://example.com&#10;https://another-site.com"
          :disabled="isLoading"
        ></textarea>
        <div class="url-count">{{ parsedUrls.length }} URL{{ parsedUrls.length !== 1 ? 's' : '' }}</div>
      </div>

      <div class="option checkbox">
        <label>
          <input type="checkbox" v-model="download" :disabled="isLoading">
          Download images to disk
        </label>
      </div>

      <div v-if="download" class="option checkbox">
        <label>
          <input type="checkbox" v-model="subfolderPerUrl" :disabled="isLoading">
          Create subfolder per URL
        </label>
      </div>

      <div class="option">
        <label>Filter by format</label>
        <div class="format-checkboxes">
          <label v-for="fmt in formatOptions" :key="fmt" class="format-checkbox">
            <input
              type="checkbox"
              :value="fmt"
              v-model="selectedFormats"
              :disabled="isLoading"
            >
            {{ fmt.toUpperCase() }}
          </label>
        </div>
      </div>

      <div class="size-filters">
        <div class="option">
          <label>
            Min width <HelpTooltip text="Skip images smaller than this width (in pixels). Only works if the HTML specifies image dimensions." />
          </label>
          <input
            type="number"
            v-model.number="minWidth"
            placeholder="0"
            min="0"
            :disabled="isLoading"
          >
        </div>
        <div class="option">
          <label>
            Min height <HelpTooltip text="Skip images smaller than this height (in pixels). Only works if the HTML specifies image dimensions." />
          </label>
          <input
            type="number"
            v-model.number="minHeight"
            placeholder="0"
            min="0"
            :disabled="isLoading"
          >
        </div>
      </div>

      <div class="button-row">
        <button
          class="btn-primary"
          @click="scrapeImages"
          :disabled="parsedUrls.length === 0 || isLoading"
        >
          <template v-if="isLoading"><Loader :size="14" class="spin" /> Scanning...</template>
          <template v-else><Image :size="14" /> Scrape Images</template>
        </button>
        <button v-if="isLoading" class="btn-stop" @click="stopScraping">
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
        <p class="hint">Enter URLs and click "Scrape Images" to find images</p>
      </div>

      <div v-else class="results-area">
        <!-- Left: Pages + Images List -->
        <div class="results-list">
          <div class="results-header">
            <h3>Results</h3>
            <div v-if="stats" class="stats-summary">
              {{ stats.totalImages }} images{{ download ? `, ${stats.downloaded} downloaded` : '' }}
            </div>
          </div>

          <!-- Page List -->
          <div class="pages-list">
            <div
              v-for="(page, index) in results"
              :key="page.sourceUrl"
              :class="['page-item', { active: selectedPageIndex === index, error: page.error }]"
              @click="selectPage(index)"
            >
              <div class="page-url">{{ page.sourceUrl }}</div>
              <div class="page-meta">
                <span v-if="page.error" class="error-text">{{ page.error }}</span>
                <span v-else>{{ page.total }} images{{ page.downloaded ? `, ${page.downloaded} saved` : '' }}</span>
              </div>
            </div>
          </div>

          <!-- Images Grid for Selected Page -->
          <div v-if="selectedPage && selectedPage.images.length > 0" class="images-grid-container">
            <div class="images-header">
              <RecentJobsMenu tool-type="all" />
            </div>
            <div class="images-grid">
              <div
                v-for="(image, idx) in selectedPage.images"
                :key="idx"
                :class="['image-thumb', { active: selectedImage?.src === image.src, error: image.error }]"
                @click="selectImage(image)"
              >
                <img
                  v-if="!image.error"
                  :src="image.src || ''"
                  :alt="image.alt || ''"
                  loading="lazy"
                  @error="($event.target as HTMLImageElement).style.display = 'none'"
                >
                <span v-if="image.error" class="thumb-error">!</span>
                <span v-if="image.filename" class="thumb-check"><Check :size="10" /></span>
              </div>
            </div>
          </div>
        </div>

        <!-- Right: Image Detail Panel -->
        <div class="detail-panel">
          <div v-if="!selectedImage" class="detail-empty">
            <p>Select an image to preview</p>
          </div>

          <div v-else class="detail-content">
            <div class="detail-header">
              <h3>{{ selectedImage.filename || 'Preview' }}</h3>
              <span v-if="selectedImage.size" class="detail-size">{{ formatSize(selectedImage.size) }}</span>
            </div>

            <div class="detail-meta">
              <span v-if="selectedImage.width && selectedImage.height">
                {{ selectedImage.width }} × {{ selectedImage.height }}
              </span>
              <span v-if="selectedImage.alt" class="detail-alt" :title="selectedImage.alt">
                Alt: {{ selectedImage.alt }}
              </span>
            </div>

            <div class="detail-url">{{ selectedImage.src }}</div>

            <!-- Image Preview -->
            <div v-if="previewUrl" class="preview-image">
              <img :src="previewUrl || ''" :alt="selectedImage.alt || ''">
            </div>
            <div v-else-if="selectedImage.error" class="preview-error">
              <span class="preview-icon"><AlertTriangle :size="48" /></span>
              <p>{{ selectedImage.error }}</p>
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
.image-scraper-container {
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

.option.checkbox label {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.option input[type="number"] {
  width: 100%;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-secondary);
  color: var(--text-primary);
}

.format-checkboxes {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.format-checkbox {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--text-secondary);
  cursor: pointer;
}

.size-filters {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.size-filters label {
  cursor: help;
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

.stats-summary {
  font-size: 12px;
  color: var(--text-secondary);
}

.pages-list {
  max-height: 200px;
  overflow-y: auto;
  border-bottom: 1px solid var(--border);
}

.page-item {
  padding: 10px 16px;
  border-bottom: 1px solid var(--bg-secondary);
  cursor: pointer;
}

.page-item:hover {
  background: var(--bg-secondary);
}

.page-item.active {
  background: color-mix(in srgb, var(--accent) 13%, transparent);
  border-left: 3px solid var(--accent);
}

.page-item.error {
  border-left: 3px solid var(--error);
}

.page-url {
  font-size: 12px;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.page-meta {
  font-size: 11px;
  color: var(--text-secondary);
  margin-top: 2px;
}

.page-meta .error-text {
  color: var(--error);
}

.images-grid-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.images-header {
  display: flex;
  justify-content: flex-end;
  padding: 8px 12px;
  background: var(--bg-primary);
  border-bottom: 1px solid var(--border);
}

.images-grid {
  flex: 1;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 4px;
  padding: 8px;
  overflow-y: auto;
  align-content: start;
}

.image-thumb {
  aspect-ratio: 1;
  background: var(--bg-secondary);
  border-radius: 4px;
  overflow: hidden;
  cursor: pointer;
  position: relative;
  border: 2px solid transparent;
}

.image-thumb:hover {
  border-color: var(--bg-tertiary);
}

.image-thumb.active {
  border-color: var(--accent);
}

.image-thumb.error {
  background: var(--error-bg);
}

.image-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.thumb-error {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--error);
  font-size: 16px;
}

.thumb-check {
  position: absolute;
  bottom: 2px;
  right: 2px;
  width: 14px;
  height: 14px;
  background: var(--success);
  border-radius: 50%;
  font-size: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-primary);
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
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.detail-size {
  font-size: 12px;
  color: var(--text-secondary);
  flex-shrink: 0;
}

.detail-meta {
  display: flex;
  gap: 12px;
  padding: 8px 16px;
  font-size: 12px;
  color: var(--text-secondary);
  background: var(--bg-primary);
  border-bottom: 1px solid var(--border);
}

.detail-alt {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.detail-url {
  padding: 8px 16px;
  font-size: 11px;
  color: var(--text-muted);
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

.preview-placeholder,
.preview-error {
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

.preview-error {
  color: var(--error);
}

.spin { animation: spin 1s linear infinite; }
@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
</style>
