<script setup lang="ts">
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

interface Props {
  mode: 'html' | 'links'
  htmlResults?: HtmlResult[]
  linkResults?: LinkResult[]
}

const props = defineProps<Props>()

const expandedHtml = ref<string | null>(null)
const copiedColumn = ref<string | null>(null)
const selectedRows = ref<Set<number>>(new Set())
const showCopiedFeedback = ref(false)

// Select all toggle
const allSelected = computed(() => {
  const total = props.mode === 'html' ? props.htmlResults?.length : props.linkResults?.length
  return total && total > 0 && selectedRows.value.size === total
})

function toggleSelectAll() {
  const total = props.mode === 'html' ? props.htmlResults?.length : props.linkResults?.length
  if (!total) return

  if (allSelected.value) {
    selectedRows.value.clear()
  } else {
    selectedRows.value = new Set(Array.from({ length: total }, (_, i) => i))
  }
}

function toggleRow(index: number) {
  if (selectedRows.value.has(index)) {
    selectedRows.value.delete(index)
  } else {
    selectedRows.value.add(index)
  }
  // Trigger reactivity
  selectedRows.value = new Set(selectedRows.value)
}

// Copy selected rows as TSV (tab-separated)
function copySelectedRows() {
  if (selectedRows.value.size === 0) return

  let rows: string[] = []

  if (props.mode === 'html' && props.htmlResults) {
    // Header
    rows.push(['URL', 'Status', 'Content-Type', 'Size'].join('\t'))
    // Data
    for (const idx of Array.from(selectedRows.value).sort((a, b) => a - b)) {
      const r = props.htmlResults[idx]
      if (r) {
        rows.push([r.url, String(r.status), r.contentType, formatSize(r.size)].join('\t'))
      }
    }
  } else if (props.mode === 'links' && props.linkResults) {
    // Header
    rows.push(['Source', 'Target', 'Status', 'Redirects', 'Type', 'Anchor', 'Rel'].join('\t'))
    // Data
    for (const idx of Array.from(selectedRows.value).sort((a, b) => a - b)) {
      const r = props.linkResults[idx]
      if (r) {
        rows.push([r.sourceUrl, r.targetUrl, String(r.status), r.redirectChain || '', r.type, r.anchorText || '', r.rel || ''].join('\t'))
      }
    }
  }

  navigator.clipboard.writeText(rows.join('\n'))
  showCopiedFeedback.value = true
  setTimeout(() => { showCopiedFeedback.value = false }, 1500)
}

// Clear selection when results change
watch(() => [props.htmlResults, props.linkResults], () => {
  selectedRows.value.clear()
})

