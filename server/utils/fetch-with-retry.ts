import { sanitizeHeaders } from './sanitize-headers'

export interface RequestSettings {
    timeout: number
    retries: number
    proxy?: string
    headers?: Record<string, string>
}

export interface FetchWithRetryResult {
    response: Response
    retryCount: number
    loadTime: number
}

export async function fetchWithRetry(
    url: string,
    settings: RequestSettings
): Promise<FetchWithRetryResult> {
    const { timeout, retries, headers } = settings
    let lastError: Error | null = null
    const startTime = Date.now()

    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const controller = new AbortController()
            const timeoutId = setTimeout(() => controller.abort(), timeout * 1000)

            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; URLTools/1.0)',
                    ...sanitizeHeaders(headers)
                },
                signal: controller.signal
            })
            clearTimeout(timeoutId)

            if (response.status >= 500 && attempt < retries) {
                lastError = new Error(`Server error: ${response.status}`)
                await new Promise(r => setTimeout(r, 1000 * (attempt + 1)))
                continue
            }

            return { response, retryCount: attempt, loadTime: Date.now() - startTime }
        } catch (error) {
            lastError = error instanceof Error ? error : new Error('Unknown error')
            if (attempt < retries) {
                await new Promise(r => setTimeout(r, 1000 * (attempt + 1)))
                continue
            }
        }
    }

    throw lastError
}
