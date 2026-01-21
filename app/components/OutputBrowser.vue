<script setup lang="ts">
interface OutputFile {
  name: string
  path: string
  size: number
  modified: string
  type: 'json' | 'csv' | 'html' | 'folder' | 'other'
}

const files = ref<OutputFile[]>([])
const outputDir = ref('')
const selectedFile = ref<OutputFile | null>(null)
const fileContent = ref('')
const isLoading = ref(false)

// Dateien laden
async function loadFiles() {
  try {
    const response = await $fetch('/api/get-output-dir')
    files.value = response.files
    outputDir.value = response.outputDir
  } catch (error) {
    console.error('Failed to load files:', error)
  }
}

// Datei-Inhalt laden
async function viewFile(file: OutputFile) {
  if (file.type === 'folder') return
  
  selectedFile.value = file
  isLoading.value = true
  
  try {
    const response = await $fetch('/api/read-file', {
      query: { path: file.path }
    })
    fileContent.value = response.content
  } catch (error) {
    fileContent.value = 'Fehler beim Laden der Datei'
  } finally {
    isLoading.value = false
  }
}

// Ordner im Finder öffnen
async function openFolder(path?: string) {
  try {
    await $fetch('/api/open-folder', {
      query: { path: path || outputDir.value }
    })
  } catch (error) {
    console.error('Failed to open folder:', error)
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('de-DE')
}

function getTypeIcon(type: OutputFile['type']): string {
  switch (type) {
    case 'json': return '📄'
    case 'csv': return '📊'
    case 'html': return '🌐'
    case 'folder': return '📁'
    default: return '📎'
  }
}

// Initial laden
onMounted(loadFiles)
</script>

<template>
  <div class="output-browser">
    <div class="browser-header">
      <h3>Output-Dateien</h3>
      <div class="browser-actions">
        <button class="btn-small" @click="loadFiles">↻ Aktualisieren</button>
        <button class="btn-small" @click="openFolder()">📂 Ordner öffnen</button>
      </div>
    </div>

    <div class="browser-content">
      <!-- Dateiliste -->
      <div class="file-list">
        <div v-if="files.length === 0" class="empty-state">
          Noch keine Dateien vorhanden.
        </div>
        
        <div 
          v-for="file in files" 
          :key="file.path"
          :class="['file-item', { active: selectedFile?.path === file.path, folder: file.type === 'folder' }]"
          @click="viewFile(file)"
        >
          <span class="file-icon">{{ getTypeIcon(file.type) }}</span>
          <div class="file-info">
            <div class="file-name">{{ file.name }}</div>
            <div class="file-meta">
              {{ formatSize(file.size) }} · {{ formatDate(file.modified) }}
            </div>
          </div>
        </div>
      </div>

      <!-- Datei-Vorschau -->
      <div class="file-preview">
        <div v-if="!selectedFile" class="empty-state">
          Datei auswählen um Vorschau zu sehen
        </div>
        
        <div v-else-if="isLoading" class="loading">
          Laden...
        </div>
        
        <div v-else class="preview-content">
          <div class="preview-header">
            <span>{{ selectedFile.name }}</span>
            <button class="btn-small" @click="openFolder(selectedFile.path)">
              Im Finder zeigen
            </button>
          </div>
          <pre class="preview-code">{{ fileContent }}</pre>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.output-browser {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.browser-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: #0a0a0a;
  border-bottom: 1px solid #333;
}

.browser-header h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 500;
}

.browser-actions {
  display: flex;
  gap: 8px;
}

.btn-small {
  padding: 6px 12px;
  background: #333;
  border: none;
  border-radius: 4px;
  color: #fff;
  cursor: pointer;
  font-size: 12px;
}

.btn-small:hover {
  background: #444;
}

.browser-content {
  display: grid;
  grid-template-columns: 300px 1fr;
  flex: 1;
  overflow: hidden;
}

.file-list {
  border-right: 1px solid #333;
  overflow-y: auto;
}

.file-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  cursor: pointer;
  border-bottom: 1px solid #1a1a1a;
}

.file-item:hover {
  background: #1a1a1a;
}

.file-item.active {
  background: #1a2a3a;
}

.file-item.folder {
  background: #0a0a0a;
}

.file-icon {
  font-size: 18px;
  flex-shrink: 0;
}

.file-info {
  flex: 1;
  min-width: 0;
}

.file-name {
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.file-meta {
  font-size: 11px;
  color: #666;
  margin-top: 2px;
}

.file-preview {
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.empty-state {
  padding: 40px;
  text-align: center;
  color: #666;
}

.loading {
  padding: 40px;
  text-align: center;
  color: #888;
}

.preview-content {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.preview-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 12px;
  background: #0a0a0a;
  border-bottom: 1px solid #333;
  font-size: 12px;
  color: #888;
}

.preview-code {
  flex: 1;
  margin: 0;
  padding: 12px;
  background: #0a0a0a;
  font-family: 'SF Mono', Monaco, monospace;
  font-size: 11px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
