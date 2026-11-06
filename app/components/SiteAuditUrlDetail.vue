<script setup lang="ts">
import { ArrowLeft, ExternalLink, Loader, X } from '@lucide/vue'
import {
  apiErrorMessage,
  crawlStateLabel,
  formatNumber,
  type Severity,
  type UrlDetails,
} from '~/utils/site-audit'

const props = defineProps<{
  crawlId: string
  /** URL to show; null closes the panel. */
  url: string | null
}>()

const emit = defineEmits<{
  close: []
  'open-issue': [issueId: string]
}>()

const { formatSize } = useFormatters()

const dialogEl = ref<HTMLDialogElement | null>(null)
const current = ref<string | null>(null)
const history = ref<string[]>([])
const details = ref<UrlDetails | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)

let requestSeq = 0
async function load(url: string) {
  const seq = ++requestSeq
  loading.value = true
  error.value = null
  try {
    const data = await $fetch<UrlDetails>(
      `/api/site-audit/crawls/${encodeURIComponent(props.crawlId)}/url`,
      { query: { url } },
    )
    if (seq === requestSeq) details.value = data
  } catch (e) {
    if (seq === requestSeq) {
      details.value = null
      error.value = apiErrorMessage(e, 'Could not load URL details')
    }
  } finally {
    if (seq === requestSeq) loading.value = false
  }
}

function show(url: string, push: boolean) {
  if (push && current.value && current.value !== url) {
    history.value.push(current.value)
  }
  current.value = url
  load(url)
  nextTick(() => {
    dialogEl.value?.querySelector<HTMLElement>('.detail-body')?.scrollTo(0, 0)
  })
}

watch(
  () => props.url,
  (url) => {
    if (url) {
      history.value = []
      show(url, false)
      if (dialogEl.value && !dialogEl.value.open) dialogEl.value.showModal()
    } else if (dialogEl.value?.open) {
      dialogEl.value.close()
    }
  },
)

onMounted(() => {
  if (props.url && dialogEl.value) {
    show(props.url, false)
    dialogEl.value.showModal()
  }
})

function navigate(url: string) {
  show(url, true)
}

function back() {
  const prev = history.value.pop()
  if (prev) show(prev, false)
}

function requestClose() {
  dialogEl.value?.close()
}

function onDialogClose() {
  emit('close')
}

function onBackdropClick(event: MouseEvent) {
  // Clicks on the ::backdrop target the dialog element itself.
  if (event.target === dialogEl.value) requestClose()
}

function openIssue(id: string) {
  emit('open-issue', id)
  requestClose()
}

/** Only real web URLs become clickable links to the live page. */
function isWebUrl(value: unknown): value is string {
  return typeof value === 'string' && /^https?:\/\//i.test(value)
}

function text(value: unknown): string {
  return value === null || value === undefined || value === ''
    ? '-'
    : String(value)
}

function yesNo(value: unknown): string {
  if (value === 1 || value === true) return 'Yes'
  if (value === 0 || value === false) return 'No'
  return '-'
}

function statusClass(code: number | null | undefined): string {
  if (code == null) return 'status-muted'
  if (code >= 400) return 'status-error'
  if (code >= 300) return 'status-warning'
  return 'status-ok'
}

const row = computed(() => details.value?.url ?? null)

const statusLabel = computed(() => {
  const r = row.value
  if (!r) return '-'
  if (r.crawl_state !== 'fetched' || r.status_code == null) {
    return crawlStateLabel(r.crawl_state)
  }
  return String(r.status_code)
})

const keyFields = computed(() => {
  const r = row.value
  if (!r) return []
  const fields: Array<{ label: string; value: string; mono?: boolean }> = [
    { label: 'Crawl state', value: crawlStateLabel(r.crawl_state) },
    { label: 'Type', value: r.is_internal ? 'Internal' : 'External' },
    { label: 'Found via', value: text(r.found_via) },
    { label: 'Depth', value: text(r.depth) },
    { label: 'Content type', value: text(r.content_type) },
    {
      label: 'Response time',
      value: r.response_ms == null ? '-' : `${formatNumber(r.response_ms)} ms`,
    },
    {
      label: 'Size',
      value: r.size_bytes == null ? '-' : formatSize(Number(r.size_bytes)),
    },
    {
      label: 'Indexable',
      value:
        r.indexable === 0 && r.indexability_reason
          ? `No (${r.indexability_reason})`
          : yesNo(r.indexable),
    },
    { label: 'Language', value: text(r.lang) },
    { label: 'Words', value: formatNumber(r.word_count) },
    {
      label: 'Images',
      value:
        r.images_total == null
          ? '-'
          : `${formatNumber(r.images_total)} (${formatNumber(r.images_missing_alt)} without alt)`,
    },
    { label: 'In sitemap', value: yesNo(r.in_sitemap) },
    { label: 'Inlinks', value: formatNumber(r.inlinks) },
    {
      label: 'Outlinks',
      value: `${formatNumber(r.outlinks)} (${formatNumber(r.external_outlinks)} external)`,
    },
  ]
  if (r.redirect_url) {
    fields.push({
      label: 'Redirects to',
      value: text(r.redirect_url),
      mono: true,
    })
  }
  if (r.final_url && r.final_url !== r.url) {
    fields.push({
      label: 'Final URL',
      value: `${r.final_url} (${text(r.final_status)})`,
      mono: true,
    })
  }
  return fields
})

