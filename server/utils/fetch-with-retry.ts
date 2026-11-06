import { BlockedUrlError, safeFetch } from './safe-fetch'
import { sanitizeHeaders } from './sanitize-headers'

export interface RequestSettings {
  timeout: number
  retries: number
  proxy?: string
  headers?: Record<string, string>
  parallelRequests?: number
}

export interface FetchWithRetryResult {
  response: Response
  retryCount: number
  loadTime: number
}

export async function fetchWithRetry(
  url: string,
  settings: RequestSettings,
): Promise<FetchWithRetryResult> {
  const { timeout, retries, headers } = settings
  let lastError: Error | null = null
  const startTime = Date.now()

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), timeout * 1000)

      // safeFetch checks the resolved IP of the URL and of every redirect hop.
      const response = await safeFetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; URLTools/1.0)',
          ...sanitizeHeaders(headers),
        },
        signal: controller.signal,
      }).finally(() => clearTimeout(timeoutId))

      if (response.status >= 500 && attempt < retries) {
        lastError = new Error(`Server error: ${response.status}`)
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)))
        continue
      }

      return { response, retryCount: attempt, loadTime: Date.now() - startTime }
    } catch (error) {
      // A blocked target stays blocked; retrying would only waste time.
      if (error instanceof BlockedUrlError) throw error
      lastError = error instanceof Error ? error : new Error('Unknown error')
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)))
      }
    }
  }

  throw lastError
}
