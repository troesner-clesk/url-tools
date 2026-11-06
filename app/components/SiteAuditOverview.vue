<script setup lang="ts">
import {
  type CrawlOverview,
  formatNumber,
  SEVERITIES,
  SEVERITY_LABELS,
  type Severity,
  STATUS_BUCKET_FILTER,
} from '~/utils/site-audit'

const props = defineProps<{ overview: CrawlOverview }>()

const emit = defineEmits<{
  'open-issue': [issueId: string | null]
  'open-urls': [filter: string]
}>()

interface Bar {
  key: string
  label: string
  count: number
  filter?: string
}

const STATUS_ORDER = [
  '2xx',
  '3xx',
  '4xx',
  '5xx',
  'other',
  'failed',
  'blocked',
  'not crawled',
]

const kpis = computed(() => {
  const t = props.overview.totals
  return [
    { label: 'URLs found', value: t.urls, filter: 'all' },
    { label: 'Fetched', value: t.fetched },
    { label: 'HTML pages', value: t.htmlPages, filter: 'html' },
    { label: 'Indexable', value: t.indexable, filter: 'indexable' },
    { label: 'Non-indexable', value: t.nonIndexable, filter: 'non-indexable' },
    { label: 'Not crawled', value: t.notCrawled, filter: 'not-crawled' },
    { label: 'Failed', value: t.failed, filter: 'failed' },
    { label: 'Blocked by robots', value: t.blockedByRobots, filter: 'blocked' },
    { label: 'External', value: t.external, filter: 'external' },
  ]
})

const statusBars = computed<Bar[]>(() =>
  Object.entries(props.overview.statusCodes)
    .map(([bucket, count]) => ({
      key: bucket,
      label:
        bucket === 'not crawled'
          ? 'Not crawled'
          : bucket.charAt(0).toUpperCase() + bucket.slice(1),
      count,
      filter: STATUS_BUCKET_FILTER[bucket],
    }))
    .sort((a, b) => {
      const ia = STATUS_ORDER.indexOf(a.key)
      const ib = STATUS_ORDER.indexOf(b.key)
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
    }),
)

const indexabilityBars = computed<Bar[]>(() =>
  Object.entries(props.overview.indexability)
    .map(([reason, count]) => ({
      key: reason,
      label: reason === 'indexable' ? 'Indexable' : reason,
      count,
      filter: reason === 'indexable' ? 'indexable' : 'non-indexable',
    }))
    .sort((a, b) => b.count - a.count),
)

const depthBars = computed<Bar[]>(() =>
  props.overview.depth.map((d) => ({
    key: String(d.depth),
    label: d.depth === null ? 'Unknown' : `Depth ${d.depth}`,
    count: d.count,
  })),
)

function maxOf(bars: Bar[]) {
  return Math.max(1, ...bars.map((b) => b.count))
}

function barWidth(bar: Bar, bars: Bar[]) {
  return `${Math.max(1, (bar.count / maxOf(bars)) * 100)}%`
}

const issueCounts = computed(() => props.overview.crawl.issues)
const totalIssues = computed(() =>
  SEVERITIES.reduce((sum, s) => sum + issueCounts.value[s], 0),
)

const severityLabel: Record<Severity, string> = {
  error: 'Error',
  warning: 'Warning',
  notice: 'Notice',
}

const sections = computed(() => [
  {
    id: 'status',
    title: 'Status codes',
    bars: statusBars.value,
    empty: 'No internal URLs.',
  },
  {
    id: 'indexability',
    title: 'Indexability',
    bars: indexabilityBars.value,
    empty: 'No indexability data yet.',
  },
  {
    id: 'depth',
    title: 'Click depth (HTML pages)',
    bars: depthBars.value,
    empty: 'No HTML pages fetched.',
  },
])
</script>

