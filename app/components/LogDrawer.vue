<script setup lang="ts">
import { ChevronRight, Loader, Terminal, Trash2, X } from 'lucide-vue-next'
import type { TabId } from '../composables/useLogStore'
import { useLogStore } from '../composables/useLogStore'

const TAB_LABELS: Record<TabId, string> = {
  scraper: 'Scraper',
  seo: 'SEO Audit',
  screenshots: 'Screenshots',
  images: 'Images',
  sitemap: 'Sitemap',
  'broken-links': 'Link Checker',
  silo: 'Silo',
}

const store = useLogStore()
const {
  activeTabId,
  drawerOpen,
  drawerWidth,
  currentLogs,
  currentProgress,
  currentUrlValue,
  currentIsRunning,
  anyRunning,
  toggleDrawer,
  setDrawerWidth,
  clearLogs,
  minWidth,
  maxWidth,
} = store

const logListEl = ref<HTMLElement | null>(null)

// Auto-scroll to bottom when new entries arrive
watch(
  () => currentLogs.value.length,
  () => {
    nextTick(() => {
      if (logListEl.value) {
        logListEl.value.scrollTop = logListEl.value.scrollHeight
      }
    })
  },
)

// Re-scroll when switching tabs
watch(activeTabId, () => {
  nextTick(() => {
    if (logListEl.value) {
      logListEl.value.scrollTop = logListEl.value.scrollHeight
    }
  })
})

// --- Resize ---
let resizing = false
let startX = 0
let startWidth = 0

function onResizeStart(e: MouseEvent) {
  e.preventDefault()
  resizing = true
  startX = e.clientX
  startWidth = drawerWidth.value
  document.addEventListener('mousemove', onResizeMove)
  document.addEventListener('mouseup', onResizeEnd)
  document.body.style.userSelect = 'none'
  document.body.style.cursor = 'col-resize'
}

function onResizeMove(e: MouseEvent) {
  if (!resizing) return
  // Drag handle is on the LEFT edge — moving left increases width
  const newWidth = startWidth + (startX - e.clientX)
  setDrawerWidth(newWidth)
}

function onResizeEnd() {
  resizing = false
  document.removeEventListener('mousemove', onResizeMove)
  document.removeEventListener('mouseup', onResizeEnd)
  document.body.style.userSelect = ''
  document.body.style.cursor = ''
}

onBeforeUnmount(() => {
  if (resizing) onResizeEnd()
})

const progressPct = computed(() => {
  const p = currentProgress.value
  if (p.total === 0) return 0
  return Math.min(100, Math.round((p.done / p.total) * 100))
})

function clearCurrent() {
  clearLogs(activeTabId.value)
}

function truncateUrl(url: string, max = 80): string {
  if (url.length <= max) return url
  return `${url.substring(0, max - 3)}...`
}
</script>

<template>
  <!-- Collapsed tab handle -->
  <button
    v-if="!drawerOpen"
    class="drawer-handle"
    :class="{ 'is-running': anyRunning }"
    @click="toggleDrawer"
    aria-label="Open log panel"
  >
    <Terminal :size="14" />
    <span class="handle-label">Log</span>
    <span v-if="anyRunning" class="pulse" />
  </button>

  <!-- Drawer -->
  <aside
    v-if="drawerOpen"
    class="log-drawer"
    :style="{ width: `${drawerWidth}px` }"
  >
    <div class="resize-handle" @mousedown="onResizeStart" />

    <header class="drawer-header">
      <div class="drawer-title">
        <Terminal :size="14" />
        <span>{{ TAB_LABELS[activeTabId] }}</span>
        <Loader v-if="currentIsRunning" :size="12" class="spin" />
      </div>
      <div class="drawer-actions">
        <button
          class="btn-icon"
          :disabled="currentLogs.length === 0"
          @click="clearCurrent"
          title="Clear log"
          aria-label="Clear log"
        >
          <Trash2 :size="13" />
        </button>
        <button
          class="btn-icon"
          @click="toggleDrawer"
          title="Close panel"
          aria-label="Close panel"
        >
          <X :size="14" />
        </button>
      </div>
    </header>

    <div
      v-if="currentProgress.total > 0 || currentUrlValue"
      class="drawer-status"
    >
      <div v-if="currentProgress.total > 0" class="progress">
        <div class="progress-bar">
          <div class="progress-fill" :style="{ width: `${progressPct}%` }" />
        </div>
        <div class="progress-text">
          {{ currentProgress.done }} / {{ currentProgress.total }}
        </div>
      </div>
      <div v-if="currentUrlValue" class="current-url" :title="currentUrlValue">
        <Loader v-if="currentIsRunning" :size="11" class="spin" />
        <ChevronRight v-else :size="11" />
        <span>{{ truncateUrl(currentUrlValue) }}</span>
      </div>
    </div>

    <div ref="logListEl" class="drawer-log-list">
      <div v-if="currentLogs.length === 0" class="log-empty">
        No log entries yet. Start an operation to see live output here.
      </div>
      <div
        v-for="(log, idx) in currentLogs"
        :key="idx"
        :class="['log-entry', `log-${log.type}`]"
      >
        <span class="log-time">{{ log.timestamp }}</span>
        <span class="log-message">{{ log.message }}</span>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.log-drawer {
  position: fixed;
  top: 60px;
  right: 0;
  bottom: 0;
  background: var(--bg-secondary);
  border-left: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  z-index: 90;
  box-shadow: -4px 0 12px rgba(0, 0, 0, 0.08);
  min-width: v-bind("minWidth + 'px'");
  max-width: v-bind("maxWidth + 'px'");
}

