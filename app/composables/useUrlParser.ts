export function useUrlParser(input: Ref<string>) {
  function parseUrls(text: string): string[] {
    return text
      .split(/[\n,]+/)
      .map((url) => url.trim())
      .filter((url) => {
        if (!url) return false
        try {
          new URL(url)
          return true
        } catch {
          return false
        }
      })
  }

  const parsedUrls = computed(() => parseUrls(input.value))
  const hasValidUrls = computed(() => parsedUrls.value.length > 0)

  return { parsedUrls, hasValidUrls }
}
