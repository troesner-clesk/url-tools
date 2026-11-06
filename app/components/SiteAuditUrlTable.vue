<script setup lang="ts">
import { ChevronLeft, ChevronRight, Loader } from '@lucide/vue'
import {
  apiErrorMessage,
  crawlStateLabel,
  formatNumber,
  URL_FILTER_OPTIONS,
  type UrlQueryResult,
  type UrlRow,
} from '~/utils/site-audit'

type ColumnKey =
  | 'url'
  | 'issue_detail'
  | 'status_code'
  | 'indexable'
  | 'title'
  | 'depth'
  | 'inlinks'
  | 'response_ms'
  | 'word_count'
  | 'issue_count'

interface ColumnDef {
  key: ColumnKey
  label: string
  sortable: boolean
  numeric?: boolean
  /** Direction used on the first click; numbers are most useful high-first. */
  firstDir?: 'asc' | 'desc'
}

const props = withDefaults(
  defineProps<{
    crawlId: string
    issueId?: string | null
    showFilter?: boolean
    /** Bump to force a reload (e.g. when a running crawl finishes). */
    reloadKey?: number
  }>(),
  { issueId: null, showFilter: false, reloadKey: 0 },
)

const filter = defineModel<string>('filter', { default: 'all' })

const emit = defineEmits<{ 'open-url': [url: string] }>()

const PAGE_SIZE = 50

const URL_VIEW_COLUMNS: ColumnDef[] = [
  { key: 'url', label: 'URL', sortable: true },
  { key: 'status_code', label: 'Status', sortable: true, numeric: true },
  { key: 'indexable', label: 'Indexable', sortable: true },
  { key: 'title', label: 'Title', sortable: true },
  { key: 'depth', label: 'Depth', sortable: true, numeric: true },
  {
    key: 'inlinks',
    label: 'Inlinks',
    sortable: true,
    numeric: true,
    firstDir: 'desc',
  },
  {
    key: 'response_ms',
    label: 'Response',
    sortable: true,
    numeric: true,
    firstDir: 'desc',
  },
  {
    key: 'word_count',
    label: 'Words',
    sortable: true,
    numeric: true,
    firstDir: 'desc',
  },
  {
    key: 'issue_count',
    label: 'Issues',
    sortable: true,
    numeric: true,
    firstDir: 'desc',
  },
]

const ISSUE_VIEW_COLUMNS: ColumnDef[] = [
  { key: 'url', label: 'URL', sortable: true },
  { key: 'issue_detail', label: 'Detail', sortable: false },
  { key: 'status_code', label: 'Status', sortable: true, numeric: true },
  { key: 'indexable', label: 'Indexable', sortable: true },
  {
    key: 'inlinks',
    label: 'Inlinks',
    sortable: true,
    numeric: true,
    firstDir: 'desc',
  },
  {
    key: 'issue_count',
    label: 'Issues',
    sortable: true,
    numeric: true,
    firstDir: 'desc',
  },
]

/** Columns requested from the API (visible ones plus what the cells need). */
const REQUEST_COLUMNS = [
  'url',
  'crawl_state',
  'status_code',
  'indexable',
  'indexability_reason',
  'title',
  'depth',
  'inlinks',
  'response_ms',
  'word_count',
  'issue_count',
].join(',')

const columns = computed(() =>
  props.issueId ? ISSUE_VIEW_COLUMNS : URL_VIEW_COLUMNS,
)

const search = ref('')
const debouncedSearch = ref('')
const sort = ref<ColumnKey>('url')
const dir = ref<'asc' | 'desc'>('asc')
const offset = ref(0)
const result = ref<UrlQueryResult | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)

let searchTimer: ReturnType<typeof setTimeout> | null = null
watch(search, (value) => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    debouncedSearch.value = value.trim()
  }, 300)
})
onBeforeUnmount(() => {
  if (searchTimer) clearTimeout(searchTimer)
})

let requestSeq = 0
async function load() {
  const seq = ++requestSeq
  loading.value = true
  error.value = null
  try {
    const query: Record<string, string | number> = {
      columns: REQUEST_COLUMNS,
      sort: sort.value,
      dir: dir.value,
      limit: PAGE_SIZE,
      offset: offset.value,
    }
    if (props.issueId) query.issue = props.issueId
    else query.filter = filter.value
    if (debouncedSearch.value) query.search = debouncedSearch.value
    const data = await $fetch<UrlQueryResult>(
      `/api/site-audit/crawls/${encodeURIComponent(props.crawlId)}/urls`,
      { query },
    )
    if (seq === requestSeq) result.value = data
  } catch (e) {
    if (seq === requestSeq) {
      error.value = apiErrorMessage(e, 'Could not load URLs')
      result.value = null
    }
  } finally {
    if (seq === requestSeq) loading.value = false
  }
}

