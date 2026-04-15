import { computed, reactive, ref, watch } from 'vue'

export type TabId =
  | 'scraper'
  | 'seo'
  | 'screenshots'
  | 'images'
  | 'sitemap'
  | 'broken-links'
  | 'silo'

export interface LogEntry {
  timestamp: string
  message: string
  type: 'info' | 'success' | 'error' | 'progress'
}

export interface Progress {
  done: number
  total: number
}

const MAX_ENTRIES = 500
const STORAGE_OPEN = 'url-tools.drawerOpen'
const STORAGE_WIDTH = 'url-tools.drawerWidth'
const MIN_WIDTH = 240
const MAX_WIDTH = 800
const DEFAULT_WIDTH = 380

function emptyLogs(): Record<TabId, LogEntry[]> {
  return {
    scraper: [],
    seo: [],
    screenshots: [],
    images: [],
    sitemap: [],
    'broken-links': [],
    silo: [],
  }
}

function emptyProgress(): Record<TabId, Progress> {
  return {
    scraper: { done: 0, total: 0 },
    seo: { done: 0, total: 0 },
    screenshots: { done: 0, total: 0 },
    images: { done: 0, total: 0 },
    sitemap: { done: 0, total: 0 },
    'broken-links': { done: 0, total: 0 },
    silo: { done: 0, total: 0 },
  }
}

function emptyCurrentUrl(): Record<TabId, string | null> {
  return {
    scraper: null,
    seo: null,
    screenshots: null,
    images: null,
    sitemap: null,
    'broken-links': null,
    silo: null,
  }
}

function emptyRunning(): Record<TabId, boolean> {
  return {
    scraper: false,
    seo: false,
    screenshots: false,
    images: false,
    sitemap: false,
    'broken-links': false,
    silo: false,
  }
}

// Module-level reactive state — survives component unmounts, shared across tabs.
const allLogs = reactive(emptyLogs())
const allProgress = reactive(emptyProgress())
const allCurrentUrl = reactive(emptyCurrentUrl())
const allRunning = reactive(emptyRunning())
const activeTabId = ref<TabId>('scraper')
const drawerOpen = ref<boolean>(true)
const drawerWidth = ref<number>(DEFAULT_WIDTH)

let initialized = false

function initFromStorage() {
  if (initialized || typeof window === 'undefined') return
  initialized = true
  try {
    const storedOpen = localStorage.getItem(STORAGE_OPEN)
    if (storedOpen !== null) drawerOpen.value = storedOpen === 'true'
    const storedWidth = localStorage.getItem(STORAGE_WIDTH)
    if (storedWidth) {
      const w = parseInt(storedWidth, 10)
      if (!Number.isNaN(w)) {
        drawerWidth.value = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, w))
      }
    }
  } catch {
    // localStorage may throw in private mode — silently keep defaults
  }
  watch(drawerOpen, (v) => {
    try {
      localStorage.setItem(STORAGE_OPEN, String(v))
    } catch {}
  })
  watch(drawerWidth, (v) => {
    try {
      localStorage.setItem(STORAGE_WIDTH, String(v))
    } catch {}
  })
}

export function useLogStore() {
  initFromStorage()

  const currentLogs = computed(() => allLogs[activeTabId.value])
  const currentProgress = computed(() => allProgress[activeTabId.value])
  const currentUrlValue = computed(() => allCurrentUrl[activeTabId.value])
  const currentIsRunning = computed(() => allRunning[activeTabId.value])
  const anyRunning = computed(() =>
    Object.values(allRunning).some((v) => v),
  )

  function setActiveTab(tab: TabId) {
    activeTabId.value = tab
  }

  function toggleDrawer() {
    drawerOpen.value = !drawerOpen.value
  }

  function setDrawerWidth(w: number) {
    drawerWidth.value = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, w))
  }

  function clearLogs(tab: TabId) {
    allLogs[tab] = []
  }

  return {
    activeTabId,
    drawerOpen,
    drawerWidth,
    currentLogs,
    currentProgress,
    currentUrlValue,
    currentIsRunning,
    anyRunning,
    setActiveTab,
    toggleDrawer,
    setDrawerWidth,
    clearLogs,
    minWidth: MIN_WIDTH,
    maxWidth: MAX_WIDTH,
  }
}

export function useTabLogger(tabId: TabId) {
  initFromStorage()

  function addLog(message: string, type: LogEntry['type'] = 'info') {
    const entry: LogEntry = {
      timestamp: new Date().toLocaleTimeString('en-US'),
      message,
      type,
    }
    allLogs[tabId].push(entry)
    if (allLogs[tabId].length > MAX_ENTRIES) {
      allLogs[tabId].shift()
    }
  }

  function clearLogs() {
    allLogs[tabId] = []
  }

  function setProgress(p: Progress) {
    allProgress[tabId] = p
  }

  function resetProgress() {
    allProgress[tabId] = { done: 0, total: 0 }
  }

  function setCurrentUrl(url: string | null) {
    allCurrentUrl[tabId] = url
  }

  function setRunning(v: boolean) {
    allRunning[tabId] = v
  }

  return {
    addLog,
    clearLogs,
    setProgress,
    resetProgress,
    setCurrentUrl,
    setRunning,
  }
}