.resize-handle {
  position: absolute;
  left: -3px;
  top: 0;
  bottom: 0;
  width: 6px;
  cursor: col-resize;
  z-index: 1;
}

.resize-handle:hover {
  background: color-mix(in srgb, var(--accent) 40%, transparent);
}

.drawer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-tertiary);
  flex-shrink: 0;
}

.drawer-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.drawer-actions {
  display: flex;
  gap: 4px;
}

.btn-icon {
  padding: 4px;
  background: transparent;
  border: none;
  border-radius: 3px;
  color: var(--text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
}

.btn-icon:hover:not(:disabled) {
  background: var(--bg-primary);
  color: var(--text-primary);
}

.btn-icon:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.drawer-status {
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 6px;
  background: var(--bg-secondary);
  flex-shrink: 0;
}

.progress {
  display: flex;
  align-items: center;
  gap: 8px;
}

.progress-bar {
  flex: 1;
  height: 5px;
  background: var(--border);
  border-radius: 3px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: var(--accent);
  transition: width 0.3s ease;
}

.progress-text {
  font-size: 11px;
  color: var(--text-secondary);
  font-family: 'SF Mono', Monaco, monospace;
  min-width: 60px;
  text-align: right;
}

.current-url {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--info);
  font-family: 'SF Mono', Monaco, monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.drawer-log-list {
  flex: 1;
  overflow-y: auto;
  font-family: 'SF Mono', Monaco, monospace;
  font-size: 11px;
  padding: 4px 0;
}

.log-empty {
  padding: 16px 12px;
  color: var(--text-muted);
  font-size: 12px;
  font-family: system-ui, sans-serif;
  font-style: italic;
}

.log-entry {
  padding: 3px 12px;
  display: flex;
  gap: 8px;
  line-height: 1.5;
}

.log-entry:hover {
  background: var(--bg-primary);
}

.log-time {
  color: var(--text-muted);
  flex-shrink: 0;
  font-size: 10px;
}

.log-message {
  word-break: break-word;
  flex: 1;
}

.log-info { color: var(--text-secondary); }
.log-success { color: var(--success); }
.log-error { color: var(--error); }
.log-progress { color: var(--info); }

/* Collapsed handle */
.drawer-handle {
  position: fixed;
  top: 50%;
  right: 0;
  transform: translateY(-50%);
  background: var(--bg-tertiary);
  border: 1px solid var(--border);
  border-right: none;
  border-top-left-radius: 6px;
  border-bottom-left-radius: 6px;
  padding: 10px 8px;
  color: var(--text-primary);
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  z-index: 90;
  writing-mode: vertical-rl;
  font-size: 12px;
  font-weight: 600;
  box-shadow: -2px 0 6px rgba(0, 0, 0, 0.08);
}

.drawer-handle:hover {
  background: var(--accent);
  color: #fff;
}

.drawer-handle svg {
  writing-mode: horizontal-tb;
}

.handle-label {
  letter-spacing: 1px;
}

.pulse {
  writing-mode: horizontal-tb;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--success);
  animation: pulse 1.2s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 0.3; transform: scale(1); }
  50% { opacity: 1; transform: scale(1.3); }
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