// Any change of the query resets to the first page.
watch(
  () => [
    props.crawlId,
    props.issueId,
    filter.value,
    debouncedSearch.value,
    sort.value,
    dir.value,
  ],
  () => {
    if (offset.value !== 0) offset.value = 0
    else load()
  },
)
watch(offset, load)
watch(() => props.reloadKey, load)
onMounted(load)

// A new issue starts with an empty search.
watch(
  () => props.issueId,
  () => {
    search.value = ''
    debouncedSearch.value = ''
  },
)

function toggleSort(column: ColumnDef) {
  if (!column.sortable) return
  if (sort.value === column.key) {
    dir.value = dir.value === 'asc' ? 'desc' : 'asc'
  } else {
    sort.value = column.key
    dir.value = column.firstDir ?? 'asc'
  }
}

function ariaSort(column: ColumnDef) {
  if (sort.value !== column.key) return 'none'
  return dir.value === 'asc' ? 'ascending' : 'descending'
}

const total = computed(() => result.value?.total ?? 0)
const rows = computed(() => result.value?.rows ?? [])
const rangeLabel = computed(() => {
  if (!total.value) return '0 URLs'
  const from = offset.value + 1
  const to = Math.min(offset.value + PAGE_SIZE, total.value)
  return `${formatNumber(from)}-${formatNumber(to)} of ${formatNumber(total.value)}`
})
const hasPrev = computed(() => offset.value > 0)
const hasNext = computed(() => offset.value + PAGE_SIZE < total.value)

function prevPage() {
  if (hasPrev.value) offset.value = Math.max(0, offset.value - PAGE_SIZE)
}
function nextPage() {
  if (hasNext.value) offset.value += PAGE_SIZE
}

function statusClass(row: UrlRow): string {
  if (row.crawl_state !== 'fetched') {
    return row.crawl_state === 'failed' || row.crawl_state === 'blocked_target'
      ? 'status-error'
      : 'status-muted'
  }
  const code = Number(row.status_code)
  if (code >= 500 || (code >= 400 && code < 500)) return 'status-error'
  if (code >= 300) return 'status-warning'
  if (code >= 200) return 'status-ok'
  return 'status-muted'
}

function statusText(row: UrlRow): string {
  if (row.crawl_state !== 'fetched' || row.status_code == null) {
    return crawlStateLabel(row.crawl_state)
  }
  return String(row.status_code)
}

function text(value: unknown): string {
  return value === null || value === undefined || value === ''
    ? '-'
    : String(value)
}
</script>

<template>
  <div class="url-table">
    <div class="table-toolbar">
      <select
        v-if="showFilter && !issueId"
        v-model="filter"
        class="filter-select"
        aria-label="Filter URLs"
      >
        <option v-for="opt in URL_FILTER_OPTIONS" :key="opt.value" :value="opt.value">
          {{ opt.label }}
        </option>
      </select>
      <input
        v-model="search"
        type="search"
        class="search-input"
        placeholder="Search URL or title"
        aria-label="Search URL or title"
      >
      <span class="toolbar-spacer" />
      <Loader v-if="loading" :size="14" class="spin toolbar-loader" aria-hidden="true" />
      <span class="range-label" aria-live="polite">{{ rangeLabel }}</span>
      <div class="pager">
        <button
          type="button"
          class="btn-page"
          :disabled="!hasPrev || loading"
          aria-label="Previous page"
          @click="prevPage"
        >
          <ChevronLeft :size="14" />
        </button>
        <button
          type="button"
          class="btn-page"
          :disabled="!hasNext || loading"
          aria-label="Next page"
          @click="nextPage"
        >
          <ChevronRight :size="14" />
        </button>
      </div>
    </div>

    <div v-if="error" class="table-error" role="alert">{{ error }}</div>

    <div class="table-wrapper" :class="{ 'is-loading': loading }">
      <table class="data-table">
        <thead>
          <tr>
            <th
              v-for="col in columns"
              :key="col.key"
              :class="[`col-${col.key}`, { numeric: col.numeric }]"
              :aria-sort="col.sortable ? ariaSort(col) : undefined"
              scope="col"
            >
              <button
                v-if="col.sortable"
                type="button"
                class="sort-button"
                @click="toggleSort(col)"
              >
                {{ col.label }}<span class="sort-indicator" aria-hidden="true">{{
                  sort === col.key ? (dir === 'asc' ? ' ▲' : ' ▼') : ''
                }}</span>
              </button>
              <template v-else>{{ col.label }}</template>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="String(row.url)">
            <td
              v-for="col in columns"
              :key="col.key"
              :class="[`col-${col.key}`, { numeric: col.numeric }]"
            >
              <button
                v-if="col.key === 'url'"
                type="button"
                class="url-link"
                :title="String(row.url)"
                @click="emit('open-url', String(row.url))"
              >
                {{ row.url }}
              </button>
              <span v-else-if="col.key === 'status_code'" :class="['status-badge', statusClass(row)]">
                {{ statusText(row) }}
              </span>
              <template v-else-if="col.key === 'indexable'">
                <span v-if="row.indexable === 1" class="index-yes">Yes</span>
                <span
                  v-else-if="row.indexable === 0"
                  class="index-no"
                  :title="text(row.indexability_reason)"
                >
                  No<span v-if="row.indexability_reason" class="index-reason">
                    ({{ row.indexability_reason }})</span>
                </span>
                <span v-else class="muted">-</span>
              </template>
              <span
                v-else-if="col.key === 'title' || col.key === 'issue_detail'"
                class="cell-text"
                :title="text(row[col.key])"
              >{{ text(row[col.key]) }}</span>
              <template v-else-if="col.key === 'response_ms'">
                {{ row.response_ms == null ? '-' : `${formatNumber(row.response_ms)} ms` }}
              </template>
              <template v-else>{{ formatNumber(row[col.key]) }}</template>
            </td>
          </tr>
          <tr v-if="!loading && !error && rows.length === 0">
            <td :colspan="columns.length" class="empty-row">
              No URLs match{{ debouncedSearch ? ` "${debouncedSearch}"` : '' }}.
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.url-table {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
}

