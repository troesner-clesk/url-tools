<script setup lang="ts">
import { ChevronDown, ChevronRight, X } from 'lucide-vue-next'

interface RequestSettings {
  timeout: number
  retries: number
  proxy: string
  headers: Record<string, string>
  parallelRequests: number
}

const settings = defineModel<RequestSettings>('settings', {
  default: () => ({
    timeout: 30,
    retries: 1,
    proxy: '',
    headers: {},
    parallelRequests: 5,
  }),
})

const showAdvanced = ref(false)
const customHeaderKey = ref('')
const customHeaderValue = ref('')

function addHeader() {
  if (customHeaderKey.value && customHeaderValue.value) {
    settings.value.headers[customHeaderKey.value] = customHeaderValue.value
    customHeaderKey.value = ''
    customHeaderValue.value = ''
  }
}

function removeHeader(key: string) {
  delete settings.value.headers[key]
}
</script>

<template>
  <div class="request-settings">
    <div class="settings-row">
      <div class="setting-group">
        <label>Timeout (s) <span class="help-icon" data-tooltip="Maximum seconds to wait for a response before aborting">?</span></label>
        <input 
          type="number" 
          v-model.number="settings.timeout" 
          min="5" 
          max="120"
        >
      </div>

      <div class="setting-group">
        <label>Retries <span class="help-icon" data-tooltip="Number of retry attempts for failed or timed-out requests">?</span></label>
        <select v-model.number="settings.retries">
          <option :value="0">No retry</option>
          <option :value="1">Retry 1x</option>
          <option :value="2">Retry 2x</option>
          <option :value="3">Retry 3x</option>
        </select>
      </div>

      <div class="setting-group">
        <label>Parallel Requests <span class="help-icon" data-tooltip="Number of concurrent requests (higher = faster, but may trigger rate limits)">?</span></label>
        <input 
          type="number" 
          v-model.number="settings.parallelRequests" 
          min="1" 
          max="20"
        >
      </div>
    </div>

    <button 
      type="button" 
      class="toggle-advanced"
      @click="showAdvanced = !showAdvanced"
    >
      <ChevronDown v-if="showAdvanced" :size="14" /><ChevronRight v-else :size="14" /> Advanced Options
    </button>

    <div v-if="showAdvanced" class="advanced-settings">
      <div class="setting-group">
        <label>Proxy (optional) <span class="help-icon" data-tooltip="HTTP proxy for all requests (format: http://host:port)">?</span></label>
        <input 
          type="text" 
          v-model="settings.proxy" 
          placeholder="http://host:port"
        >
        <div class="setting-hint">
          HTTP proxy for all requests
        </div>
      </div>

      <div class="setting-group">
        <label>Custom Headers <span class="help-icon" data-tooltip="Additional HTTP headers sent with every request">?</span></label>
        <div class="headers-list">
          <div 
            v-for="(value, key) in settings.headers" 
            :key="key" 
            class="header-item"
          >
            <span class="header-key">{{ key }}:</span>
            <span class="header-value">{{ value }}</span>
            <button type="button" class="remove-btn" @click="removeHeader(key as string)"><X :size="14" /></button>
          </div>
        </div>
        <div class="header-input">
          <input 
            type="text" 
            v-model="customHeaderKey" 
            placeholder="Header-Name"
          >
          <input 
            type="text" 
            v-model="customHeaderValue" 
            placeholder="Value"
          >
          <button type="button" @click="addHeader">+</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.request-settings {
  background: var(--bg-secondary, #1a1a2e);
  border-radius: 8px;
  padding: 1rem;
  margin-bottom: 1rem;
}

.settings-row {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
}

.setting-group {
  flex: 1;
  min-width: 120px;
}

.setting-group label {
  display: block;
  font-size: 0.85rem;
  color: var(--text-secondary, #888);
  margin-bottom: 0.3rem;
}

.setting-group input,
.setting-group select {
  width: 100%;
  padding: 0.5rem;
  border: 1px solid var(--border, #333);
  border-radius: 4px;
  background: var(--bg-primary, #0f0f1a);
  color: var(--text-primary, #fff);
}

.setting-hint {
  font-size: 0.75rem;
  color: var(--text-secondary, #666);
  margin-top: 0.25rem;
}

.toggle-advanced {
  background: none;
  border: none;
  color: var(--text-secondary, #888);
  cursor: pointer;
  padding: 0.5rem 0;
  font-size: 0.85rem;
}

.toggle-advanced:hover {
  color: var(--text-primary, #fff);
}

.advanced-settings {
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid var(--border, #333);
}

.headers-list {
  margin-bottom: 0.5rem;
}

.header-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.25rem 0.5rem;
  background: var(--bg-primary, #0f0f1a);
  border-radius: 4px;
  margin-bottom: 0.25rem;
  font-size: 0.85rem;
}

.header-key {
  color: var(--accent, #00d9ff);
}

.header-value {
  flex: 1;
  color: var(--text-secondary, #888);
}

.remove-btn {
  background: none;
  border: none;
  color: #ff6b6b;
  cursor: pointer;
  font-size: 1rem;
}

.header-input {
  display: flex;
  gap: 0.5rem;
}

.header-input input {
  flex: 1;
  padding: 0.4rem;
  border: 1px solid var(--border, #333);
  border-radius: 4px;
  background: var(--bg-primary, #0f0f1a);
  color: var(--text-primary, #fff);
}

.header-input button {
  padding: 0.4rem 0.8rem;
  background: var(--accent, #00d9ff);
  border: none;
  border-radius: 4px;
  color: #000;
  cursor: pointer;
  font-weight: bold;
}
</style>
