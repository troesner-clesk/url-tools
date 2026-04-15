<script setup lang="ts">
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type Simulation,
} from 'd3-force'
import {
  ChevronLeft,
  ChevronRight as ChevronRightIcon,
  RefreshCw,
} from 'lucide-vue-next'

interface InboundLink {
  sourceUrl: string
  targetUrl: string
  anchorText: string
  rel: string
  sourceStatus: number
  depth: number
}

interface SimNode {
  id: string
  label: string
  inboundCount: number
  outboundCount: number
  isTarget: boolean
  isRoot: boolean
  isSynthetic: boolean
  depth: number
  x?: number
  y?: number
  fx?: number | null
  fy?: number | null
}

interface SimEdge {
  source: SimNode | string
  target: SimNode | string
  kind: 'hierarchy' | 'link'
  anchorText?: string
}

const props = defineProps<{
  results: InboundLink[]
  targets: string[]
}>()

const emit = defineEmits<{ nodeClick: [url: string] }>()

// --- UI state ---
const svgEl = ref<SVGSVGElement | null>(null)
const containerEl = ref<HTMLElement | null>(null)
const width = ref(800)
const height = ref(600)
const transform = ref({ x: 0, y: 0, k: 1 })
const hovered = ref<SimNode | null>(null)
const hoverPos = ref({ x: 0, y: 0 })
const pinnedId = ref<string | null>(null)
const sidebarOpen = ref(true)

// --- Controls ---
type SizeMode = 'inbound' | 'outbound' | 'equal'
type LinkEdgeMode = 'hover' | 'always' | 'hidden'
type LabelMode = 'always' | 'hover' | 'never'

const sizeMode = ref<SizeMode>('inbound')
const linkEdgeMode = ref<LinkEdgeMode>('hover')
const labelMode = ref<LabelMode>('hover')
const showHierarchy = ref(true)
const zoomPct = ref(100)
const showTargets = ref(true)
const showHotNodes = ref(true)
const showHubs = ref(true)
const showOrphans = ref(true)

watch(zoomPct, (v) => {
  transform.value = { ...transform.value, k: v / 100 }
})

// --- Data stores ---
const targetSet = computed(() => new Set(props.targets))
const nodeById = new Map<string, SimNode>()
const nodes = ref<SimNode[]>([])
const hierarchyEdges = ref<SimEdge[]>([])
const linkEdges = ref<SimEdge[]>([])
let sim: Simulation<SimNode, SimEdge> | null = null

// resolveParentId / pathDepth are auto-imported from app/utils/graph-hierarchy.ts

// --- Adjacency (uses BOTH hierarchy and link edges) ---
const adjacency = computed(() => {
  const neighbors = new Map<string, Set<string>>()
  const addEdge = (a: string, b: string) => {
    if (!neighbors.has(a)) neighbors.set(a, new Set())
    if (!neighbors.has(b)) neighbors.set(b, new Set())
    neighbors.get(a)!.add(b)
    neighbors.get(b)!.add(a)
  }
  for (const r of props.results) addEdge(r.sourceUrl, r.targetUrl)
  for (const e of hierarchyEdges.value) {
    const s = typeof e.source === 'object' ? e.source.id : e.source
    const t = typeof e.target === 'object' ? e.target.id : e.target
    addEdge(s, t)
  }
  return neighbors
})

const thresholds = computed(() => {
  const nonSynthetic = nodes.value.filter((n) => !n.isSynthetic)
  const inboundCounts = nonSynthetic
    .map((n) => n.inboundCount)
    .sort((a, b) => b - a)
  const outboundCounts = nonSynthetic
    .map((n) => n.outboundCount)
    .sort((a, b) => b - a)
  const topIdx = Math.max(0, Math.floor(nonSynthetic.length * 0.1) - 1)
  return {
    hotInbound: inboundCounts[topIdx] ?? 0,
    hotOutbound: outboundCounts[topIdx] ?? 0,
  }
})

type Category = 'root' | 'target' | 'hot' | 'hub' | 'orphan' | 'default'

function nodeCategory(n: SimNode): Category {
  if (n.isRoot) return 'root'
  if (n.isTarget) return 'target'
  if (
    n.inboundCount > 0 &&
    n.inboundCount >= thresholds.value.hotInbound &&
    thresholds.value.hotInbound > 0
  )
    return 'hot'
  if (
    n.outboundCount > 0 &&
    n.outboundCount >= thresholds.value.hotOutbound &&
    thresholds.value.hotOutbound > 0
  )
    return 'hub'
  if (n.inboundCount === 0) return 'orphan'
  return 'default'
}

