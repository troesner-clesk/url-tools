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

// Spalte kopieren
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
}

// Statistiken für Links
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
      <span v-if="linkStats.errors" class="stat status-error">Fehler: {{ linkStats.errors }}</span>
      <span class="stat-divider">|</span>
      <span class="stat type-internal">Intern: {{ linkStats.internal }}</span>
      <span class="stat type-external">Extern: {{ linkStats.external }}</span>
    </div>

    <!-- HTML Ergebnisse -->
    <template v-if="mode === 'html' && htmlResults?.length">
      <table>
        <thead>
          <tr>
            <th @click="copyColumn('url')" class="th-copy" title="Spalte kopieren">URL ⧉</th>
            <th @click="copyColumn('status')" class="th-copy" title="Spalte kopieren">Status ⧉</th>
            <th @click="copyColumn('contentType')" class="th-copy" title="Spalte kopieren">Content-Type ⧉</th>
            <th @click="copyColumn('size')" class="th-copy" title="Spalte kopieren">Größe ⧉</th>
            <th>HTML</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="result in htmlResults" :key="result.url">
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
                {{ expandedHtml === result.url ? 'Schließen' : 'Anzeigen' }}
              </button>
              <button 
                v-if="!result.error"
                class="btn-small"
                @click="copyHtml(result.html)"
              >
                Kopieren
              </button>
              <span v-if="result.error" class="error-text">{{ result.error }}</span>
            </td>
          </tr>
          <!-- Expandierter HTML-View -->
          <tr v-if="expandedHtml">
            <td colspan="5">
              <pre class="html-preview">{{ htmlResults?.find(r => r.url === expandedHtml)?.html }}</pre>
            </td>
          </tr>
        </tbody>
      </table>
    </template>

    <!-- Link Ergebnisse -->
    <template v-if="mode === 'links' && linkResults?.length">
      <table>
        <thead>
          <tr>
            <th @click="copyColumn('sourceUrl')" class="th-copy" title="Spalte kopieren">Source ⧉</th>
            <th @click="copyColumn('targetUrl')" class="th-copy" title="Spalte kopieren">Target ⧉</th>
            <th @click="copyColumn('status')" class="th-copy" title="Spalte kopieren">Status ⧉</th>
            <th @click="copyColumn('redirectChain')" class="th-copy" title="Spalte kopieren">Redirects ⧉</th>
            <th @click="copyColumn('type')" class="th-copy" title="Spalte kopieren">Typ ⧉</th>
            <th @click="copyColumn('anchorText')" class="th-copy" title="Spalte kopieren">Anchor ⧉</th>
            <th @click="copyColumn('rel')" class="th-copy" title="Spalte kopieren">Rel ⧉</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(result, index) in linkResults" :key="index">
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

    <!-- Keine Ergebnisse -->
    <div v-if="(!htmlResults?.length && mode === 'html') || (!linkResults?.length && mode === 'links')" class="no-results">
      Noch keine Ergebnisse. Gib URLs ein und klicke auf "Go".
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
</style>
