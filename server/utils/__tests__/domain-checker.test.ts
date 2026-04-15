import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  checkDomain,
  type DomainCheckResult,
} from '../domain-checker'

// Mock node:dns so we can control lookup behavior deterministically.
vi.mock('node:dns', () => {
  const lookup = vi.fn()
  return {
    promises: { lookup },
    default: { promises: { lookup } },
  }
})

// Import mocked dns after vi.mock so we get the mocked instance
import { promises as dns } from 'node:dns'

const mockedLookup = vi.mocked(dns.lookup)

function makeCache(): Map<string, Promise<DomainCheckResult>> {
  return new Map()
}

function nxdomainError(): NodeJS.ErrnoException {
  const err = new Error('getaddrinfo ENOTFOUND') as NodeJS.ErrnoException
  err.code = 'ENOTFOUND'
  return err
}

function errorWithCode(code: string): NodeJS.ErrnoException {
  const err = new Error(`getaddrinfo ${code}`) as NodeJS.ErrnoException
  err.code = code
  return err
}

describe('checkDomain', () => {
  beforeEach(() => {
    mockedLookup.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns skipped for IPv4 addresses without calling dns.lookup', async () => {
    const cache = makeCache()
    const result = await checkDomain('192.168.1.1', cache)

    expect(result.status).toBe('skipped')
    expect(mockedLookup).not.toHaveBeenCalled()
  })

  it('returns skipped for IPv6 addresses without calling dns.lookup', async () => {
    const cache = makeCache()
    const result = await checkDomain('::1', cache)

    expect(result.status).toBe('skipped')
    expect(mockedLookup).not.toHaveBeenCalled()
  })

  it('returns skipped for bracketed IPv6 addresses without calling dns.lookup', async () => {
    const cache = makeCache()
    const result = await checkDomain('[::1]', cache)

    expect(result.status).toBe('skipped')
    expect(mockedLookup).not.toHaveBeenCalled()
  })

  it('returns resolved when dns.lookup succeeds', async () => {
    mockedLookup.mockResolvedValueOnce({ address: '93.184.216.34', family: 4 })
    const cache = makeCache()

    const result = await checkDomain('example.com', cache)

    expect(result.status).toBe('resolved')
    expect(mockedLookup).toHaveBeenCalledTimes(1)
  })

  it('returns available on ENOTFOUND for a 2-part domain (no parent check possible)', async () => {
    mockedLookup.mockRejectedValueOnce(nxdomainError())
    const cache = makeCache()

    const result = await checkDomain('nonexistent-xyz.com', cache)

    expect(result.status).toBe('available')
    expect(result.error).toBe('NXDOMAIN')
    // Only one lookup (no parent probe for 2-part domain)
    expect(mockedLookup).toHaveBeenCalledTimes(1)
  })

  it('returns available on ENOTFOUND for a single-label hostname', async () => {
    mockedLookup.mockRejectedValueOnce(nxdomainError())
    const cache = makeCache()

    const result = await checkDomain('nonexistent', cache)

    expect(result.status).toBe('available')
    expect(result.error).toBe('NXDOMAIN')
    expect(mockedLookup).toHaveBeenCalledTimes(1)
  })

  it('returns subdomain-gone when leaf NXDOMAINs but parent resolves', async () => {
    // First call: subdomain NXDOMAIN. Second call: parent resolves.
    mockedLookup
      .mockRejectedValueOnce(nxdomainError())
      .mockResolvedValueOnce({ address: '93.184.216.34', family: 4 })
    const cache = makeCache()

    const result = await checkDomain('missing.example.com', cache)

    expect(result.status).toBe('subdomain-gone')
    expect(result.error).toBe('Parent example.com exists')
    expect(mockedLookup).toHaveBeenCalledTimes(2)
  })

  it('returns available when leaf NXDOMAINs and parent also NXDOMAINs', async () => {
    mockedLookup
      .mockRejectedValueOnce(nxdomainError())
      .mockRejectedValueOnce(nxdomainError())
    const cache = makeCache()

    const result = await checkDomain('missing.unregistered-xyz.com', cache)

    expect(result.status).toBe('available')
    expect(result.error).toBe('NXDOMAIN')
    expect(mockedLookup).toHaveBeenCalledTimes(2)
  })

  it('returns timeout when DNS query exceeds timeoutMs', async () => {
    // Never resolve — the withTimeout wrapper will reject.
    mockedLookup.mockImplementationOnce(
      () => new Promise(() => {}) as unknown as ReturnType<typeof dns.lookup>,
    )
    const cache = makeCache()

    const result = await checkDomain('slow.example.com', cache, 10)

    expect(result.status).toBe('timeout')
  })

  it('returns error with the code for non-NXDOMAIN DNS errors', async () => {
    mockedLookup.mockRejectedValueOnce(errorWithCode('ECONNREFUSED'))
    const cache = makeCache()

    const result = await checkDomain('broken.example.com', cache)

    expect(result.status).toBe('error')
    expect(result.error).toBe('ECONNREFUSED')
  })

  it('caches results: second call for same hostname does not invoke dns.lookup again', async () => {
    mockedLookup.mockResolvedValueOnce({ address: '93.184.216.34', family: 4 })
    const cache = makeCache()

    const first = await checkDomain('example.com', cache)
    const second = await checkDomain('example.com', cache)

    expect(first.status).toBe('resolved')
    expect(second.status).toBe('resolved')
    expect(mockedLookup).toHaveBeenCalledTimes(1)
  })

  it('dedupes parallel calls for the same hostname via in-flight promise cache', async () => {
    // Single lookup that resolves after a microtask — all parallel callers
    // should await the same promise and only trigger one dns.lookup call.
    let resolver: (value: { address: string; family: number }) => void = () => {}
    const lookupPromise = new Promise<{ address: string; family: number }>(
      (resolve) => {
        resolver = resolve
      },
    )
    mockedLookup.mockReturnValueOnce(
      lookupPromise as unknown as ReturnType<typeof dns.lookup>,
    )

    const cache = makeCache()
    const calls = Array.from({ length: 10 }, () =>
      checkDomain('example.com', cache),
    )
    resolver({ address: '93.184.216.34', family: 4 })
    const results = await Promise.all(calls)

    for (const r of results) {
      expect(r.status).toBe('resolved')
    }
    expect(mockedLookup).toHaveBeenCalledTimes(1)
  })

  it('normalizes hostnames: uppercase and trailing dot share the same cache entry', async () => {
    mockedLookup.mockResolvedValueOnce({ address: '93.184.216.34', family: 4 })
    const cache = makeCache()

    const first = await checkDomain('Example.COM.', cache)
    const second = await checkDomain('example.com', cache)

    expect(first.status).toBe('resolved')
    expect(second.status).toBe('resolved')
    expect(mockedLookup).toHaveBeenCalledTimes(1)
  })
})
