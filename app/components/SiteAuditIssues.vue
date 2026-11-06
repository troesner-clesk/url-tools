<script setup lang="ts">
import {
  apiErrorMessage,
  formatNumber,
  type IssueSummary,
  SEVERITIES,
  SEVERITY_LABELS,
  type Severity,
} from '~/utils/site-audit'

const props = withDefaults(
  defineProps<{ crawlId: string; reloadKey?: number; running?: boolean }>(),
  { reloadKey: 0, running: false },
)

const selectedId = defineModel<string | null>('selectedId', { default: null })

const emit = defineEmits<{ 'open-url': [url: string] }>()

const issues = ref<IssueSummary[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

let requestSeq = 0
async function load() {
  const seq = ++requestSeq
  loading.value = true
  error.value = null
  try {
    const data = await $fetch<{ issues: IssueSummary[] }>(
      `/api/site-audit/crawls/${encodeURIComponent(props.crawlId)}/issues`,
    )
    if (seq !== requestSeq) return
    issues.value = data.issues
    const first = data.issues[0]
    if (first && !data.issues.some((i) => i.id === selectedId.value)) {
      selectedId.value = first.id
    }
  } catch (e) {
    if (seq === requestSeq) {
      issues.value = []
      error.value = apiErrorMessage(e, 'Could not load issues')
    }
  } finally {
    if (seq === requestSeq) loading.value = false
  }
}

watch(() => [props.crawlId, props.reloadKey], load)
onMounted(load)

const groups = computed(() =>
  SEVERITIES.map((severity) => {
    const items = issues.value.filter((i) => i.severity === severity)
    return {
      severity,
      items,
      total: items.reduce((sum, i) => sum + i.count, 0),
    }
  }).filter((g) => g.items.length > 0),
)

const selected = computed(
  () => issues.value.find((i) => i.id === selectedId.value) ?? null,
)

const severityLabel: Record<Severity, string> = {
  error: 'Error',
  warning: 'Warning',
  notice: 'Notice',
}

const detailEl = ref<HTMLElement | null>(null)
watch(selectedId, () => detailEl.value?.scrollTo(0, 0))
</script>

<template>
  <div class="issues-view">
    <div v-if="error" class="view-error" role="alert">{{ error }}</div>

    <div v-else-if="!loading && issues.length === 0" class="view-empty">
      <p v-if="running">Issues are calculated when the crawl finishes.</p>
      <p v-else>No issues found in this crawl.</p>
    </div>

    <div v-else class="issues-layout">
      <nav class="issue-nav" aria-label="Issues">
        <section v-for="group in groups" :key="group.severity" class="issue-group">
          <h3 :class="['group-title', `sev-${group.severity}`]">
            {{ SEVERITY_LABELS[group.severity] }}
            <span class="group-count">{{ formatNumber(group.total) }}</span>
          </h3>
          <ul>
            <li v-for="issue in group.items" :key="issue.id">
              <button
                type="button"
                :class="['issue-item', { active: issue.id === selectedId }]"
                :aria-current="issue.id === selectedId ? 'true' : undefined"
                @click="selectedId = issue.id"
              >
                <span class="issue-item-title">{{ issue.title }}</span>
                <span class="issue-item-count">{{ formatNumber(issue.count) }}</span>
              </button>
            </li>
          </ul>
        </section>
      </nav>

      <div ref="detailEl" class="issue-detail">
        <template v-if="selected">
          <div class="issue-header">
            <div class="issue-badges">
              <span :class="['sev-badge', `sev-${selected.severity}`]">{{ severityLabel[selected.severity] }}</span>
              <span class="category">{{ selected.category }}</span>
              <code class="issue-id">{{ selected.id }}</code>
            </div>
            <h2>{{ selected.title }}</h2>
            <p class="affected">{{ formatNumber(selected.count) }} affected URL{{ selected.count === 1 ? '' : 's' }}</p>
          </div>

          <div class="explain-grid">
            <section class="explain">
              <h4>What it means</h4>
              <p>{{ selected.description }}</p>
            </section>
            <section class="explain">
              <h4>Why it matters</h4>
              <p>{{ selected.why }}</p>
            </section>
            <section class="explain">
              <h4>How to fix</h4>
              <p>{{ selected.fix }}</p>
            </section>
          </div>

          <h4 class="table-title">Affected URLs</h4>
          <SiteAuditUrlTable
            :crawl-id="crawlId"
            :issue-id="selected.id"
            :reload-key="reloadKey"
            @open-url="emit('open-url', $event)"
          />
        </template>
        <p v-else-if="loading" class="muted">Loading issues...</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.issues-view {
  height: 100%;
  min-height: 0;
}

.issues-layout {
  display: grid;
  grid-template-columns: 300px 1fr;
  height: 100%;
  min-height: 0;
}

.issue-nav {
  border-right: 1px solid var(--border);
  overflow-y: auto;
  padding: 12px 8px 16px 0;
}

.issue-group {
  margin-bottom: 14px;
}

.issue-group ul {
  list-style: none;
}

.group-title {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: 0 8px 4px;
  font-size: 12px;
  font-weight: 600;
}

.group-count {
  color: var(--text-secondary);
  font-weight: 400;
  font-variant-numeric: tabular-nums;
}

.issue-item {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  background: none;
  border: none;
  border-radius: 4px;
  font: inherit;
  font-size: 13px;
  color: var(--text-primary);
  text-align: left;
  cursor: pointer;
}

.issue-item:hover,
.issue-item:focus-visible {
  background: var(--bg-secondary);
}

.issue-item.active {
  background: var(--info-bg);
}

.issue-item-count {
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}

.issue-detail {
  overflow-y: auto;
  padding: 12px 0 16px 16px;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.issue-header h2 {
  font-size: 17px;
  font-weight: 600;
  margin: 6px 0 2px;
}

.issue-badges {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.category {
  font-size: 12px;
  color: var(--text-secondary);
  text-transform: capitalize;
}

.issue-id {
  font-family: 'SF Mono', Monaco, monospace;
  font-size: 11px;
  color: var(--text-muted);
}

.affected {
  font-size: 13px;
  color: var(--text-secondary);
}

.explain-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 8px;
  margin: 14px 0 16px;
}

.explain {
  padding: 10px 12px;
  background: var(--bg-secondary);
  border-radius: 6px;
}

.explain h4 {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 4px;
}

.explain p {
  font-size: 13px;
  line-height: 1.5;
}

.table-title {
  font-size: 13px;
  font-weight: 600;
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

.view-error {
  padding: 10px 12px;
  margin-top: 12px;
  background: var(--error-bg);
  border-radius: 4px;
  color: var(--error);
  font-size: 13px;
}

.view-empty {
  padding: 48px 0;
  text-align: center;
  color: var(--text-muted);
}

.muted {
  color: var(--text-muted);
}

@media (max-width: 900px) {
  .issues-layout {
    grid-template-columns: 1fr;
    height: auto;
  }

  .issue-nav {
    border-right: none;
    border-bottom: 1px solid var(--border);
    max-height: 40vh;
  }

  .issue-detail {
    padding-left: 0;
  }
}
</style>
