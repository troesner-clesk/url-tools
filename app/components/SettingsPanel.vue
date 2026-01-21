<script setup lang="ts">
interface Props {
  mode: 'html' | 'links'
}

interface Settings {
  recursive: boolean
  maxUrls: number
  maxDepth: number
  rateLimit: number
  sameDomainOnly: boolean
  saveFormat: 'json' | 'csv' | 'both'
  cssSelector: string
  parallelRequests: number
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
    parallelRequests: 5
  })
})

const customSelector = ref('')
</script>

<template>
  <div class="settings-panel">
    <h3>Settings</h3>
    
    <!-- Save Format (immer sichtbar) -->
    <div class="setting-group">
      <label>Auto-Save Format</label>
      <select v-model="settings.saveFormat">
        <option value="json">JSON</option>
        <option value="csv">CSV</option>
        <option value="both">Beides</option>
      </select>
    </div>

    <!-- HTML-spezifische Settings -->
    <template v-if="mode === 'html'">
      <div class="setting-group">
        <label>Bereich extrahieren</label>
        <select v-model="settings.cssSelector">
          <option value="">Ganze Seite</option>
          <option value="main">Nur Hauptinhalt (main)</option>
          <option value="article">Nur Artikel (article)</option>
          <option value="main, article">Hauptinhalt oder Artikel</option>
          <option value=".content, #content">Content-Bereich (.content / #content)</option>
          <option value="body > *:not(header):not(footer):not(nav)">Ohne Header/Footer/Nav</option>
          <option value="custom">Eigener CSS-Selector...</option>
        </select>
      </div>
      
      <div v-if="settings.cssSelector === 'custom'" class="setting-group">
        <label>Eigener CSS-Selector</label>
        <input 
          type="text" 
          v-model="customSelector" 
          placeholder="z.B. .post-content, #main-text"
          @input="settings.cssSelector = customSelector"
        >
        <div class="setting-hint">
          CSS-Selector für das zu extrahierende Element
        </div>
      </div>

      <div class="setting-group">
        <label>Parallele Requests</label>
        <input 
          type="number" 
          v-model.number="settings.parallelRequests" 
          min="1" 
          max="20"
        >
        <div class="setting-hint">
          Mehr = schneller, aber höherer RAM-Verbrauch
        </div>
      </div>
    </template>

    <!-- Link-spezifische Settings -->
    <template v-if="mode === 'links'">
      <div class="setting-group">
        <label>
          <input type="checkbox" v-model="settings.recursive">
          Rekursiv crawlen
        </label>
      </div>

      <template v-if="settings.recursive">
        <div class="setting-group">
          <label>Max. URLs</label>
          <input type="number" v-model.number="settings.maxUrls" min="1" max="10000">
        </div>

        <div class="setting-group">
          <label>Max. Tiefe</label>
          <input type="number" v-model.number="settings.maxDepth" min="1" max="10">
        </div>

        <div class="setting-group">
          <label>
            <input type="checkbox" v-model="settings.sameDomainOnly">
            Nur Same-Domain
          </label>
        </div>
      </template>

      <div class="setting-group">
        <label>Rate Limit (Req/s)</label>
        <input type="number" v-model.number="settings.rateLimit" min="0.5" max="10" step="0.5">
      </div>
    </template>
  </div>
</template>

<style scoped>
.settings-panel {
  background: #1a1a1a;
  border: 1px solid #333;
  border-radius: 4px;
  padding: 16px;
}

.settings-panel h3 {
  margin: 0 0 16px 0;
  font-size: 14px;
  color: #888;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.setting-group {
  margin-bottom: 12px;
}

.setting-group label {
  display: block;
  margin-bottom: 4px;
  color: #ccc;
  font-size: 13px;
}

.setting-group input[type="checkbox"] {
  margin-right: 8px;
}

.setting-group input[type="number"],
.setting-group input[type="text"],
.setting-group select {
  width: 100%;
  padding: 8px;
  background: #0a0a0a;
  border: 1px solid #333;
  border-radius: 4px;
  color: #fff;
  font-family: inherit;
}

.setting-group input[type="number"]:focus,
.setting-group input[type="text"]:focus,
.setting-group select:focus {
  outline: none;
  border-color: #0066cc;
}

.setting-hint {
  margin-top: 4px;
  font-size: 11px;
  color: #666;
}
</style>