<template>
  <div class="overview">
    <section class="kpi-grid" aria-label="Key figures">
      <component
        :is="kpi.filter ? 'button' : 'div'"
        v-for="kpi in kpis"
        :key="kpi.label"
        :type="kpi.filter ? 'button' : undefined"
        :class="['kpi', { clickable: kpi.filter }]"
        :title="kpi.filter ? `Show ${kpi.label.toLowerCase()} in the URL table` : undefined"
        @click="kpi.filter && emit('open-urls', kpi.filter)"
      >
        <span class="kpi-value">{{ formatNumber(kpi.value) }}</span>
        <span class="kpi-label">{{ kpi.label }}</span>
      </component>
    </section>

    <section class="issue-totals" aria-label="Issues by severity">
      <button
        v-for="severity in SEVERITIES"
        :key="severity"
        type="button"
        :class="['issue-total', `sev-${severity}`]"
        @click="emit('open-issue', null)"
      >
        <span class="issue-total-value">{{ formatNumber(issueCounts[severity]) }}</span>
        <span class="issue-total-label">{{ SEVERITY_LABELS[severity] }}</span>
      </button>
      <div class="response-card">
        <span class="kpi-label">Response time (HTML)</span>
        <span class="response-values">
          <span><strong>{{ overview.responseTimeMs.average == null ? '-' : `${formatNumber(overview.responseTimeMs.average)} ms` }}</strong> avg</span>
          <span><strong>{{ overview.responseTimeMs.max == null ? '-' : `${formatNumber(overview.responseTimeMs.max)} ms` }}</strong> max</span>
        </span>
      </div>
    </section>

    <div class="chart-grid">
      <section v-for="section in sections" :key="section.id" class="card">
        <h3>{{ section.title }}</h3>
        <p v-if="!section.bars.length" class="muted small">{{ section.empty }}</p>
        <ul v-else class="bar-list">
          <li v-for="bar in section.bars" :key="bar.key">
            <component
              :is="bar.filter ? 'button' : 'div'"
              :type="bar.filter ? 'button' : undefined"
              :class="['bar-row', { clickable: bar.filter }]"
              :title="`${bar.label}: ${formatNumber(bar.count)}`"
              @click="bar.filter && emit('open-urls', bar.filter)"
            >
              <span class="bar-label">{{ bar.label }}</span>
              <span class="bar-track" aria-hidden="true">
                <span class="bar-fill" :style="{ width: barWidth(bar, section.bars) }" />
              </span>
              <span class="bar-value">{{ formatNumber(bar.count) }}</span>
            </component>
          </li>
        </ul>
      </section>
    </div>

    <section class="card">
      <div class="card-header">
        <h3>Top issues</h3>
        <button v-if="totalIssues" type="button" class="btn-link" @click="emit('open-issue', null)">
          All issues
        </button>
      </div>
      <p v-if="!overview.topIssues.length" class="muted small">No issues found.</p>
      <ul v-else class="top-issues">
        <li v-for="issue in overview.topIssues" :key="issue.id">
          <button type="button" class="top-issue" @click="emit('open-issue', issue.id)">
            <span :class="['sev-badge', `sev-${issue.severity}`]">{{ severityLabel[issue.severity] }}</span>
            <span class="top-issue-title">{{ issue.title }}</span>
            <span class="top-issue-count">{{ formatNumber(issue.count) }}</span>
          </button>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.overview {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.kpi-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  gap: 8px;
}

.kpi {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 10px 12px;
  background: var(--bg-secondary);
  border: 1px solid transparent;
  border-radius: 6px;
  color: var(--text-primary);
  font: inherit;
  text-align: left;
}

.kpi.clickable {
  cursor: pointer;
}

.kpi.clickable:hover,
.kpi.clickable:focus-visible {
  border-color: var(--accent);
}

.kpi-value {
  font-size: 20px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.kpi-label {
  font-size: 11px;
  color: var(--text-secondary);
}

.issue-totals {
  display: grid;
  grid-template-columns: repeat(3, minmax(110px, 1fr)) minmax(180px, 1.4fr);
  gap: 8px;
}

.issue-total {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 10px 12px;
  background: var(--bg-secondary);
  border: 1px solid transparent;
  border-left: 3px solid currentColor;
  border-radius: 6px;
  font: inherit;
  cursor: pointer;
  text-align: left;
}

.issue-total:hover,
.issue-total:focus-visible {
  border-color: currentColor;
}

.issue-total-value {
  font-size: 20px;
  font-weight: 600;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}

.issue-total-label {
  font-size: 11px;
  font-weight: 600;
}

.response-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  background: var(--bg-secondary);
  border-radius: 6px;
}

.response-values {
  display: flex;
  gap: 16px;
  font-size: 12px;
  color: var(--text-secondary);
}

.response-values strong {
  font-size: 15px;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}

.chart-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 12px;
}

.card {
  background: var(--bg-secondary);
  border-radius: 8px;
  padding: 14px 16px;
}

.card h3 {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 10px;
  color: var(--text-primary);
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}

.btn-link {
  background: none;
  border: none;
  padding: 0;
  font-size: 12px;
  color: var(--sa-link, var(--accent));
  cursor: pointer;
}

.btn-link:hover {
  text-decoration: underline;
}

.bar-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.bar-row {
  display: grid;
  grid-template-columns: minmax(80px, 38%) 1fr auto;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 4px 6px;
  background: none;
  border: none;
  border-radius: 4px;
  font: inherit;
  font-size: 12px;
  color: var(--text-primary);
  text-align: left;
}

.bar-row.clickable {
  cursor: pointer;
}

.bar-row.clickable:hover,
.bar-row.clickable:focus-visible {
  background: var(--bg-tertiary);
}

.bar-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-secondary);
}

.bar-track {
  height: 8px;
  background: var(--bg-tertiary);
  border-radius: 4px;
  overflow: hidden;
}

.bar-fill {
  display: block;
  height: 100%;
  background: var(--accent);
  border-radius: 4px;
}

.bar-value {
  min-width: 36px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.top-issues {
  list-style: none;
  display: flex;
  flex-direction: column;
}

.top-issue {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 7px 6px;
  background: none;
  border: none;
  border-bottom: 1px solid var(--border);
  font: inherit;
  font-size: 13px;
  color: var(--text-primary);
  text-align: left;
  cursor: pointer;
}

.top-issues li:last-child .top-issue {
  border-bottom: none;
}

.top-issue:hover,
.top-issue:focus-visible {
  background: var(--bg-tertiary);
}

.top-issue-count {
  font-variant-numeric: tabular-nums;
  color: var(--text-secondary);
}

.sev-badge {
  display: inline-block;
  min-width: 62px;
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

.muted {
  color: var(--text-muted);
}

.small {
  font-size: 12px;
}

@media (max-width: 900px) {
  .issue-totals {
    grid-template-columns: repeat(3, 1fr);
  }

  .response-card {
    grid-column: 1 / -1;
  }
}
</style>