function getStatusClass(status: number): string {
  if (status >= 200 && status < 300) return 'status-ok'
  if (status >= 300 && status < 400) return 'status-redirect'
  return 'status-error'
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function copyHtml(html: string) {
  navigator.clipboard.writeText(html)
}

// Copy column with visual feedback
function copyColumn(columnName: string) {
  let values: string[] = []

  if (props.mode === 'html' && props.htmlResults) {
    switch (columnName) {
      case 'url': values = props.htmlResults.map(r => r.url); break
      case 'status': values = props.htmlResults.map(r => String(r.status)); break
      case 'contentType': values = props.htmlResults.map(r => r.contentType); break
      case 'size': values = props.htmlResults.map(r => formatSize(r.size)); break
    }
  } else if (props.mode === 'links' && props.linkResults) {
    switch (columnName) {
      case 'sourceUrl': values = props.linkResults.map(r => r.sourceUrl); break
      case 'targetUrl': values = props.linkResults.map(r => r.targetUrl); break
      case 'status': values = props.linkResults.map(r => String(r.status)); break
      case 'redirectChain': values = props.linkResults.map(r => r.redirectChain || ''); break
      case 'type': values = props.linkResults.map(r => r.type); break
      case 'anchorText': values = props.linkResults.map(r => r.anchorText || ''); break
      case 'rel': values = props.linkResults.map(r => r.rel || ''); break
    }
  }

  navigator.clipboard.writeText(values.join('\n'))

  // Show visual feedback
  copiedColumn.value = columnName
  setTimeout(() => {
    copiedColumn.value = null
  }, 1500)
}

// Statistics for links
const linkStats = computed(() => {
  if (!props.linkResults?.length) return null

  const total = props.linkResults.length
  const status200 = props.linkResults.filter(r => r.status >= 200 && r.status < 300).length
  const status3xx = props.linkResults.filter(r => r.status >= 300 && r.status < 400).length
  const status4xx = props.linkResults.filter(r => r.status >= 400 && r.status < 500).length
  const status5xx = props.linkResults.filter(r => r.status >= 500).length
  const errors = props.linkResults.filter(r => r.status === 0).length
  const internal = props.linkResults.filter(r => r.type === 'internal').length
  const external = props.linkResults.filter(r => r.type === 'external').length

  return { total, status200, status3xx, status4xx, status5xx, errors, internal, external }
})
</script>

<template>
  <div class="results-table">
    <!-- Link Stats -->
    <div v-if="mode === 'links' && linkStats" class="stats-bar">
      <span class="stat">Total: <strong>{{ linkStats.total }}</strong></span>
      <span class="stat status-ok">2xx: {{ linkStats.status200 }}</span>
      <span class="stat status-redirect">3xx: {{ linkStats.status3xx }}</span>
      <span class="stat status-error">4xx: {{ linkStats.status4xx }}</span>
      <span class="stat status-error">5xx: {{ linkStats.status5xx }}</span>
      <span v-if="linkStats.errors" class="stat status-error">Errors: {{ linkStats.errors }}</span>
      <span class="stat-divider">|</span>
      <span class="stat type-internal">Internal: {{ linkStats.internal }}</span>
      <span class="stat type-external">External: {{ linkStats.external }}</span>
    </div>

    <!-- Selection Actions -->
    <div v-if="selectedRows.size > 0" class="selection-bar">
      <span>{{ selectedRows.size }} row(s) selected</span>
      <button class="btn-copy-selection" @click="copySelectedRows">
        {{ showCopiedFeedback ? '✓ Copied!' : '⧉ Copy Selection' }}
      </button>
      <button class="btn-clear-selection" @click="selectedRows.clear()">Clear</button>
    </div>

    <!-- HTML Results -->
    <template v-if="mode === 'html' && htmlResults?.length">
      <table>
        <thead>
          <tr>
            <th class="th-checkbox">
              <input type="checkbox" :checked="allSelected" @change="toggleSelectAll" title="Select all">
            </th>
            <th @click="copyColumn('url')" :class="['th-copy', { copied: copiedColumn === 'url' }]" title="Click to copy column">
              {{ copiedColumn === 'url' ? '✓ Copied!' : 'URL ⧉' }}
            </th>
            <th @click="copyColumn('status')" :class="['th-copy', { copied: copiedColumn === 'status' }]" title="Click to copy column">
              {{ copiedColumn === 'status' ? '✓ Copied!' : 'Status ⧉' }}
            </th>
            <th @click="copyColumn('contentType')" :class="['th-copy', { copied: copiedColumn === 'contentType' }]" title="Click to copy column">
              {{ copiedColumn === 'contentType' ? '✓ Copied!' : 'Content-Type ⧉' }}
            </th>
            <th @click="copyColumn('size')" :class="['th-copy', { copied: copiedColumn === 'size' }]" title="Click to copy column">
              {{ copiedColumn === 'size' ? '✓ Copied!' : 'Size ⧉' }}
            </th>
            <th>HTML</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(result, index) in htmlResults" :key="result.url" :class="{ 'row-selected': selectedRows.has(index) }" @click="toggleRow(index)">
            <td class="td-checkbox" @click.stop>
              <input type="checkbox" :checked="selectedRows.has(index)" @change="toggleRow(index)">
            </td>
            <td class="url-cell" :title="result.url">{{ result.url }}</td>
            <td>
              <span :class="['status-badge', getStatusClass(result.status)]">
                {{ result.status || 'ERR' }}
              </span>
            </td>
            <td>{{ result.contentType }}</td>
            <td>{{ formatSize(result.size) }}</td>
            <td>
              <button
                v-if="!result.error"
                class="btn-small"
                @click="expandedHtml = expandedHtml === result.url ? null : result.url"
              >
                {{ expandedHtml === result.url ? 'Close' : 'View' }}
              </button>
              <button
                v-if="!result.error"
                class="btn-small"
                @click="copyHtml(result.html)"
              >
                Copy
              </button>
              <span v-if="result.error" class="error-text">{{ result.error }}</span>
            </td>
          </tr>
          <!-- Expanded HTML View -->
          <tr v-if="expandedHtml">
            <td colspan="6">
              <pre class="html-preview">{{ htmlResults?.find(r => r.url === expandedHtml)?.html }}</pre>
            </td>
          </tr>
        </tbody>
      </table>
    </template>

    <!-- Link Results -->
    <template v-if="mode === 'links' && linkResults?.length">
      <table>
        <thead>
          <tr>
            <th class="th-checkbox">
              <input type="checkbox" :checked="allSelected" @change="toggleSelectAll" title="Select all">
            </th>
            <th @click="copyColumn('sourceUrl')" :class="['th-copy', { copied: copiedColumn === 'sourceUrl' }]" title="Click to copy column">
              {{ copiedColumn === 'sourceUrl' ? '✓ Copied!' : 'Source ⧉' }}
            </th>
            <th @click="copyColumn('targetUrl')" :class="['th-copy', { copied: copiedColumn === 'targetUrl' }]" title="Click to copy column">
              {{ copiedColumn === 'targetUrl' ? '✓ Copied!' : 'Target ⧉' }}
            </th>
            <th @click="copyColumn('status')" :class="['th-copy', { copied: copiedColumn === 'status' }]" title="Click to copy column">
              {{ copiedColumn === 'status' ? '✓ Copied!' : 'Status ⧉' }}
            </th>
            <th @click="copyColumn('redirectChain')" :class="['th-copy', { copied: copiedColumn === 'redirectChain' }]" title="Click to copy column">
              {{ copiedColumn === 'redirectChain' ? '✓ Copied!' : 'Redirects ⧉' }}
            </th>
            <th @click="copyColumn('type')" :class="['th-copy', { copied: copiedColumn === 'type' }]" title="Click to copy column">
              {{ copiedColumn === 'type' ? '✓ Copied!' : 'Type ⧉' }}
            </th>
            <th @click="copyColumn('anchorText')" :class="['th-copy', { copied: copiedColumn === 'anchorText' }]" title="Click to copy column">
              {{ copiedColumn === 'anchorText' ? '✓ Copied!' : 'Anchor ⧉' }}
            </th>
            <th @click="copyColumn('rel')" :class="['th-copy', { copied: copiedColumn === 'rel' }]" title="Click to copy column">
              {{ copiedColumn === 'rel' ? '✓ Copied!' : 'Rel ⧉' }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(result, index) in linkResults" :key="index" :class="{ 'row-selected': selectedRows.has(index) }" @click="toggleRow(index)">
            <td class="td-checkbox" @click.stop>
              <input type="checkbox" :checked="selectedRows.has(index)" @change="toggleRow(index)">
            </td>
            <td class="url-cell" :title="result.sourceUrl">{{ result.sourceUrl }}</td>
            <td class="url-cell" :title="result.targetUrl">{{ result.targetUrl }}</td>
            <td>
              <span :class="['status-badge', getStatusClass(result.status)]">
                {{ result.status || 'ERR' }}
              </span>
            </td>
            <td class="redirect-cell">{{ result.redirectChain || '-' }}</td>
            <td>
              <span :class="['type-badge', result.type]">
                {{ result.type }}
              </span>
            </td>
            <td class="anchor-cell" :title="result.anchorText">{{ result.anchorText || '-' }}</td>
            <td>{{ result.rel || '-' }}</td>
          </tr>
        </tbody>
      </table>
    </template>

    <!-- No Results -->
    <div v-if="(!htmlResults?.length && mode === 'html') || (!linkResults?.length && mode === 'links')" class="no-results">
      No results yet. Enter URLs and click "Start".
    </div>
  </div>
</template>

<style scoped>
.results-table {
  background: #1a1a1a;
  border: 1px solid #333;
  border-radius: 4px;
  overflow: auto;
}

.stats-bar {
  display: flex;
  gap: 16px;
  padding: 12px 16px;
  background: #0a0a0a;
  border-bottom: 1px solid #333;
  font-size: 12px;
  flex-wrap: wrap;
}

.stat {
  color: #888;
}

.stat strong {
  color: #fff;
}

.stat.status-ok { color: #4ade80; }
.stat.status-redirect { color: #facc15; }
.stat.status-error { color: #f87171; }
.stat.type-internal { color: #38bdf8; }
.stat.type-external { color: #c084fc; }

.stat-divider {
  color: #333;
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

th, td {
  padding: 10px 12px;
  text-align: left;
  border-bottom: 1px solid #333;
}

th {
  background: #0a0a0a;
  color: #888;
  font-weight: 500;
  text-transform: uppercase;
  font-size: 11px;
  letter-spacing: 0.5px;
  position: sticky;
  top: 0;
}

.th-copy {
  cursor: pointer;
  user-select: none;
}

.th-copy:hover {
  color: #0066cc;
  background: #1a1a2a;
}

.th-copy.copied {
  color: #4ade80;
  background: #1a4d1a;
}

.url-cell {
  font-family: 'SF Mono', Monaco, monospace;
  font-size: 12px;
  max-width: 300px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.redirect-cell {
  font-family: 'SF Mono', Monaco, monospace;
  font-size: 12px;
}

.anchor-cell {
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.status-badge {
  display: inline-block;
  padding: 2px 6px;
  border-radius: 3px;
  font-weight: 500;
  font-size: 12px;
}

.status-ok {
  background: #1a4d1a;
  color: #4ade80;
}

.status-redirect {
  background: #4d4d1a;
  color: #facc15;
}

.status-error {
  background: #4d1a1a;
  color: #f87171;
}

.type-badge {
  display: inline-block;
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 11px;
}

.type-badge.internal {
  background: #1a3d4d;
  color: #38bdf8;
}

.type-badge.external {
  background: #3d1a4d;
  color: #c084fc;
}

.btn-small {
  padding: 4px 8px;
  background: #333;
  border: none;
  border-radius: 3px;
  color: #fff;
  cursor: pointer;
  font-size: 11px;
  margin-right: 4px;
}

.btn-small:hover {
  background: #444;
}

.error-text {
  color: #f87171;
  font-size: 12px;
}

.html-preview {
  background: #0a0a0a;
  padding: 12px;
  font-size: 11px;
  max-height: 400px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
}

.no-results {
  padding: 40px;
  text-align: center;
  color: #666;
}

/* Selection */
.selection-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
  background: #1a2a4d;
  border-bottom: 1px solid #333;
  font-size: 13px;
  color: #38bdf8;
}

.btn-copy-selection {
  padding: 4px 12px;
  background: #0066cc;
  border: none;
  border-radius: 3px;
  color: #fff;
  cursor: pointer;
  font-size: 12px;
}

.btn-copy-selection:hover {
  background: #0077ee;
}

.btn-clear-selection {
  padding: 4px 8px;
  background: transparent;
  border: 1px solid #444;
  border-radius: 3px;
  color: #888;
  cursor: pointer;
  font-size: 12px;
}

.btn-clear-selection:hover {
  background: #333;
  color: #fff;
}

.th-checkbox,
.td-checkbox {
  width: 40px;
  text-align: center;
  padding: 10px 8px;
}

.th-checkbox input,
.td-checkbox input {
  cursor: pointer;
  width: 16px;
  height: 16px;
}

tr.row-selected {
  background: #1a2a3d;
}

tr.row-selected:hover {
  background: #1a3a4d;
}

tbody tr {
  cursor: pointer;
}

tbody tr:hover {
  background: #222;
}
</style>