const metaFields = computed(() => {
  const r = row.value
  if (!r) return []
  const withLength = (value: unknown, length: unknown, count?: unknown) => {
    if (value === null || value === undefined || value === '')
      return '(not set)'
    const extra = [`${formatNumber(length)} chars`]
    if (Number(count) > 1) extra.push(`${count} found`)
    return `${value} (${extra.join(', ')})`
  }
  return [
    {
      label: 'Title',
      value: withLength(r.title, r.title_length, r.title_count),
    },
    {
      label: 'Meta description',
      value: withLength(
        r.meta_description,
        r.meta_description_length,
        r.meta_description_count,
      ),
    },
    {
      label: 'H1',
      value:
        r.h1 == null
          ? '(not set)'
          : `${r.h1}${Number(r.h1_count) > 1 ? ` (${r.h1_count} H1 found)` : ''}`,
    },
    { label: 'H2 count', value: formatNumber(r.h2_count) },
    { label: 'Canonical', value: text(r.canonical_url) },
    { label: 'Meta robots', value: text(r.meta_robots) },
    { label: 'X-Robots-Tag', value: text(r.x_robots_tag) },
  ]
})

const severityLabel: Record<Severity, string> = {
  error: 'Error',
  warning: 'Warning',
  notice: 'Notice',
}
</script>

