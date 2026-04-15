import { beforeEach, describe, expect, it } from 'vitest'
import {
  __resetForTests,
  useLogStore,
  useTabLogger,
} from '../useLogStore'

describe('useLogStore', () => {
  beforeEach(() => __resetForTests())

  it('isolates logs per tab', () => {
    useTabLogger('silo').addLog('silo entry')
    useTabLogger('seo').addLog('seo entry')

    const store = useLogStore()
    store.setActiveTab('silo')
    expect(store.currentLogs.value).toHaveLength(1)
    expect(store.currentLogs.value[0]?.message).toBe('silo entry')

    store.setActiveTab('seo')
    expect(store.currentLogs.value).toHaveLength(1)
    expect(store.currentLogs.value[0]?.message).toBe('seo entry')
  })

  it('caps logs at MAX_ENTRIES (500), evicting oldest', () => {
    const logger = useTabLogger('scraper')
    for (let i = 0; i < 600; i++) {
      logger.addLog(`entry ${i}`)
    }
    const store = useLogStore()
    store.setActiveTab('scraper')
    expect(store.currentLogs.value).toHaveLength(500)
    // Oldest 100 should have been evicted
    expect(store.currentLogs.value[0]?.message).toBe('entry 100')
    expect(store.currentLogs.value.at(-1)?.message).toBe('entry 599')
  })

  it('clearLogs only clears the targeted tab', () => {
    useTabLogger('silo').addLog('keep-me')
    const seoLogger = useTabLogger('seo')
    seoLogger.addLog('clear-me')
    seoLogger.clearLogs()

    const store = useLogStore()
    store.setActiveTab('silo')
    expect(store.currentLogs.value).toHaveLength(1)
    store.setActiveTab('seo')
    expect(store.currentLogs.value).toHaveLength(0)
  })

  it('setRunning flips anyRunning across all tabs', () => {
    const store = useLogStore()
    expect(store.anyRunning.value).toBe(false)
    useTabLogger('silo').setRunning(true)
    expect(store.anyRunning.value).toBe(true)
    useTabLogger('silo').setRunning(false)
    expect(store.anyRunning.value).toBe(false)
  })

  it('setProgress and setCurrentUrl write per tab', () => {
    const logger = useTabLogger('silo')
    logger.setProgress({ done: 3, total: 10 })
    logger.setCurrentUrl('https://example.com/x')

    const store = useLogStore()
    store.setActiveTab('silo')
    expect(store.currentProgress.value).toEqual({ done: 3, total: 10 })
    expect(store.currentUrlValue.value).toBe('https://example.com/x')

    store.setActiveTab('seo')
    expect(store.currentProgress.value).toEqual({ done: 0, total: 0 })
    expect(store.currentUrlValue.value).toBeNull()
  })

  it('addLog includes a timestamp and the requested type', () => {
    useTabLogger('silo').addLog('hello', 'success')
    const store = useLogStore()
    store.setActiveTab('silo')
    const entry = store.currentLogs.value[0]
    expect(entry?.message).toBe('hello')
    expect(entry?.type).toBe('success')
    expect(entry?.timestamp).toMatch(/\d/) // any digits — locale-dependent format
  })
})