function isCategoryVisible(cat: Category): boolean {
  if (cat === 'target') return showTargets.value
  if (cat === 'hot') return showHotNodes.value
  if (cat === 'hub') return showHubs.value
  if (cat === 'orphan') return showOrphans.value
  return true // root and default always visible
}

function nodeColor(n: SimNode): string {
  const cat = nodeCategory(n)
  if (cat === 'root') return '#6cbf3f'
  if (cat === 'target') return 'var(--accent)'
  if (cat === 'hot') return '#f5a623'
  if (cat === 'hub') return '#9c27b0'
  if (cat === 'orphan') return 'var(--text-muted)'
  return 'var(--info)'
}

function nodeRadius(n: SimNode): number {
  if (n.isRoot) return 16
  const base = 4
  if (sizeMode.value === 'equal') return n.isTarget ? base + 6 : base + 2
  const count = sizeMode.value === 'inbound' ? n.inboundCount : n.outboundCount
  const scaled = Math.log2(count + 1) * 3
  return base + Math.min(scaled, 22) + (n.isTarget ? 4 : 0)
}

// --- Graph rebuild ---
function rebuildGraph() {
  const seen = new Set<string>()

  // 1. Seed nodes from real link data
  const realIds = new Set<string>()
  for (const r of props.results) {
    realIds.add(r.sourceUrl)
    realIds.add(r.targetUrl)
  }

  // 2. Inject synthetic origin roots
  const origins = new Set<string>()
  for (const id of realIds) {
    try {
      origins.add(new URL(id).origin)
    } catch {}
  }
  for (const origin of origins) {
    realIds.add(`${origin}/`)
  }

  // 3. Ensure nodes exist
  for (const id of realIds) {
    ensureNode(id, seen)
  }

  // 4. Recompute flags + counts
  for (const n of nodeById.values()) {
    n.inboundCount = 0
    n.outboundCount = 0
    n.isTarget = targetSet.value.has(n.id)
    n.depth = pathDepth(n.id)
    n.isRoot = n.depth === 0
    n.isSynthetic = n.isRoot && !props.results.some(
      (r) => r.sourceUrl === n.id || r.targetUrl === n.id,
    )
  }
  for (const r of props.results) {
    const src = nodeById.get(r.sourceUrl)
    const tgt = nodeById.get(r.targetUrl)
    if (src) src.outboundCount++
    if (tgt) tgt.inboundCount++
  }

  // 5. Remove stale nodes
  for (const id of Array.from(nodeById.keys())) {
    if (!seen.has(id)) nodeById.delete(id)
  }

  // 6. Build hierarchy edges (path-based parent links)
  const nodeIds = new Set(nodeById.keys())
  const hEdges: SimEdge[] = []
  for (const id of nodeIds) {
    const parent = resolveParentId(id, nodeIds)
    if (parent) {
      hEdges.push({ source: parent, target: id, kind: 'hierarchy' })
    }
  }

  // 7. Build link edges from actual <a> inbound data
  const lEdges: SimEdge[] = props.results.map((r) => ({
    source: r.sourceUrl,
    target: r.targetUrl,
    kind: 'link',
    anchorText: r.anchorText,
  }))

  const nodeList = Array.from(nodeById.values())
  nodes.value = nodeList
  hierarchyEdges.value = hEdges
  linkEdges.value = lEdges

  if (sim) {
    sim.nodes(nodeList)
    const linkForce =
      sim.force<ReturnType<typeof forceLink<SimNode, SimEdge>>>('link')
    // Simulation is driven by HIERARCHY edges only — this is what yields the
    // tree-like SEORCH layout. Link edges are visual overlays.
    if (linkForce) linkForce.links(hEdges)
    sim.alpha(0.6).restart()
  }
}

function ensureNode(id: string, seen: Set<string>) {
  seen.add(id)
  if (nodeById.has(id)) return
  nodeById.set(id, {
    id,
    label: shortLabel(id),
    inboundCount: 0,
    outboundCount: 0,
    isTarget: targetSet.value.has(id),
    isRoot: false,
    isSynthetic: false,
    depth: pathDepth(id),
  })
}

function shortLabel(url: string): string {
  try {
    const u = new URL(url)
    const path = u.pathname.replace(/\/+$/, '')
    if (!path) return u.hostname
    const last = path.split('/').filter(Boolean).slice(-1)[0]
    return last || u.hostname
  } catch {
    return url
  }
}

