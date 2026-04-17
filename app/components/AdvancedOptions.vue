<script setup lang="ts">
import { ChevronDown, ChevronRight } from 'lucide-vue-next'

const props = defineProps<{ tabId: string }>()
const key = `url-tools.advanced.${props.tabId}`
const detailsEl = ref<HTMLDetailsElement | null>(null)
const isOpen = ref(false)

onMounted(() => {
  try {
    const stored = localStorage.getItem(key)
    if (stored === 'true' && detailsEl.value) {
      detailsEl.value.open = true
      isOpen.value = true
    }
  } catch {}
})

function onToggle(e: Event) {
  const open = (e.target as HTMLDetailsElement).open
  isOpen.value = open
  try {
    localStorage.setItem(key, String(open))
  } catch {}
}
</script>

<template>
  <details ref="detailsEl" class="advanced-options" @toggle="onToggle">
    <summary class="advanced-summary">
      <ChevronDown v-if="isOpen" :size="14" />
      <ChevronRight v-else :size="14" />
      Advanced Options
    </summary>
    <div class="advanced-content">
      <slot />
    </div>
  </details>
</template>

<style scoped>
.advanced-options {
  margin: 4px 0;
}

.advanced-summary {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  padding: 6px 0;
  user-select: none;
  list-style: none;
}

.advanced-summary::-webkit-details-marker {
  display: none;
}

.advanced-summary::marker {
  content: '';
}

.advanced-summary:hover {
  color: var(--accent);
}

.advanced-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 8px 0 4px;
  border-top: 1px solid var(--border);
}
</style>
