export interface LogEntry {
  timestamp: string
  message: string
  type: 'info' | 'success' | 'error' | 'progress'
}

export function useLogger() {
  const logs = ref<LogEntry[]>([])
  const logContainer = ref<HTMLElement | null>(null)

  function addLog(message: string, type: LogEntry['type'] = 'info') {
    const now = new Date()
    const timestamp = now.toLocaleTimeString('en-US')
    logs.value.push({ timestamp, message, type })
    if (logs.value.length > 100) {
      logs.value.shift()
    }
  }

  // Auto-scroll log container
  watch(
    logs,
    () => {
      nextTick(() => {
        if (logContainer.value) {
          logContainer.value.scrollTop = logContainer.value.scrollHeight
        }
      })
    },
    { deep: true },
  )

  return { logs, addLog, logContainer }
}
