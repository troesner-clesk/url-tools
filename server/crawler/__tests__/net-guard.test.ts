import { afterEach, describe, expect, it } from 'vitest'
import {
  assertCrawlableUrl,
  BlockedTargetError,
  blockedAddressReason,
  guardedLookup,
} from '../net-guard'

afterEach(() => {
  delete process.env.URL_TOOLS_ALLOW_LOCALHOST
})

describe('blockedAddressReason', () => {
  it.each([
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.178.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '255.255.255.255',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    '::',
    '::ffff:10.0.0.1',
    '::ffff:169.254.169.254',
    '64:ff9b::10.0.0.1',
  ])('blocks private or reserved address %s', (ip) => {
    expect(blockedAddressReason(ip, false)).not.toBeNull()
  })

  it.each([
    '127.0.0.1',
    '127.1.2.3',
    '::1',
    '::ffff:127.0.0.1',
  ])('blocks loopback %s unless explicitly allowed', (ip) => {
    expect(blockedAddressReason(ip, false)).toBe('loopback address')
    expect(blockedAddressReason(ip, true)).toBeNull()
  })

  it.each([
    '93.184.215.14',
    '1.1.1.1',
    '2a00:1450:4001:82a::200e',
    '64:ff9b::8.8.8.8',
  ])('allows public address %s', (ip) => {
    expect(blockedAddressReason(ip, false)).toBeNull()
  })
})

describe('assertCrawlableUrl', () => {
  it('accepts public http(s) URLs', () => {
    expect(assertCrawlableUrl('https://example.com/a?b=1').hostname).toBe(
      'example.com',
    )
  })

  it.each([
    'ftp://example.com/',
    'file:///etc/passwd',
    'http://user:pass@example.com/',
    'http://10.0.0.1/',
    'http://[::1]/',
    'http://0x7f000001/',
    'http://2130706433/',
    'http://localhost:3000/',
    'http://app.localhost/',
    'not a url',
  ])('rejects %s', (url) => {
    expect(() => assertCrawlableUrl(url)).toThrow(BlockedTargetError)
  })

  it('allows loopback only with URL_TOOLS_ALLOW_LOCALHOST=1', () => {
    process.env.URL_TOOLS_ALLOW_LOCALHOST = '1'
    expect(() => assertCrawlableUrl('http://127.0.0.1:8080/')).not.toThrow()
    expect(() => assertCrawlableUrl('http://localhost:8080/')).not.toThrow()
    expect(() => assertCrawlableUrl('http://192.168.0.1/')).toThrow(
      BlockedTargetError,
    )
  })
})

describe('guardedLookup', () => {
  it('refuses hostnames that resolve to loopback', async () => {
    const error = await new Promise<Error | null>((resolve) =>
      guardedLookup('localhost', {}, (err) => resolve(err)),
    )
    expect(error).toBeInstanceOf(BlockedTargetError)
  })

  it('returns all addresses when asked (happy eyeballs)', async () => {
    process.env.URL_TOOLS_ALLOW_LOCALHOST = '1'
    const result = await new Promise<unknown>((resolve, reject) =>
      guardedLookup('localhost', { all: true }, (err, addresses) =>
        err ? reject(err) : resolve(addresses),
      ),
    )
    expect(Array.isArray(result)).toBe(true)
    expect((result as unknown[]).length).toBeGreaterThan(0)
  })
})
