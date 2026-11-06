import { lookup } from 'node:dns/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BlockedUrlError,
  blockedBrowserRequestReason,
  blockedTargetReason,
  safeFetch,
} from '../safe-fetch'

vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }))

const ADDRESSES: Record<string, string> = {
  'public.example': '93.184.215.14',
  'other.example': '1.1.1.1',
  'internal.example': '10.0.0.5',
  'rebind.example': '169.254.169.254',
}

function response(status: number, headers: Record<string, string> = {}) {
  return new Response(status >= 300 && status < 400 ? null : 'ok', {
    status,
    headers,
  })
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
  vi.mocked(lookup).mockImplementation((async (host: string) => {
    const address = ADDRESSES[host]
    if (!address)
      throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' })
    return [{ address, family: 4 }]
  }) as never)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.mocked(lookup).mockReset()
})

describe('safeFetch', () => {
  it('fetches public targets and never lets fetch follow redirects itself', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response(200))
    const res = await safeFetch('https://public.example/page', {
      method: 'HEAD',
    })
    expect(res.status).toBe(200)
    expect(vi.mocked(fetch).mock.calls[0]?.[1]).toMatchObject({
      method: 'HEAD',
      redirect: 'manual',
    })
  })

  it('blocks hostnames that resolve to private addresses before any request', async () => {
    await expect(safeFetch('https://internal.example/')).rejects.toThrow(
      BlockedUrlError,
    )
    expect(fetch).not.toHaveBeenCalled()
  })

  it('follows redirects and checks every hop', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(response(301, { location: '/moved' }))
      .mockResolvedValueOnce(
        response(302, { location: 'https://other.example/x' }),
      )
      .mockResolvedValueOnce(response(200))
    const res = await safeFetch('https://public.example/start')
    expect(res.status).toBe(200)
    expect(vi.mocked(fetch).mock.calls.map((c) => c[0])).toEqual([
      'https://public.example/start',
      'https://public.example/moved',
      'https://other.example/x',
    ])
  })

  it.each([
    'http://169.254.169.254/latest/meta-data/',
    'http://127.0.0.1:8080/admin',
    'https://rebind.example/',
  ])('stops a redirect to %s', async (target) => {
    vi.mocked(fetch).mockResolvedValueOnce(response(302, { location: target }))
    await expect(safeFetch('https://public.example/')).rejects.toThrow(
      BlockedUrlError,
    )
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('lets fetch report unresolvable hosts itself', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('fetch failed'))
    await expect(safeFetch('https://does-not-exist.example/')).rejects.toThrow(
      'fetch failed',
    )
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('gives up after too many redirects', async () => {
    vi.mocked(fetch).mockImplementation(async () =>
      response(301, { location: '/again' }),
    )
    await expect(safeFetch('https://public.example/', {}, 3)).rejects.toThrow(
      'More than 3 redirects',
    )
  })
})

describe('blockedTargetReason / blockedBrowserRequestReason', () => {
  it('explains why a target is blocked', async () => {
    expect(await blockedTargetReason('https://public.example/')).toBeNull()
    expect(await blockedTargetReason('https://internal.example/')).toContain(
      '10.0.0.5',
    )
    expect(await blockedTargetReason('http://[::1]/')).not.toBeNull()
  })

  it('allows data/blob URLs in the browser and blocks other schemes', async () => {
    expect(
      await blockedBrowserRequestReason('data:image/png;base64,AAAA'),
    ).toBeNull()
    expect(
      await blockedBrowserRequestReason('file:///etc/passwd'),
    ).not.toBeNull()
  })

  it('resolves each browser host once per minute', async () => {
    await blockedBrowserRequestReason('https://other.example/a.css')
    await blockedBrowserRequestReason('https://other.example/b.js')
    expect(lookup).toHaveBeenCalledTimes(1)
  })
})
