import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchWithRetry, type RequestSettings } from '../fetch-with-retry'

// Helper to build a minimal Response-like object that fetch would return
function mockResponse(
  status: number,
  body = '',
  headers: Record<string, string> = {},
): Response {
  return new Response(body, { status, headers })
}

const defaultSettings: RequestSettings = {
  timeout: 10,
  retries: 2,
}

describe('fetchWithRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('returns response, retryCount=0, and loadTime>0 on successful first attempt', async () => {
    const mockedFetch = vi.mocked(fetch)
    mockedFetch.mockResolvedValueOnce(mockResponse(200, 'ok'))

    const result = await fetchWithRetry('https://example.com', defaultSettings)

    expect(result.response.status).toBe(200)
    expect(result.retryCount).toBe(0)
    expect(result.loadTime).toBeGreaterThanOrEqual(0)
    expect(mockedFetch).toHaveBeenCalledTimes(1)
  })

  it('passes User-Agent header by default', async () => {
    const mockedFetch = vi.mocked(fetch)
    mockedFetch.mockResolvedValueOnce(mockResponse(200))

    await fetchWithRetry('https://example.com', defaultSettings)

    const callArgs = mockedFetch.mock.calls[0]
    const headers = callArgs[1]?.headers as Record<string, string>
    expect(headers['User-Agent']).toBe('Mozilla/5.0 (compatible; URLTools/1.0)')
  })

  it('merges custom headers with the default User-Agent', async () => {
    const mockedFetch = vi.mocked(fetch)
    mockedFetch.mockResolvedValueOnce(mockResponse(200))

    const settings: RequestSettings = {
      timeout: 10,
      retries: 0,
      headers: { Accept: 'text/html', 'X-Custom': 'test' },
    }

    await fetchWithRetry('https://example.com', settings)

    const callArgs = mockedFetch.mock.calls[0]
    const headers = callArgs[1]?.headers as Record<string, string>
    expect(headers['User-Agent']).toBe('Mozilla/5.0 (compatible; URLTools/1.0)')
    expect(headers.Accept).toBe('text/html')
    expect(headers['X-Custom']).toBe('test')
  })

  it('sanitizes custom headers (blocks dangerous ones)', async () => {
    const mockedFetch = vi.mocked(fetch)
    mockedFetch.mockResolvedValueOnce(mockResponse(200))

    const settings: RequestSettings = {
      timeout: 10,
      retries: 0,
      headers: { Accept: 'text/html', authorization: 'Bearer secret' },
    }

    await fetchWithRetry('https://example.com', settings)

    const callArgs = mockedFetch.mock.calls[0]
    const headers = callArgs[1]?.headers as Record<string, string>
    expect(headers.Accept).toBe('text/html')
    // authorization should be stripped by sanitizeHeaders
    expect(headers.authorization).toBeUndefined()
  })

  it('retries on 5xx errors and eventually succeeds', async () => {
    const mockedFetch = vi.mocked(fetch)
    mockedFetch
      .mockResolvedValueOnce(mockResponse(500, 'server error'))
      .mockResolvedValueOnce(mockResponse(200, 'ok'))

    const result = await fetchWithRetry('https://example.com', defaultSettings)

    expect(result.response.status).toBe(200)
    expect(result.retryCount).toBe(1)
    expect(mockedFetch).toHaveBeenCalledTimes(2)
  })

  it('retries multiple times on consecutive 5xx errors', async () => {
    const mockedFetch = vi.mocked(fetch)
    mockedFetch
      .mockResolvedValueOnce(mockResponse(503))
      .mockResolvedValueOnce(mockResponse(502))
      .mockResolvedValueOnce(mockResponse(200, 'finally'))

    const result = await fetchWithRetry('https://example.com', defaultSettings)

    expect(result.response.status).toBe(200)
    expect(result.retryCount).toBe(2)
    expect(mockedFetch).toHaveBeenCalledTimes(3)
  })

  it('returns the 5xx response when retries are exhausted', async () => {
    const mockedFetch = vi.mocked(fetch)
    mockedFetch
      .mockResolvedValueOnce(mockResponse(500))
      .mockResolvedValueOnce(mockResponse(500))
      .mockResolvedValueOnce(mockResponse(500))

    // With retries=2, there are 3 total attempts (0, 1, 2).
    // On the last attempt (attempt === retries), a 5xx is returned as-is
    // because the condition `attempt < retries` is false.
    const result = await fetchWithRetry('https://example.com', defaultSettings)

    expect(result.response.status).toBe(500)
    expect(result.retryCount).toBe(2)
    expect(mockedFetch).toHaveBeenCalledTimes(3)
  })

  it('does not retry 4xx client errors', async () => {
    const mockedFetch = vi.mocked(fetch)
    mockedFetch.mockResolvedValueOnce(mockResponse(404, 'not found'))

    const result = await fetchWithRetry('https://example.com', defaultSettings)

    expect(result.response.status).toBe(404)
    expect(result.retryCount).toBe(0)
    expect(mockedFetch).toHaveBeenCalledTimes(1)
  })

  it('throws after max retries when fetch itself throws', async () => {
    const mockedFetch = vi.mocked(fetch)
    const networkError = new Error('Network error')
    mockedFetch
      .mockRejectedValueOnce(networkError)
      .mockRejectedValueOnce(networkError)
      .mockRejectedValueOnce(networkError)

    await expect(
      fetchWithRetry('https://example.com', defaultSettings),
    ).rejects.toThrow('Network error')

    expect(mockedFetch).toHaveBeenCalledTimes(3)
  })

  it('retries on fetch error and then succeeds', async () => {
    const mockedFetch = vi.mocked(fetch)
    mockedFetch
      .mockRejectedValueOnce(new Error('Connection reset'))
      .mockResolvedValueOnce(mockResponse(200, 'ok'))

    const result = await fetchWithRetry('https://example.com', defaultSettings)

    expect(result.response.status).toBe(200)
    expect(result.retryCount).toBe(1)
  })

  it('wraps non-Error thrown values into an Error', async () => {
    const mockedFetch = vi.mocked(fetch)
    mockedFetch
      .mockRejectedValueOnce('string error')
      .mockRejectedValueOnce('string error')
      .mockRejectedValueOnce('string error')

    await expect(
      fetchWithRetry('https://example.com', defaultSettings),
    ).rejects.toThrow('Unknown error')
  })

  it('passes AbortController signal to fetch for timeout support', async () => {
    const mockedFetch = vi.mocked(fetch)
    mockedFetch.mockResolvedValueOnce(mockResponse(200))

    await fetchWithRetry('https://example.com', { timeout: 5, retries: 0 })

    const callArgs = mockedFetch.mock.calls[0]
    expect(callArgs[1]?.signal).toBeInstanceOf(AbortSignal)
  })

  it('works with retries=0 (no retries, single attempt)', async () => {
    const mockedFetch = vi.mocked(fetch)
    mockedFetch.mockResolvedValueOnce(mockResponse(500))

    const settings: RequestSettings = { timeout: 10, retries: 0 }
    const result = await fetchWithRetry('https://example.com', settings)

    // With retries=0, the loop runs once (attempt 0 only).
    // 500 on attempt 0 with attempt < retries (0 < 0) = false, so it returns.
    expect(result.response.status).toBe(500)
    expect(result.retryCount).toBe(0)
    expect(mockedFetch).toHaveBeenCalledTimes(1)
  })

  it('throws on single fetch error with retries=0', async () => {
    const mockedFetch = vi.mocked(fetch)
    mockedFetch.mockRejectedValueOnce(new Error('fail'))

    const settings: RequestSettings = { timeout: 10, retries: 0 }

    await expect(
      fetchWithRetry('https://example.com', settings),
    ).rejects.toThrow('fail')

    expect(mockedFetch).toHaveBeenCalledTimes(1)
  })
})
