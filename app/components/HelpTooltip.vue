<script setup lang="ts">
const props = defineProps<{ text: string }>()

const show = ref(false)
const pos = ref({ top: 0, left: 0 })
const triggerEl = ref<HTMLElement | null>(null)

function onEnter() {
  if (!triggerEl.value) return
  const rect = triggerEl.value.getBoundingClientRect()
  const tooltipWidth = 240

  let left = rect.left + rect.width / 2 - tooltipWidth / 2
  // Keep within viewport
  if (left < 8) left = 8
  if (left + tooltipWidth > window.innerWidth - 8) left = window.innerWidth - tooltipWidth - 8

  pos.value = {
    top: rect.bottom + 6,
    left,
  }
  show.value = true
}

function onLeave() {
  show.value = false
}
</script>

<template>
  <span
    ref="triggerEl"
    class="help-icon"
    @mouseenter="onEnter"
    @mouseleave="onLeave"
  >?</span>
  <Teleport to="body">
    <div
      v-if="show"
      class="tooltip-popup"
      :style="{ top: pos.top + 'px', left: pos.left + 'px' }"
    >
      {{ text }}
    </div>
  </Teleport>
</template>

<style scoped>
.help-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  margin-left: 4px;
  font-size: 10px;
  background: var(--bg-tertiary);
  border-radius: 50%;
  color: var(--text-secondary);
  cursor: help;
  vertical-align: middle;
}

.tooltip-popup {
  position: fixed;
  width: 240px;
  padding: 6px 10px;
  background: var(--bg-tertiary, #333);
  color: var(--text-primary, #fff);
  font-size: 12px;
  font-weight: 400;
  line-height: 1.4;
  border-radius: 6px;
  z-index: 10000;
  pointer-events: none;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
}
</style>
