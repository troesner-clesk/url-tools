<script setup lang="ts">
import {
  ChevronLeft,
  ChevronRight as ChevronRightIcon,
  RefreshCw,
} from 'lucide-vue-next'
import type {
  GraphStats,
  LabelMode,
  LinkEdgeMode,
  SizeMode,
} from '../utils/graph-types'

defineProps<{
  open: boolean
  zoomPct: number
  sizeMode: SizeMode
  linkEdgeMode: LinkEdgeMode
  labelMode: LabelMode
  showHierarchy: boolean
  showTargets: boolean
  showHotNodes: boolean
  showHubs: boolean
  showOrphans: boolean
  hierarchyEdgeCount: number
  stats: GraphStats
}>()

defineEmits<{
  'update:open': [value: boolean]
  'update:zoomPct': [value: number]
  'update:sizeMode': [value: SizeMode]
  'update:linkEdgeMode': [value: LinkEdgeMode]
  'update:labelMode': [value: LabelMode]
  'update:showHierarchy': [value: boolean]
  'update:showTargets': [value: boolean]
  'update:showHotNodes': [value: boolean]
  'update:showHubs': [value: boolean]
  'update:showOrphans': [value: boolean]
  reset: []
}>()

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`
}
</script>

<template>
  <aside class="graph-sidebar" :class="{ closed: !open }">
    <div class="sidebar-header">
      <h3 v-if="open">Graph controls</h3>
      <button
        class="btn-icon"
        :title="open ? 'Hide controls' : 'Show controls'"
        @click="$emit('update:open', !open)"
      >
        <ChevronLeft v-if="open" :size="14" />
        <ChevronRightIcon v-else :size="14" />
      </button>
    </div>

    <div v-if="open" class="sidebar-content">
      <section>
        <div class="section-label">Zoom <span class="zoom-val">{{ zoomPct }}%</span></div>
        <input
          type="range"
          min="20"
          max="400"
          step="5"
          :value="zoomPct"
          class="slider"
          @input="$emit('update:zoomPct', Number(($event.target as HTMLInputElement).value))"
        />
        <button class="btn-secondary full" @click="$emit('reset')">
          <RefreshCw :size="12" /> Reset view
        </button>
      </section>

      <section>
        <div class="section-label">Layout</div>
        <label class="check-line">
          <input
            type="checkbox"
            :checked="showHierarchy"
            @change="$emit('update:showHierarchy', ($event.target as HTMLInputElement).checked)"
          />
          Path hierarchy <span class="count">({{ hierarchyEdgeCount }})</span>
        </label>
        <div class="hint-text">
          Structural tree based on URL paths (e.g. /wiki → /wiki/griff). Always visible unless disabled.
        </div>
      </section>

      <section>
        <div class="section-label">Node size based on</div>
        <label class="radio-line">
          <input
            type="radio"
            :checked="sizeMode === 'inbound'"
            @change="$emit('update:sizeMode', 'inbound')"
          /> Inbound links
        </label>
        <label class="radio-line">
          <input
            type="radio"
            :checked="sizeMode === 'outbound'"
            @change="$emit('update:sizeMode', 'outbound')"
          /> Outbound links
        </label>
        <label class="radio-line">
          <input
            type="radio"
            :checked="sizeMode === 'equal'"
            @change="$emit('update:sizeMode', 'equal')"
          /> Equal
        </label>
      </section>

      <section>
        <div class="section-label">Link connections</div>
        <label class="radio-line">
          <input
            type="radio"
            :checked="linkEdgeMode === 'hover'"
            @change="$emit('update:linkEdgeMode', 'hover')"
          /> On hover only
        </label>
        <label class="radio-line">
          <input
            type="radio"
            :checked="linkEdgeMode === 'always'"
            @change="$emit('update:linkEdgeMode', 'always')"
          /> Always visible
        </label>
        <label class="radio-line">
          <input
            type="radio"
            :checked="linkEdgeMode === 'hidden'"
            @change="$emit('update:linkEdgeMode', 'hidden')"
          /> Hidden
        </label>
        <div class="hint-text">
          Actual &lt;a&gt; links between pages. Default is hover-only to keep the graph readable.
        </div>
      </section>

      <section>
        <div class="section-label">Labels</div>
        <label class="radio-line">
          <input
            type="radio"
            :checked="labelMode === 'always'"
            @change="$emit('update:labelMode', 'always')"
          /> Always
        </label>
        <label class="radio-line">
          <input
            type="radio"
            :checked="labelMode === 'hover'"
            @change="$emit('update:labelMode', 'hover')"
          /> On hover / pinned
        </label>
        <label class="radio-line">
          <input
            type="radio"
            :checked="labelMode === 'never'"
            @change="$emit('update:labelMode', 'never')"
          /> Never
        </label>
      </section>

      <section>
        <div class="section-label">Show categories</div>
        <label class="check-line">
          <input type="checkbox" checked disabled />
          <span class="dot" style="background: #6cbf3f" />
          Root <span class="count">(always)</span>
        </label>
        <label class="check-line">
          <input
            type="checkbox"
            :checked="showTargets"
            @change="$emit('update:showTargets', ($event.target as HTMLInputElement).checked)"
          />
          <span class="dot" style="background: var(--accent)" />
          Targets <span class="count">({{ stats.targetCount }})</span>
        </label>
        <label class="check-line">
          <input
            type="checkbox"
            :checked="showHotNodes"
            @change="$emit('update:showHotNodes', ($event.target as HTMLInputElement).checked)"
          />
          <span class="dot" style="background: #f5a623" />
          Top 10% inbound
        </label>
        <label class="check-line">
          <input
            type="checkbox"
            :checked="showHubs"
            @change="$emit('update:showHubs', ($event.target as HTMLInputElement).checked)"
          />
          <span class="dot" style="background: #9c27b0" />
          Hubs <span class="count">({{ stats.hubCount }})</span>
        </label>
        <label class="check-line">
          <input
            type="checkbox"
            :checked="showOrphans"
            @change="$emit('update:showOrphans', ($event.target as HTMLInputElement).checked)"
          />
          <span class="dot" style="background: var(--text-muted)" />
          No inbound <span class="count">({{ stats.orphanCount }})</span>
        </label>
      </section>

      <section>
        <div class="section-label">Statistics</div>
        <div class="stat-row"><span>Nodes</span><span>{{ stats.nodeCount }}</span></div>
        <div class="stat-row"><span>Link edges</span><span>{{ stats.edgeCount }}</span></div>
        <div class="stat-row"><span>Targets</span><span>{{ stats.targetCount }}</span></div>
        <div class="stat-row"><span>Orphans</span><span>{{ stats.orphanCount }}</span></div>
        <div class="stat-row"><span>Hubs</span><span>{{ stats.hubCount }}</span></div>
        <div v-if="stats.topTarget" class="top-target">
          <div class="section-sublabel">Most-linked page</div>
          <div class="top-target-url" :title="stats.topTarget.id">
            {{ truncate(stats.topTarget.id, 40) }}
          </div>
          <div class="top-target-count">{{ stats.topTarget.inboundCount }} inbound</div>
        </div>
      </section>
    </div>
  </aside>
</template>

<style scoped>
.graph-sidebar {
  width: 240px;
  background: var(--bg-secondary);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition: width 0.2s ease;
  flex-shrink: 0;
}

.graph-sidebar.closed {
  width: 32px;
}

.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-tertiary);
  flex-shrink: 0;
}

.sidebar-header h3 {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin: 0;
}

.btn-icon {
  padding: 4px;
  background: transparent;
  border: none;
  border-radius: 3px;
  color: var(--text-secondary);
  cursor: pointer;
  display: flex;
}

.btn-icon:hover {
  background: var(--bg-primary);
  color: var(--text-primary);
}

.sidebar-content {
  overflow-y: auto;
  padding: 10px 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.sidebar-content section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.section-label {
  font-size: 10px;
  font-weight: 700;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.6px;
  margin-bottom: 4px;
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}

.section-sublabel {
  font-size: 10px;
  color: var(--text-muted);
  margin-top: 6px;
  margin-bottom: 2px;
}

.hint-text {
  font-size: 10px;
  color: var(--text-muted);
  line-height: 1.4;
  margin-top: 4px;
  font-style: italic;
}

.zoom-val {
  font-weight: 500;
  color: var(--text-primary);
  font-family: 'SF Mono', Monaco, monospace;
  text-transform: none;
}

.slider {
  width: 100%;
  margin: 4px 0;
  accent-color: var(--accent);
}

.radio-line,
.check-line {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-primary);
  cursor: pointer;
  padding: 2px 0;
}

.check-line input[disabled] {
  cursor: not-allowed;
}

.radio-line input,
.check-line input {
  margin: 0;
  accent-color: var(--accent);
}

.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  display: inline-block;
  flex-shrink: 0;
}

.count {
  color: var(--text-muted);
  font-size: 11px;
  margin-left: auto;
  font-family: 'SF Mono', Monaco, monospace;
}

.stat-row {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--text-primary);
  padding: 2px 0;
}

.stat-row span:last-child {
  font-family: 'SF Mono', Monaco, monospace;
  color: var(--text-secondary);
}

.top-target {
  margin-top: 6px;
  padding: 8px;
  background: var(--bg-primary);
  border-radius: 4px;
  border: 1px solid var(--border);
}

.top-target-url {
  font-family: 'SF Mono', Monaco, monospace;
  font-size: 11px;
  color: var(--info);
  word-break: break-all;
}

.top-target-count {
  font-size: 10px;
  color: var(--text-muted);
  margin-top: 2px;
}

.btn-secondary {
  padding: 6px 10px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border);
  border-radius: 3px;
  color: var(--text-primary);
  cursor: pointer;
  font-size: 11px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  justify-content: center;
}

.btn-secondary:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.btn-secondary.full {
  width: 100%;
  margin-top: 4px;
}
</style>
