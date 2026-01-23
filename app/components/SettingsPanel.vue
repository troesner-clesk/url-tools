<script setup lang="ts">
interface Props {
  mode: 'html' | 'links'
}

interface RequestSettings {
  timeout: number
  retries: number
  proxy: string
  headers: Record<string, string>
  parallelRequests: number
}

interface Settings {
  recursive: boolean
  maxUrls: number
  maxDepth: number
  rateLimit: number
  sameDomainOnly: boolean
  saveFormat: 'json' | 'csv' | 'both'
  cssSelector: string
  urlFilter: string
  requestSettings: RequestSettings
}

const props = defineProps<Props>()

const settings = defineModel<Settings>('settings', {
  default: () => ({
    recursive: false,
    maxUrls: 100,
    maxDepth: 3,
    rateLimit: 2,
    sameDomainOnly: true,
    saveFormat: 'json' as const,
    cssSelector: '',
    urlFilter: '',
    requestSettings: {
      timeout: 30,
      retries: 1,
      proxy: '',
      headers: {},
      parallelRequests: 5
    }
  })
})

const customSelector = ref('')
</script>

<template>
  <div class="settings-panel">
    <!-- Common Request Settings -->
    <RequestSettings v-model:settings="settings.requestSettings" />

    <!-- HTML-specific Settings -->
    <template v-if="mode === 'html'">
      <div class="setting-group">
        <label>Extract area</label>
        <select v-model="settings.cssSelector">
          <option value="">Full page</option>
          <option value="main">Main content only (main)</option>
          <option value="article">Article only (article)</option>
          <option value="main, article">Main content or article</option>
          <option value=".content, #content">Content area (.content / #content)</option>
          <option value="body > *:not(header):not(footer):not(nav)">Without Header/Footer/Nav</option>
          <option value="custom">Custom CSS selector...</option>
        </select>
      </div>

      <div v-if="settings.cssSelector === 'custom'" class="setting-group">
        <label>Custom CSS selector</label>
        <input
          type="text"
          v-model="customSelector"
          placeholder="e.g. .post-content, #main-text"
          @input="settings.cssSelector = customSelector"
        >
        <div class="setting-hint">
          CSS selector for the element to extract
        </div>
      </div>
    </template>

    <!-- Link-specific Settings -->
    <template v-if="mode === 'links'">
      <div class="setting-group">
        <label>Export Format</label>
        <select v-model="settings.saveFormat">
          <option value="json">JSON</option>
          <option value="csv">CSV</option>
          <option value="both">Both</option>
        </select>
      </div>

      <div class="setting-group">
        <label>
          <input type="checkbox" v-model="settings.recursive">
          Crawl recursively
        </label>
      </div>

      <template v-if="settings.recursive">
        <div class="setting-group">
          <label>Max URLs</label>
          <input
            type="number"
            v-model.number="settings.maxUrls"
            min="1"
            max="10000"
          >
        </div>

        <div class="setting-group">
          <label>Max depth</label>
          <input
            type="number"
            v-model.number="settings.maxDepth"
            min="1"
            max="10"
          >
        </div>

        <div class="setting-group">
          <label>
            <input type="checkbox" v-model="settings.sameDomainOnly">
            Same domain only
          </label>
        </div>
      </template>

      <div class="setting-group">
        <label>Rate Limit (Req/s)</label>
        <input
          type="number"
          v-model.number="settings.rateLimit"
          min="0.1"
          max="10"
          step="0.1"
        >
      </div>
    </template>
  </div>
</template>

<style scoped>
.settings-panel {
  margin-bottom: 1rem;
}

.setting-group {
  margin-bottom: 0.75rem;
}

.setting-group label {
  display: block;
  font-size: 0.85rem;
  color: var(--text-secondary, #888);
  margin-bottom: 0.3rem;
}

.setting-group input[type="text"],
.setting-group input[type="number"],
.setting-group select {
  width: 100%;
  padding: 0.5rem;
  border: 1px solid var(--border, #333);
  border-radius: 4px;
  background: var(--bg-primary, #0f0f1a);
  color: var(--text-primary, #fff);
}

.setting-group input[type="checkbox"] {
  margin-right: 0.5rem;
}

.setting-hint {
  font-size: 0.75rem;
  color: var(--text-secondary, #666);
  margin-top: 0.25rem;
}
</style>