// --- Active node highlighting ---
const activeId = computed(() => pinnedId.value ?? hovered.value?.id ?? null)

const connectedIds = computed<Set<string> | null>(() => {
  if (!activeId.value) return null
  const set = new Set<string>([activeId.value])
  const neigh = adjacency.value.get(activeId.value)
  if (neigh) for (const id of neigh) set.add(id)
  return set
})

function isNodeDimmed(n: SimNode): boolean {
  if (!isCategoryVisible(nodeCategory(n))) return true
  if (!connectedIds.value) return false
  return !connectedIds.value.has(n.id)
}

// --- Edge visibility ---
const renderedHierarchyEdges = computed<SimEdge[]>(() => {
  if (!showHierarchy.value && !activeId.value) return []
  if (activeId.value) {
    return hierarchyEdges.value.filter((e) => {
      const s = typeof e.source === 'object' ? e.source.id : e.source
      const t = typeof e.target === 'object' ? e.target.id : e.target
      return s === activeId.value || t === activeId.value
    })
  }
  return hierarchyEdges.value
})

const renderedLinkEdges = computed<SimEdge[]>(() => {
  if (linkEdgeMode.value === 'hidden' && !activeId.value) return []
  if (activeId.value) {
    return linkEdges.value.filter((e) => {
      const s = typeof e.source === 'object' ? e.source.id : e.source
      const t = typeof e.target === 'object' ? e.target.id : e.target
      return s === activeId.value || t === activeId.value
    })
  }
  if (linkEdgeMode.value === 'always') return linkEdges.value
  return []
})

// --- Edge endpoints ---
// Link edges aren't bound to the simulation; we must resolve endpoints
// against the current node positions manually.
function edgeEndpoint(
  e: SimEdge,
  which: 'source' | 'target',
): { x: number; y: number } | null {
  const ref = e[which]
  if (typeof ref === 'object') {
    return { x: ref.x ?? 0, y: ref.y ?? 0 }
  }
  const n = nodeById.get(ref)
  return n ? { x: n.x ?? 0, y: n.y ?? 0 } : null
}

// --- Stats ---
const stats = computed(() => {
  const nonSynthetic = nodes.value.filter((n) => !n.isSynthetic)
  const targets = nonSynthetic.filter((n) => n.isTarget)
  const orphans = nonSynthetic.filter((n) => n.inboundCount === 0 && !n.isTarget)
  const hubs = nonSynthetic.filter(
    (n) =>
      n.outboundCount > 0 &&
      thresholds.value.hotOutbound > 0 &&
      n.outboundCount >= thresholds.value.hotOutbound,
  )
  const maxInbound = nonSynthetic.reduce(
    (best, n) => (n.inboundCount > (best?.inboundCount ?? -1) ? n : best),
    null as SimNode | null,
  )
  return {
    nodeCount: nonSynthetic.length,
    edgeCount: linkEdges.value.length,
    targetCount: targets.length,
    orphanCount: orphans.length,
    hubCount: hubs.length,
    topTarget: maxInbound,
  }
})

// --- Simulation lifecycle ---
onMounted(() => {
  updateSize()
  window.addEventListener('resize', updateSize)
  sim = forceSimulation<SimNode, SimEdge>([])
    .force(
      'link',
      forceLink<SimNode, SimEdge>([])
        .id((d) => d.id)
        // Children cluster close to parents; tune for radial bursts.
        .distance((e) => {
          const src = typeof e.source === 'object' ? e.source : null
          // Short distance from root to level-1, slightly longer deeper down
          return src && src.isRoot ? 70 : 50
        })
        .strength(0.8),
    )
    .force('charge', forceManyBody().strength(-180))
    .force('center', forceCenter(width.value / 2, height.value / 2))
    .force(
      'collide',
      forceCollide<SimNode>().radius((d) => nodeRadius(d) + 3),
    )
    .on('tick', () => {
      // Shallow-copy to trigger Vue reactivity on position changes
      nodes.value = [...nodes.value]
    })
  rebuildGraph()
})

onBeforeUnmount(() => {
  if (sim) sim.stop()
  window.removeEventListener('resize', updateSize)
})

let rebuildTimer: ReturnType<typeof setTimeout> | null = null
watch(
  () => props.results.length,
  () => {
    if (rebuildTimer) clearTimeout(rebuildTimer)
    rebuildTimer = setTimeout(() => {
      rebuildGraph()
      rebuildTimer = null
    }, 300)
  },
)

