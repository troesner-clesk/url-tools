type SortDirection = 'asc' | 'desc' | null

interface SortState {
  column: string | null
  direction: SortDirection
}

export function useTableSort() {
  const sortState = ref<SortState>({ column: null, direction: null })

  function toggleSort(column: string) {
    if (sortState.value.column !== column) {
      sortState.value = { column, direction: 'asc' }
    } else if (sortState.value.direction === 'asc') {
      sortState.value = { column, direction: 'desc' }
    } else {
      sortState.value = { column: null, direction: null }
    }
  }

  function sortIndicator(column: string): string {
    if (sortState.value.column !== column) return ''
    return sortState.value.direction === 'asc' ? ' ▲' : ' ▼'
  }

  function sortedData<T extends Record<string, unknown>>(data: T[]): T[] {
    const { column, direction } = sortState.value
    if (!column || !direction) return data

    return [...data].sort((a, b) => {
      const valA = a[column]
      const valB = b[column]

      if (valA == null && valB == null) return 0
      if (valA == null) return 1
      if (valB == null) return -1

      if (typeof valA === 'number' && typeof valB === 'number') {
        return direction === 'asc' ? valA - valB : valB - valA
      }

      if (typeof valA === 'boolean' && typeof valB === 'boolean') {
        return direction === 'asc'
          ? Number(valA) - Number(valB)
          : Number(valB) - Number(valA)
      }

      const strA = String(valA).toLowerCase()
      const strB = String(valB).toLowerCase()
      const cmp = strA.localeCompare(strB)
      return direction === 'asc' ? cmp : -cmp
    })
  }

  function resetSort() {
    sortState.value = { column: null, direction: null }
  }

  return { sortState, toggleSort, sortIndicator, sortedData, resetSort }
}
