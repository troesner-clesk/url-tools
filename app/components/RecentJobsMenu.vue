<script setup lang="ts">
interface OutputFile {
  name: string
  path: string
  size: number
  modified: string
  type: 'json' | 'csv' | 'html' | 'folder' | 'other'
}

interface Props {
  toolType?: 'screenshots' | 'seo' | 'html' | 'links' | 'json' | 'all'
}

const props = withDefaults(defineProps<Props>(), {
  toolType: 'all'
})

const isOpen = ref(false)
const folders = ref<OutputFile[]>([])
const isLoading = ref(false)

async function loadFolders() {
  if (isLoading.value) return

  isLoading.value = true
  try {
    const response = await $fetch<{ files: OutputFile[] }>('/api/get-output-dir')

    // Filter to only folders
    let folderList = response.files.filter(f => f.type === 'folder' && !f.name.includes('/'))

    // Filter by tool type if specified
    if (props.toolType !== 'all') {
      const prefixes: Record<string, string[]> = {
        screenshots: ['screenshots_', 'pdf_'],
        seo: ['seo_', 'seo-audit'],
        html: ['html_', 'scrape_html'],
        links: ['links_', 'scrape_links'],
        json: ['json_', 'scrape_json']
      }
      const patterns = prefixes[props.toolType] || []
      if (patterns.length > 0) {
        folderList = folderList.filter(f =>
          patterns.some(p => f.name.toLowerCase().includes(p))
        )
      }
    }

    // Sort by date descending
    folderList.sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime())

    // Take top 10
    folders.value = folderList.slice(0, 10)
  } catch {
    folders.value = []
  } finally {
    isLoading.value = false
  }
}

function toggleMenu() {
  isOpen.value = !isOpen.value
  if (isOpen.value) {
    loadFolders()
  }
}

async function openFolder(path: string) {
  try {
    await $fetch('/api/open-folder', { query: { path } })
    isOpen.value = false
  } catch {}
}

async function openOutputDir() {
  try {
    const outputDir = (await $fetch<{ outputDir: string }>('/api/get-output-dir')).outputDir
    await $fetch('/api/open-folder', { query: { path: outputDir } })
    isOpen.value = false
  } catch {}
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

// Close on outside click
onMounted(() => {
  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement
    if (!target.closest('.recent-jobs-menu')) {
      isOpen.value = false
    }
  })
})
</script>

<template>
  <div class="recent-jobs-menu">
    <button class="btn-folder" @click.stop="toggleMenu">
      📂 Open
      <span class="arrow">{{ isOpen ? '▲' : '▼' }}</span>
    </button>

    <div v-if="isOpen" class="dropdown">
      <div class="dropdown-header">
        Recent Jobs
      </div>

      <div v-if="isLoading" class="dropdown-loading">
        Loading...
      </div>

      <div v-else-if="folders.length === 0" class="dropdown-empty">
        No jobs found
      </div>

      <div v-else class="dropdown-items">
        <div
          v-for="folder in folders"
          :key="folder.path"
          class="dropdown-item"
          @click="openFolder(folder.path)"
        >
          <div class="item-name" :title="folder.name">{{ folder.name }}</div>
          <div class="item-meta">
            <span>{{ formatDate(folder.modified) }}</span>
            <span>{{ formatSize(folder.size) }}</span>
          </div>
        </div>
      </div>

      <div class="dropdown-footer">
        <button class="btn-all" @click="openOutputDir">
          Open Output Folder
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.recent-jobs-menu {
  position: relative;
  display: inline-block;
}

.btn-folder {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  background: #2a5a2a;
  border: none;
  border-radius: 3px;
  color: #4ade80;
  cursor: pointer;
  font-size: 12px;
}

.btn-folder:hover {
  background: #3a6a3a;
}

.arrow {
  font-size: 8px;
  opacity: 0.7;
}

.dropdown {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  min-width: 280px;
  max-width: 350px;
  background: #1a1a1a;
  border: 1px solid #333;
  border-radius: 6px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  z-index: 1000;
  overflow: hidden;
}

.dropdown-header {
  padding: 10px 12px;
  font-size: 11px;
  font-weight: 600;
  color: #888;
  text-transform: uppercase;
  border-bottom: 1px solid #333;
  background: #0a0a0a;
}

.dropdown-loading,
.dropdown-empty {
  padding: 20px;
  text-align: center;
  color: #666;
  font-size: 13px;
}

.dropdown-items {
  max-height: 300px;
  overflow-y: auto;
}

.dropdown-item {
  padding: 10px 12px;
  cursor: pointer;
  border-bottom: 1px solid #252525;
}

.dropdown-item:hover {
  background: #252525;
}

.dropdown-item:last-child {
  border-bottom: none;
}

.item-name {
  font-size: 13px;
  color: #e0e0e0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-meta {
  display: flex;
  gap: 12px;
  margin-top: 4px;
  font-size: 11px;
  color: #666;
}

.dropdown-footer {
  padding: 8px;
  border-top: 1px solid #333;
  background: #0a0a0a;
}

.btn-all {
  width: 100%;
  padding: 8px;
  background: #333;
  border: none;
  border-radius: 4px;
  color: #e0e0e0;
  cursor: pointer;
  font-size: 12px;
}

.btn-all:hover {
  background: #444;
}
</style>
