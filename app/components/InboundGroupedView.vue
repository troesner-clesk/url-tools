<script setup lang="ts">
import { ChevronDown, ChevronRight } from 'lucide-vue-next'
import {
  aggregateInboundLinks,
  type InboundLink,
} from '../composables/useInboundAggregation'

const props = defineProps<{ results: InboundLink[] }>()
const expanded = ref(new Set<string>())

const groups = computed(() => aggregateInboundLinks(props.results))

function toggle(targetUrl: string) {
  if (expanded.value.has(targetUrl)) expanded.value.delete(targetUrl)
  else expanded.value.add(targetUrl)
}

function anchorEntries(dist: Record<string, number>, total: number) {
  return Object.entries(dist)
    .map(([anchor, count]) => ({
      anchor,
      count,
      pct: Math.round((count / total) * 100),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)
}

function truncateUrl(url: string, max = 60): string {
  if (url.length <= max) return url
  return `${url.substring(0, max - 3)}...`
}
</script>

<template>
  <div class="grouped-view">
    <div v-if="groups.length === 0" class="empty-state">
      <p>No inbound links found yet.</p>
    </div>

    <div v-for="group in groups" :key="group.targetUrl" class="group-card">
      <button class="group-header" @click="toggle(group.targetUrl)">
        <ChevronDown v-if="expanded.has(group.targetUrl)" :size="14" />
        <ChevronRight v-else :size="14" />
        <a
          :href="group.targetUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="target-url"
          @click.stop
        >{{ truncateUrl(group.targetUrl, 80) }}</a>
        <div class="group-stats">
          <span class="stat">{{ group.inboundCount }} links</span>
          <span class="stat">{{ group.uniqueSources }} sources</span>
        </div>
      </button>

      <div v-if="expanded.has(group.targetUrl)" class="group-body">
        <div class="anchor-distribution">
          <div class="section-label">Anchor text distribution</div>
          <div
            v-for="entry in anchorEntries(group.anchorDistribution, group.inboundCount)"
            :key="entry.anchor"
            class="anchor-row"
          >
            <div class="anchor-label" :title="entry.anchor">{{ entry.anchor }}</div>
            <div class="anchor-bar-wrap">
              <div class="anchor-bar" :style="{ width: `${entry.pct}%` }"></div>
            </div>
            <div class="anchor-count">{{ entry.count }} ({{ entry.pct }}%)</div>
          </div>
        </div>

        <div class="sources-list">
          <div class="section-label">Source pages ({{ group.sources.length }})</div>
          <table class="sources-table">
            <thead>
              <tr>
                <th>Source URL</th>
                <th>Anchor(s)</th>
                <th>Rel</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="src in group.sources" :key="src.sourceUrl">
                <td :title="src.sourceUrl">
                  <a :href="src.sourceUrl" target="_blank" rel="noopener noreferrer">
                    {{ truncateUrl(src.sourceUrl, 60) }}
                  </a>
                </td>
                <td :title="src.anchorTexts.join(' | ')">
                  {{ src.anchorTexts.slice(0, 3).join(', ') }}{{ src.anchorTexts.length > 3 ? ` (+${src.anchorTexts.length - 3})` : '' }}
                </td>
                <td>{{ src.rels.join(', ') || '-' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.grouped-view {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px;
  overflow-y: auto;
}

.empty-state {
  text-align: center;
  color: var(--text-muted);
  padding: 32px;
}

.group-card {
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 4px;
  overflow: hidden;
}

.group-header {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 10px 12px;
  background: transparent;
  border: none;
  cursor: pointer;
  color: var(--text-primary);
  text-align: left;
}

.group-header:hover {
  background: var(--bg-tertiary);
}

.target-url {
  flex: 1;
  font-family: 'SF Mono', Monaco, monospace;
  font-size: 12px;
  color: var(--info);
  text-decoration: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.target-url:hover {
  text-decoration: underline;
}

.group-stats {
  display: flex;
  gap: 12px;
  font-size: 11px;
  color: var(--text-secondary);
}

.stat {
  padding: 2px 8px;
  background: var(--bg-primary);
  border-radius: 3px;
}

.group-body {
  padding: 12px;
  border-top: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.section-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 6px;
}

.anchor-row {
  display: grid;
  grid-template-columns: 180px 1fr 90px;
  gap: 8px;
  align-items: center;
  font-size: 12px;
  padding: 3px 0;
}

.anchor-label {
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.anchor-bar-wrap {
  background: var(--bg-primary);
  border-radius: 3px;
  height: 10px;
  overflow: hidden;
}

.anchor-bar {
  height: 100%;
  background: var(--accent);
}

.anchor-count {
  font-size: 11px;
  color: var(--text-secondary);
  text-align: right;
  font-family: 'SF Mono', Monaco, monospace;
}

.sources-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.sources-table th {
  background: var(--bg-primary);
  padding: 6px 10px;
  text-align: left;
  font-size: 11px;
  color: var(--text-secondary);
  font-weight: 600;
}

.sources-table td {
  padding: 6px 10px;
  border-top: 1px solid var(--border);
  color: var(--text-primary);
}

.sources-table a {
  color: var(--info);
  text-decoration: none;
  font-family: 'SF Mono', Monaco, monospace;
  font-size: 11px;
}

.sources-table a:hover {
  text-decoration: underline;
}
</style>
