<script setup lang="ts">
import { Download, Search } from 'lucide-vue-next'

const modelValue = defineModel<string>({ required: true })
const urlFilter = defineModel<string>('filter', { default: '' })

const emit = defineEmits<(e: 'import', urls: string[]) => void>()

const fileInput = ref<HTMLInputElement | null>(null)
const showFilter = ref(false)

// URL counter
const urlCount = computed(() => {
  const urls = modelValue.value
    .split(/[\n,]+/)
    .map((u) => u.trim())
    .filter((u) => u.length > 0 && isValidUrl(u))
  return urls.length
})

function isValidUrl(str: string): boolean {
  try {
    new URL(str)
    return true
  } catch {
    return false
  }
}

function triggerImport() {
  fileInput.value?.click()
}

async function handleFileImport(event: Event) {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  if (!file) return

  const text = await file.text()

  // Parse CSV or TXT
  let urls: string[] = []

  if (file.name.endsWith('.csv')) {
    // CSV: take first column or find URL column
    const lines = text.split('\n')
    const header = lines[0]?.toLowerCase() || ''
    const urlColIndex = header
      .split(',')
      .findIndex((col) => col.includes('url') || col.includes('link'))

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i]
      if (!line) continue
      const cols = line.split(',')
      const url = cols[urlColIndex >= 0 ? urlColIndex : 0]?.trim()
      if (url && isValidUrl(url)) {
        urls.push(url)
      }
    }
  } else {
    // TXT: each line is a URL
    urls = text
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && isValidUrl(l))
  }

  if (urls.length > 0) {
    // Add to existing URLs
    const existing = modelValue.value
      .split(/[\n,]+/)
      .map((u) => u.trim())
      .filter(Boolean)
    const combined = [...new Set([...existing, ...urls])]
    modelValue.value = combined.join('\n')
  }

  // Reset input
  target.value = ''
}
</script>

<template>
  <div class="url-input">
    <div class="url-header">
      <label>Enter URLs</label>
      <div class="url-actions">
        <span class="url-count">{{ urlCount }} URL{{ urlCount !== 1 ? 's' : '' }}</span>
        <button type="button" class="import-btn" @click="triggerImport">
          <Download :size="14" /> Import
        </button>
        <button 
          type="button" 
          class="filter-btn"
          :class="{ active: showFilter }"
          @click="showFilter = !showFilter"
        >
          <Search :size="14" /> Filter
        </button>
      </div>
    </div>

    <textarea
      v-model="modelValue"
      placeholder="https://example.com&#10;https://another-site.com&#10;...or load via import"
      rows="6"
    ></textarea>

    <div v-if="showFilter" class="filter-section">
      <label>URL Filter (Regex)</label>
      <input 
        type="text"
        v-model="urlFilter"
        placeholder="e.g. /blog/.*  or  \.html$"
      >
      <div class="filter-hint">
        Only URLs matching this pattern will be processed
      </div>
    </div>

    <input 
      ref="fileInput"
      type="file" 
      accept=".txt,.csv"
      style="display: none"
      @change="handleFileImport"
    >
  </div>
</template>

<style scoped>
.url-input {
  margin-bottom: 1rem;
}

.url-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
}

.url-header label {
  font-weight: 500;
  color: var(--text-primary, #fff);
}

.url-actions {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.url-count {
  font-size: 0.85rem;
  color: var(--text-secondary, #888);
  padding-right: 0.5rem;
  border-right: 1px solid var(--border, #333);
}

.import-btn,
.filter-btn {
  padding: 0.35rem 0.7rem;
  background: var(--bg-secondary, #1a1a2e);
  border: 1px solid var(--border, #333);
  border-radius: 4px;
  color: var(--text-primary, #fff);
  cursor: pointer;
  font-size: 0.85rem;
}

.import-btn:hover,
.filter-btn:hover {
  background: var(--bg-tertiary, #252540);
}

.filter-btn.active {
  background: var(--accent, #00d9ff);
  color: #000;
  border-color: var(--accent, #00d9ff);
}

textarea {
  width: 100%;
  padding: 0.75rem;
  border: 1px solid var(--border, #333);
  border-radius: 6px;
  background: var(--bg-primary, #0f0f1a);
  color: var(--text-primary, #fff);
  font-family: monospace;
  font-size: 0.9rem;
  resize: vertical;
}

textarea:focus {
  outline: none;
  border-color: var(--accent, #00d9ff);
}

.filter-section {
  margin-top: 0.75rem;
  padding: 0.75rem;
  background: var(--bg-secondary, #1a1a2e);
  border-radius: 6px;
}

.filter-section label {
  display: block;
  font-size: 0.85rem;
  color: var(--text-secondary, #888);
  margin-bottom: 0.3rem;
}

.filter-section input {
  width: 100%;
  padding: 0.5rem;
  border: 1px solid var(--border, #333);
  border-radius: 4px;
  background: var(--bg-primary, #0f0f1a);
  color: var(--text-primary, #fff);
  font-family: monospace;
}

.filter-hint {
  font-size: 0.75rem;
  color: var(--text-secondary, #666);
  margin-top: 0.25rem;
}
</style>