<template>
  <dialog
    ref="dialogEl"
    class="url-detail"
    aria-labelledby="site-audit-url-detail-title"
    @close="onDialogClose"
    @click="onBackdropClick"
  >
    <div class="detail-shell">
      <div class="detail-header">
        <button
          v-if="history.length"
          type="button"
          class="btn-icon"
          aria-label="Back to previous URL"
          title="Back"
          @click="back"
        >
          <ArrowLeft :size="16" />
        </button>
        <div class="detail-heading">
          <h3 id="site-audit-url-detail-title" class="detail-url">{{ current }}</h3>
          <div class="detail-sub">
            <span :class="['status-badge', statusClass(row?.status_code as number | null)]">{{ statusLabel }}</span>
            <a
              v-if="isWebUrl(current)"
              :href="current"
              target="_blank"
              rel="noopener noreferrer"
              class="live-link"
            >
              Open page <ExternalLink :size="11" />
            </a>
            <Loader v-if="loading" :size="13" class="spin muted" aria-label="Loading" />
          </div>
        </div>
        <button
          type="button"
          class="btn-icon"
          aria-label="Close URL details"
          title="Close"
          @click="requestClose"
        >
          <X :size="16" />
        </button>
      </div>

      <div class="detail-body">
        <div v-if="error" class="detail-error" role="alert">{{ error }}</div>

        <template v-else-if="details && row">
          <p v-if="row.error" class="detail-error">{{ row.error }}</p>

          <section class="detail-section">
            <h4>Overview</h4>
            <dl class="field-grid">
              <div v-for="field in keyFields" :key="field.label" class="field">
                <dt>{{ field.label }}</dt>
                <dd :class="{ mono: field.mono }">{{ field.value }}</dd>
              </div>
            </dl>
          </section>

          <section class="detail-section">
            <h4>Meta and headings</h4>
            <dl class="field-list">
              <div v-for="field in metaFields" :key="field.label" class="field-row">
                <dt>{{ field.label }}</dt>
                <dd>{{ field.value }}</dd>
              </div>
            </dl>
          </section>

          <section class="detail-section">
            <h4>Issues ({{ details.issues.length }})</h4>
            <p v-if="!details.issues.length" class="muted small">No issues found for this URL.</p>
            <ul v-else class="issue-list">
              <li v-for="issue in details.issues" :key="issue.id">
                <button type="button" class="issue-button" @click="openIssue(issue.id)">
                  <span :class="['sev-badge', `sev-${issue.severity}`]">{{ severityLabel[issue.severity] }}</span>
                  <span class="issue-title">{{ issue.title }}</span>
                </button>
                <div v-if="issue.detail" class="issue-detail">{{ issue.detail }}</div>
              </li>
            </ul>
          </section>

          <section v-if="details.redirectChain.length" class="detail-section">
            <h4>Redirect chain</h4>
            <ol class="chain">
              <li v-for="(hop, i) in details.redirectChain" :key="`${i}-${hop.url}`">
                <span :class="['status-badge', statusClass(hop.status)]">{{ hop.status ?? '-' }}</span>
                <button type="button" class="url-link" :title="hop.url" @click="navigate(hop.url)">{{ hop.url }}</button>
              </li>
            </ol>
          </section>

          <section class="detail-section">
            <h4>
              Inlinks ({{ formatNumber(details.inlinks.total) }})
              <span v-if="details.inlinks.total > details.inlinks.items.length" class="muted small">
                showing first {{ details.inlinks.items.length }}
              </span>
            </h4>
            <p v-if="!details.inlinks.items.length" class="muted small">No internal page links here.</p>
            <div v-else class="mini-table-wrapper">
              <table class="mini-table">
                <thead>
                  <tr>
                    <th scope="col">Source</th>
                    <th scope="col">Anchor</th>
                    <th scope="col">Nofollow</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(link, i) in details.inlinks.items" :key="`${i}-${link.source}`">
                    <td class="col-link">
                      <button type="button" class="url-link" :title="link.source" @click="navigate(link.source)">{{ link.source }}</button>
                    </td>
                    <td class="col-anchor" :title="text(link.anchor)">{{ text(link.anchor) }}</td>
                    <td>{{ link.nofollow ? 'Yes' : '' }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section class="detail-section">
            <h4>
              Outlinks ({{ formatNumber(details.outlinks.total) }})
              <span v-if="details.outlinks.total > details.outlinks.items.length" class="muted small">
                showing first {{ details.outlinks.items.length }}
              </span>
            </h4>
            <p v-if="!details.outlinks.items.length" class="muted small">This URL links nowhere.</p>
            <div v-else class="mini-table-wrapper">
              <table class="mini-table">
                <thead>
                  <tr>
                    <th scope="col">Target</th>
                    <th scope="col">Anchor</th>
                    <th scope="col">Status</th>
                    <th scope="col">Type</th>
                    <th scope="col">Nofollow</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(link, i) in details.outlinks.items" :key="`${i}-${link.target}`">
                    <td class="col-link">
                      <button type="button" class="url-link" :title="link.target" @click="navigate(link.target)">{{ link.target }}</button>
                    </td>
                    <td class="col-anchor" :title="text(link.anchor)">{{ text(link.anchor) }}</td>
                    <td>
                      <span v-if="link.status_code != null" :class="['status-badge', statusClass(link.status_code)]">{{ link.status_code }}</span>
                      <span v-else class="muted">-</span>
                    </td>
                    <td>{{ link.is_internal ? 'Internal' : 'External' }}</td>
                    <td>{{ link.nofollow ? 'Yes' : '' }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section v-if="details.hreflang.length" class="detail-section">
            <h4>Hreflang ({{ details.hreflang.length }})</h4>
            <div class="mini-table-wrapper">
              <table class="mini-table">
                <thead>
                  <tr>
                    <th scope="col">Language</th>
                    <th scope="col">Target</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(entry, i) in details.hreflang" :key="`${i}-${entry.lang}`">
                    <td>{{ entry.lang }}</td>
                    <td class="col-link">
                      <button type="button" class="url-link" :title="entry.target" @click="navigate(entry.target)">{{ entry.target }}</button>
                    </td>
                    <td>
                      <span v-if="entry.status_code != null" :class="['status-badge', statusClass(entry.status_code)]">{{ entry.status_code }}</span>
                      <span v-else class="muted">-</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section class="detail-section">
            <h4>Sitemaps ({{ details.sitemaps.length }})</h4>
            <p v-if="!details.sitemaps.length" class="muted small">Not listed in any sitemap.</p>
            <ul v-else class="plain-list">
              <li v-for="sitemap in details.sitemaps" :key="sitemap" class="mono">{{ sitemap }}</li>
            </ul>
          </section>
        </template>

        <div v-else-if="loading" class="detail-loading muted">Loading URL details...</div>
      </div>
    </div>
  </dialog>
</template>

<style scoped>
.url-detail {
  width: min(960px, 94vw);
  max-height: 88vh;
  margin: auto;
  padding: 0;
  background: var(--bg-primary);
  color: var(--text-primary);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
}

.url-detail::backdrop {
  background: rgba(0, 0, 0, 0.5);
}

.detail-shell {
  display: flex;
  flex-direction: column;
  max-height: 88vh;
}

.detail-header {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-secondary);
}

.detail-heading {
  flex: 1;
  min-width: 0;
}

.detail-url {
  font-family: 'SF Mono', Monaco, monospace;
  font-size: 13px;
  font-weight: 600;
  word-break: break-all;
}

.detail-sub {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 6px;
  font-size: 12px;
}

.live-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--sa-link, var(--accent));
  text-decoration: none;
}