.table-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0;
  flex-wrap: wrap;
}

.filter-select,
.search-input {
  padding: 6px 10px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text-primary);
  font-size: 12px;
}

.search-input {
  width: 240px;
  max-width: 100%;
}

.filter-select:focus,
.search-input:focus {
  outline: none;
  border-color: var(--accent);
}

.toolbar-spacer {
  flex: 1;
}

.toolbar-loader {
  color: var(--text-muted);
}

.range-label {
  font-size: 12px;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}

.pager {
  display: flex;
  gap: 4px;
}

.btn-page {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text-primary);
  cursor: pointer;
}

.btn-page:hover:not(:disabled) {
  border-color: var(--accent);
}

.btn-page:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.table-error {
  padding: 8px 12px;
  margin-bottom: 8px;
  background: var(--error-bg);
  border-radius: 4px;
  color: var(--error);
  font-size: 12px;
}

.table-wrapper {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 6px;
  transition: opacity 0.15s;
}

.table-wrapper.is-loading {
  opacity: 0.6;
}

.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.data-table th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--bg-secondary);
  padding: 8px 10px;
  text-align: left;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
}

.data-table td {
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  color: var(--text-primary);
  vertical-align: top;
}

.data-table tbody tr:last-child td {
  border-bottom: none;
}

.data-table tbody tr:hover td {
  background: var(--bg-secondary);
}

.numeric {
  text-align: right;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.data-table th.numeric {
  text-align: right;
}

.sort-button {
  background: none;
  border: none;
  padding: 0;
  font: inherit;
  color: inherit;
  cursor: pointer;
  white-space: nowrap;
}

.sort-button:hover,
.sort-button:focus-visible {
  color: var(--sa-link, var(--accent));
}

.sort-indicator {
  font-size: 9px;
}

.col-url {
  max-width: 340px;
}

.url-link {
  display: block;
  max-width: 100%;
  background: none;
  border: none;
  padding: 0;
  font: inherit;
  font-family: 'SF Mono', Monaco, monospace;
  font-size: 11px;
  color: var(--sa-link, var(--accent));
  text-align: left;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.url-link:hover {
  color: var(--sa-link, var(--accent));
  text-decoration: underline;
}

.col-title,
.col-issue_detail {
  max-width: 260px;
}

.cell-text {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.col-issue_detail .cell-text {
  white-space: normal;
  overflow-wrap: anywhere;
}

.status-badge {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 11px;
  font-weight: 600;
  background: var(--bg-tertiary);
  white-space: nowrap;
}

.status-ok {
  color: var(--success);
  background: var(--success-bg);
}

.status-warning {
  color: var(--warning);
}

.status-error {
  color: var(--error);
  background: var(--error-bg);
}

.status-muted {
  color: var(--text-secondary);
  font-weight: 400;
}

.index-yes {
  color: var(--success);
}

.index-no {
  color: var(--warning);
  white-space: nowrap;
}

.index-reason {
  color: var(--text-muted);
}

.muted {
  color: var(--text-muted);
}

.empty-row {
  text-align: center;
  color: var(--text-muted);
  padding: 24px !important;
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
</style>
