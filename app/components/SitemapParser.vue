<script setup lang="ts">
interface SitemapEntry {
  loc: string
  lastmod?: string
  changefreq?: string
  priority?: string
  source: string
}

interface ParseSitemapResponse {
  urls: SitemapEntry[]
  stats: {
    total: number
    sitemaps: number
  }
}

const urlInput = ref('')
const { addLog, clearLogs, setRunning } = useTabLogger('sitemap')
const recursive = ref(false)
const isLoading = ref(false)
const entries = ref<SitemapEntry[]>([])
const error = ref<string | null>(null)
const stats = ref<{ total: number; sitemaps: number } | null>(null)
const copied = ref(false)

// Validate the single URL input
const isValidUrl = computed(() => {
  const trimmed = urlInput.value.trim()
  if (!trimmed) return false
  try {
    new URL(trimmed)
    return true
  } catch {
    return false
  }
})

async function _parseSitemap() {
  const url = urlInput.value.trim()
  if (!url || !isValidUrl.value) return

  isLoading.value = true
  setRunning(true)
  error.value = null
  entries.value = []
  stats.value = null
  clearLogs()
  copied.value = false

  addLog(`Fetching sitemap: ${url}`, 'info')
  if (recursive.value) {
    addLog('Recursive mode enabled (following sitemap index files)', 'info')
  }

  try {
    const response = await $fetch<ParseSitemapResponse>('/api/parse-sitemap', {
      method: 'POST',
      body: {
        url,
        recursive: recursive.value,
      },
    })

    entries.value = response.urls
    stats.value = response.stats

    addLog(
      `Found ${response.stats.total} URL(s) across ${response.stats.sitemaps} sitemap(s)`,
      'success',
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed to parse sitemap'
    error.value = msg
    addLog(msg, 'error')
  } finally {
    isLoading.value = false
    setRunning(false)
  }
}

async function _copyUrls() {
  if (entries.value.length === 0) return

  const text = entries.value.map((e) => e.loc).join('\n')
  try {
    await navigator.clipboard.writeText(text)
    copied.value = true
    addLog(`Copied ${entries.value.length} URL(s) to clipboard`, 'success')
    setTimeout(() => {
      copied.value = false
    }, 2000)
  } catch {
    addLog('Failed to copy to clipboard', 'error')
  }
}

defineExpose({ isRunning: isLoading })
</script>

<template>
  <div class="sitemap-container">
    <!-- Left: Input Section -->
    <div class="input-section">
      <h2><Map :size="18" /> Sitemap Parser</h2>
      <p class="subtitle">Parse XML sitemaps and extract URLs</p>

      <div class="url-input">
        <label>Sitemap URL</label>
        <input
          v-model="urlInput"
          type="text"
          placeholder="https://example.com/sitemap.xml"
          :disabled="isLoading"
          @keydown.enter="parseSitemap"
        />
      </div>

      <div class="option checkbox">
        <label>
          <input type="checkbox" v-model="recursive" :disabled="isLoading">
          Follow sitemap index files <HelpTooltip text="Recursively follow linked sitemaps in sitemap index files" />
        </label>
      </div>

      <div class="button-row">
        <button class="btn-primary" @click="parseSitemap" :disabled="!isValidUrl || isLoading">
          <template v-if="isLoading"><Loader :size="14" class="spin" /> Parsing...</template>
          <template v-else><Map :size="14" /> Parse</template>
        </button>
      </div>

      <div v-if="error" class="error-message">
        {{ error }}
      </div>
    </div>

    <!-- Right: Results Section -->
    <div class="results-section">

      <div v-if="entries.length > 0" class="results-area">
        <!-- Stats Bar -->
        <div class="stats-bar">
          <div class="stats-info">
            <span class="stats-total">{{ stats?.total }} URL(s)</span>
            <span class="stats-sitemaps">from {{ stats?.sitemaps }} sitemap(s)</span>
          </div>
          <button class="btn-copy" @click="copyUrls">
            <template v-if="copied"><Check :size="14" /> Copied</template>
            <template v-else><Copy :size="14" /> Copy URLs</template>
          </button>
        </div>

        <!-- Results Table -->
        <div class="results-table">
          <div class="table-header">
            <span class="col-loc">URL</span>
            <span class="col-lastmod">Last Modified</span>
            <span class="col-changefreq">Frequency</span>
            <span class="col-priority">Priority</span>
          </div>
          <div class="table-body">
            <div
              v-for="(entry, index) in entries"
              :key="index"
              class="table-row"
            >
              <span class="col-loc">
                <a :href="entry.loc" target="_blank" rel="noopener noreferrer">{{ entry.loc }}</a>
              </span>
              <span class="col-lastmod">{{ entry.lastmod || '-' }}</span>
              <span class="col-changefreq">{{ entry.changefreq || '-' }}</span>
              <span class="col-priority">{{ entry.priority || '-' }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Empty state -->
      <div v-else class="empty-state">
        <p>No results yet</p>
        <p class="hint">Enter a sitemap URL and click "Parse" to extract URLs</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sitemap-container {
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

.url-input input {
  width: 100%;
  padding: 12px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text-primary);
  font-family: 'SF Mono', Monaco, monospace;
  font-size: 12px;
}

.url-input input:focus {
  outline: none;
  border-color: var(--accent);
}

.option.checkbox label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text-secondary);
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

.log-container {
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: 4px;
  max-height: 120px;
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
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

/* Stats Bar */
.stats-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.stats-info {
  display: flex;
  gap: 12px;
  align-items: center;
}

.stats-total {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.stats-sitemaps {
  font-size: 12px;
  color: var(--text-secondary);
}

.btn-copy {
  padding: 8px 14px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text-primary);
  font-size: 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
}

.btn-copy:hover {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

/* Results Table */
.results-table {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.table-header {
  display: grid;
  grid-template-columns: 1fr 150px 100px 80px;
  gap: 8px;
  padding: 8px 16px;
  background: var(--bg-primary);
  font-size: 11px;
  color: var(--text-secondary);
  font-weight: 600;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.table-body {
  flex: 1;
  overflow-y: auto;
}

.table-row {
  display: grid;
  grid-template-columns: 1fr 150px 100px 80px;
  gap: 8px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border);
  font-size: 12px;
  transition: background 0.2s;
}

.table-row:hover {
  background: var(--bg-tertiary);
}

.table-row:last-child {
  border-bottom: none;
}

.col-loc {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.col-loc a {
  color: var(--text-primary);
  text-decoration: none;
}

.col-loc a:hover {
  color: var(--accent);
  text-decoration: underline;
}

.col-lastmod {
  color: var(--text-secondary);
  font-size: 11px;
}

.col-changefreq {
  color: var(--text-secondary);
  text-transform: capitalize;
}

.col-priority {
  color: var(--text-secondary);
  text-align: center;
}

.spin { animation: spin 1s linear infinite; }
@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
</style>