watch(sizeMode, () => {
  if (sim) {
    sim.force(
      'collide',
      forceCollide<SimNode>().radius((d) => nodeRadius(d) + 3),
    )
    sim.alpha(0.3).restart()
  }
})

function updateSize() {
  if (containerEl.value) {
    width.value = containerEl.value.clientWidth
    height.value = containerEl.value.clientHeight
    sim?.force('center', forceCenter(width.value / 2, height.value / 2))
  }
}

// --- Pan/zoom ---
let panning = false
let panStart = { x: 0, y: 0, tx: 0, ty: 0 }

function onWheel(e: WheelEvent) {
  e.preventDefault()
  const delta = -e.deltaY * 0.0015
  const newK = Math.min(Math.max(transform.value.k * (1 + delta), 0.2), 5)
  transform.value = { ...transform.value, k: newK }
  zoomPct.value = Math.round(newK * 100)
}

function onSvgMouseDown(e: MouseEvent) {
  const target = e.target as Element
  if (target === svgEl.value || target.tagName === 'svg' || target.tagName === 'g') {
    panning = true
    panStart = {
      x: e.clientX,
      y: e.clientY,
      tx: transform.value.x,
      ty: transform.value.y,
    }
    pinnedId.value = null
  }
}

function onSvgMouseMove(e: MouseEvent) {
  if (panning) {
    transform.value = {
      ...transform.value,
      x: panStart.tx + (e.clientX - panStart.x),
      y: panStart.ty + (e.clientY - panStart.y),
    }
  }
  if (hovered.value) {
    hoverPos.value = { x: e.clientX, y: e.clientY }
  }
}

function onSvgMouseUp() {
  panning = false
}

function onNodeEnter(n: SimNode, e: MouseEvent) {
  hovered.value = n
  hoverPos.value = { x: e.clientX, y: e.clientY }
}

function onNodeLeave() {
  hovered.value = null
}

function onNodeClick(n: SimNode) {
  pinnedId.value = pinnedId.value === n.id ? null : n.id
  emit('nodeClick', n.id)
}

function resetView() {
  transform.value = { x: 0, y: 0, k: 1 }
  zoomPct.value = 100
  pinnedId.value = null
  if (sim) sim.alpha(0.8).restart()
}

function toggleSidebar() {
  sidebarOpen.value = !sidebarOpen.value
}