.live-link:hover {
  text-decoration: underline;
}

.btn-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  color: var(--text-secondary);
  cursor: pointer;
}

.btn-icon:hover,
.btn-icon:focus-visible {
  border-color: var(--border);
  color: var(--text-primary);
  background: var(--bg-tertiary);
}

.detail-body {
  overflow-y: auto;
  padding: 16px;
}

.detail-section {
  margin-bottom: 20px;
}

.detail-section:last-child {
  margin-bottom: 0;
}

.detail-section h4 {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 8px;
  color: var(--text-primary);
}

.field-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 8px;
}

.field {
  padding: 8px 10px;
  background: var(--bg-secondary);
  border-radius: 4px;
  min-width: 0;
}

.field dt,
.field-row dt {
  font-size: 11px;
  color: var(--text-secondary);
}

.field dd {
  font-size: 13px;
  word-break: break-word;
}

.field-list {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: 4px;
}

.field-row {
  display: grid;
  grid-template-columns: 140px 1fr;
  gap: 12px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
}

.field-row:last-child {
  border-bottom: none;
}

.field-row dd {
  font-size: 12px;
  word-break: break-word;
}

.mono {
  font-family: 'SF Mono', Monaco, monospace;
  font-size: 11px;
  word-break: break-all;
}

.issue-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.issue-list li {
  padding: 6px 10px;
  background: var(--bg-secondary);
  border-radius: 4px;
}

.issue-button {
  display: flex;
  align-items: center;
  gap: 8px;
  background: none;
  border: none;
  padding: 0;
  font: inherit;
  color: var(--text-primary);
  cursor: pointer;
  text-align: left;
}

.issue-button:hover .issue-title,
.issue-button:focus-visible .issue-title {
  color: var(--sa-link, var(--accent));
  text-decoration: underline;
}

.issue-title {
  font-size: 13px;
}

.issue-detail {
  margin-top: 2px;
  margin-left: 2px;
  font-size: 12px;
  color: var(--text-secondary);
  word-break: break-word;
}

.sev-badge {
  display: inline-block;
  min-width: 58px;
  padding: 1px 6px;
  border: 1px solid currentColor;
  border-radius: 3px;
  font-size: 10px;
  font-weight: 600;
  text-align: center;
  text-transform: uppercase;
}

.sev-error {
  color: var(--error);
}

.sev-warning {
  color: var(--warning);
}

.sev-notice {
  color: var(--info);
}

.chain {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.chain li {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.mini-table-wrapper {
  max-height: 280px;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 4px;
}

.mini-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.mini-table th {
  position: sticky;
  top: 0;
  background: var(--bg-secondary);
  padding: 6px 10px;
  text-align: left;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
}

.mini-table td {
  padding: 5px 10px;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
}

.mini-table tbody tr:last-child td {
  border-bottom: none;
}

.col-link {
  max-width: 420px;
}

.col-anchor {
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.url-link {
  display: block;
  max-width: 100%;
  min-width: 0;
  background: none;
  border: none;
  padding: 0;
  font-family: 'SF Mono', Monaco, monospace;
  font-size: 11px;
  color: var(--sa-link, var(--accent));
  text-align: left;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.url-link:hover,
.url-link:focus-visible {
  color: var(--sa-link, var(--accent));
  text-decoration: underline;
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

.plain-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.detail-error {
  padding: 10px 12px;
  margin-bottom: 12px;
  background: var(--error-bg);
  border-radius: 4px;
  color: var(--error);
  font-size: 13px;
}

.detail-loading {
  padding: 24px;
  text-align: center;
}

.muted {
  color: var(--text-muted);
}

.small {
  font-size: 12px;
  font-weight: 400;
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