function catLabel(n: SimNode): string {
  const cat = nodeCategory(n)
  if (cat === 'root') return 'Root'
  if (cat === 'target') return 'Target'
  if (cat === 'hot') return 'Top inbound'
  if (cat === 'hub') return 'Hub (top outbound)'
  if (cat === 'orphan') return 'No inbound'
  return 'Regular'
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`
}
</script>

<template>
  <ClientOnly>
    <div class="graph-root">
      <!-- Sidebar -->
      <aside class="graph-sidebar" :class="{ closed: !sidebarOpen }">
        <div class="sidebar-header">
          <h3 v-if="sidebarOpen">Graph controls</h3>
          <button class="btn-icon" @click="toggleSidebar" :title="sidebarOpen ? 'Hide controls' : 'Show controls'">
            <ChevronLeft v-if="sidebarOpen" :size="14" />
            <ChevronRightIcon v-else :size="14" />
          </button>
        </div>

        <div v-if="sidebarOpen" class="sidebar-content">
          <section>
            <div class="section-label">Zoom <span class="zoom-val">{{ zoomPct }}%</span></div>
            <input type="range" min="20" max="400" step="5" v-model.number="zoomPct" class="slider" />
            <button class="btn-secondary full" @click="resetView">
              <RefreshCw :size="12" /> Reset view
            </button>
          </section>

          <section>
            <div class="section-label">Layout</div>
            <label class="check-line">
              <input type="checkbox" v-model="showHierarchy" />
              Path hierarchy <span class="count">({{ hierarchyEdges.length }})</span>
            </label>
            <div class="hint-text">
              Structural tree based on URL paths (e.g. /wiki → /wiki/griff). Always visible unless disabled.
            </div>
          </section>

          <section>
            <div class="section-label">Node size based on</div>
            <label class="radio-line">
              <input type="radio" v-model="sizeMode" value="inbound" /> Inbound links
            </label>
            <label class="radio-line">
              <input type="radio" v-model="sizeMode" value="outbound" /> Outbound links
            </label>
            <label class="radio-line">
              <input type="radio" v-model="sizeMode" value="equal" /> Equal
            </label>
          </section>

          <section>
            <div class="section-label">Link connections</div>
            <label class="radio-line">
              <input type="radio" v-model="linkEdgeMode" value="hover" /> On hover only
            </label>
            <label class="radio-line">
              <input type="radio" v-model="linkEdgeMode" value="always" /> Always visible
            </label>
            <label class="radio-line">
              <input type="radio" v-model="linkEdgeMode" value="hidden" /> Hidden
            </label>
            <div class="hint-text">
              Actual &lt;a&gt; links between pages. Default is hover-only to keep the graph readable.
            </div>
          </section>

          <section>
            <div class="section-label">Labels</div>
            <label class="radio-line">
              <input type="radio" v-model="labelMode" value="always" /> Always
            </label>
            <label class="radio-line">
              <input type="radio" v-model="labelMode" value="hover" /> On hover / pinned
            </label>
            <label class="radio-line">
              <input type="radio" v-model="labelMode" value="never" /> Never
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
              <input type="checkbox" v-model="showTargets" />
              <span class="dot" style="background: var(--accent)" />
              Targets <span class="count">({{ stats.targetCount }})</span>
            </label>
            <label class="check-line">
              <input type="checkbox" v-model="showHotNodes" />
              <span class="dot" style="background: #f5a623" />
              Top 10% inbound
            </label>
            <label class="check-line">
              <input type="checkbox" v-model="showHubs" />
              <span class="dot" style="background: #9c27b0" />
              Hubs <span class="count">({{ stats.hubCount }})</span>
            </label>
            <label class="check-line">
              <input type="checkbox" v-model="showOrphans" />
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

      <!-- Canvas -->
      <div ref="containerEl" class="graph-canvas">
        <svg
          ref="svgEl"
          class="graph-svg"
          :viewBox="`0 0 ${width} ${height}`"
          @wheel="onWheel"
          @mousedown="onSvgMouseDown"
          @mousemove="onSvgMouseMove"
          @mouseup="onSvgMouseUp"
          @mouseleave="onSvgMouseUp"
        >
          <g :transform="`translate(${transform.x} ${transform.y}) scale(${transform.k})`">
            <!-- Hierarchy edges (structural backbone, always subtle) -->
            <g class="edges edges-hierarchy">
              <line
                v-for="(e, i) in renderedHierarchyEdges"
                :key="`h${i}`"
                :x1="edgeEndpoint(e, 'source')?.x ?? 0"
                :y1="edgeEndpoint(e, 'source')?.y ?? 0"
                :x2="edgeEndpoint(e, 'target')?.x ?? 0"
                :y2="edgeEndpoint(e, 'target')?.y ?? 0"
                :class="{ 'edge-active': !!activeId }"
              />
            </g>

            <!-- Link edges (actual <a> hrefs, accent color) -->
            <g class="edges edges-link">
              <line
                v-for="(e, i) in renderedLinkEdges"
                :key="`l${i}`"
                :x1="edgeEndpoint(e, 'source')?.x ?? 0"
                :y1="edgeEndpoint(e, 'source')?.y ?? 0"
                :x2="edgeEndpoint(e, 'target')?.x ?? 0"
                :y2="edgeEndpoint(e, 'target')?.y ?? 0"
                :class="{ 'edge-active': !!activeId }"
              />
            </g>

            <g class="nodes">
              <g
                v-for="n in nodes"
                :key="n.id"
                :transform="`translate(${n.x ?? 0} ${n.y ?? 0})`"
                :class="{
                  'node-dim': isNodeDimmed(n),
                  'node-hidden': !isCategoryVisible(nodeCategory(n)),
                  'node-pinned': pinnedId === n.id,
                }"
                @mouseenter="(ev) => onNodeEnter(n, ev)"
                @mouseleave="onNodeLeave"
                @click="onNodeClick(n)"
              >
                <circle
                  :r="nodeRadius(n)"
                  :fill="nodeColor(n)"
                  :class="{ 'node-target': n.isTarget, 'node-root': n.isRoot }"
                />
                <text
                  v-if="n.isRoot || labelMode === 'always' || (labelMode === 'hover' && (hovered?.id === n.id || pinnedId === n.id || connectedIds?.has(n.id)))"
                  :y="nodeRadius(n) + 12"
                  text-anchor="middle"
                  class="node-label"
                  :class="{ 'label-root': n.isRoot }"
                >{{ n.label }}</text>
              </g>
            </g>
          </g>
        </svg>

        <div
          v-if="hovered"
          class="tooltip"
          :style="{ left: `${hoverPos.x + 14}px`, top: `${hoverPos.y + 14}px` }"
        >
          <div class="tooltip-url">{{ hovered.id }}</div>
          <div class="tooltip-meta">
            <span class="badge" :style="{ background: nodeColor(hovered) }">{{ catLabel(hovered) }}</span>
            <span>{{ hovered.inboundCount }} in · {{ hovered.outboundCount }} out</span>
          </div>
          <div class="tooltip-hint">Click to pin</div>
        </div>

        <div v-if="pinnedId" class="pinned-hint">
          Pinned: {{ truncate(pinnedId, 60) }} · click background to unpin
        </div>
      </div>
    </div>
  </ClientOnly>
</template>

<style scoped>
.graph-root {
  display: grid;
  grid-template-columns: auto 1fr;
  height: 100%;
  overflow: hidden;
  background: var(--bg-primary);
}

.graph-sidebar {
  width: 240px;
  background: var(--bg-secondary);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition: width 0.2s ease;
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

.graph-canvas {
  position: relative;
  overflow: hidden;
}

.graph-svg {
  width: 100%;
  height: 100%;
  cursor: grab;
  user-select: none;
  display: block;
}

.graph-svg:active {
  cursor: grabbing;
}

/* Hierarchy edges — always visible as structural backbone */
.edges-hierarchy line {
  stroke: var(--border);
  stroke-opacity: 0.45;
  stroke-width: 1;
  pointer-events: none;
  transition: stroke-opacity 0.15s;
}

.edges-hierarchy line.edge-active {
  stroke: var(--text-secondary);
  stroke-opacity: 0.85;
  stroke-width: 1.4;
}

/* Link edges — accent-colored, on hover or always */
.edges-link line {
  stroke: var(--accent);
  stroke-opacity: 0.35;
  stroke-width: 1;
  pointer-events: none;
  stroke-dasharray: 3 3;
  transition: stroke-opacity 0.15s;
}

.edges-link line.edge-active {
  stroke: var(--accent);
  stroke-opacity: 0.9;
  stroke-width: 1.6;
  stroke-dasharray: none;
}

.nodes g {
  cursor: pointer;
  transition: opacity 0.15s;
}

.nodes g.node-dim {
  opacity: 0.15;
}

.nodes g.node-hidden {
  display: none;
}

.nodes g.node-pinned circle {
  stroke: var(--accent);
  stroke-width: 3;
}

.nodes circle {
  stroke: var(--bg-primary);
  stroke-width: 1.5;
  transition: stroke-width 0.15s;
}

.nodes g:hover circle {
  stroke: var(--accent);
  stroke-width: 2.5;
}

.node-target {
  filter: drop-shadow(0 0 6px var(--accent));
}

.node-root {
  filter: drop-shadow(0 0 8px #6cbf3f);
}

.node-label {
  font-size: 10px;
  fill: var(--text-secondary);
  font-family: system-ui, sans-serif;
  pointer-events: none;
  paint-order: stroke;
  stroke: var(--bg-primary);
  stroke-width: 3;
}

.label-root {
  font-size: 12px;
  font-weight: 700;
  fill: var(--text-primary);
}

.tooltip {
  position: fixed;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 5px;
  padding: 8px 12px;
  font-size: 12px;
  max-width: 420px;
  pointer-events: none;
  z-index: 100;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.25);
}

.tooltip-url {
  font-family: 'SF Mono', Monaco, monospace;
  font-size: 11px;
  color: var(--text-primary);
  word-break: break-all;
}

.tooltip-meta {
  margin-top: 6px;
  display: flex;
  gap: 8px;
  align-items: center;
  color: var(--text-secondary);
  font-size: 11px;
}

.badge {
  color: #fff;
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 10px;
  font-weight: 600;
}

.tooltip-hint {
  margin-top: 4px;
  font-size: 10px;
  color: var(--text-muted);
  font-style: italic;
}

.pinned-hint {
  position: absolute;
  bottom: 10px;
  left: 10px;
  padding: 6px 10px;
  background: var(--bg-secondary);
  border: 1px solid var(--accent);
  border-radius: 4px;
  font-size: 11px;
  color: var(--text-primary);
  font-family: 'SF Mono', Monaco, monospace;
  max-width: 60%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}
</style>
