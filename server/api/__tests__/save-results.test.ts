import { afterEach, describe, expect, it, vi } from 'vitest'
import { getTimestamp, sanitizeFilename } from '../save-results.post'

describe('sanitizeFilename', () => {
  it('strips protocol and converts URL to filename', () => {
    expect(sanitizeFilename('https://example.com/page')).toBe(
      'example.com_page',
    )
  })

  it('handles root URL (trailing slash becomes underscore)', () => {
    expect(sanitizeFilename('https://example.com/')).toBe('example.com_')
  })

  it('ignores query parameters (only hostname + pathname are used)', () => {
    // URL.pathname does not include the query string
    expect(sanitizeFilename('https://example.com/path?q=1&b=2')).toBe(
      'example.com_path',
    )
  })

  it('collapses consecutive underscores into one', () => {
    // Multiple slashes or special chars in a row become a single underscore
    expect(sanitizeFilename('https://example.com///deep///path')).toBe(
      'example.com_deep_path',
    )
  })

  it('preserves dots and hyphens in the hostname', () => {
    expect(sanitizeFilename('https://sub.example-site.com/page')).toBe(
      'sub.example-site.com_page',
    )
  })

  it('caps filename at 100 characters', () => {
    const longPath = '/a'.repeat(200)
    const result = sanitizeFilename(`https://example.com${longPath}`)
    expect(result.length).toBeLessThanOrEqual(100)
  })

  it('returns exactly 100 characters for very long URLs', () => {
    const longPath = `/${'abcdefghij'.repeat(20)}` // 200+ chars of path
    const result = sanitizeFilename(`https://example.com${longPath}`)
    expect(result.length).toBe(100)
  })

  it('returns "unknown" for invalid URL strings', () => {
    expect(sanitizeFilename('not a url')).toBe('unknown')
    expect(sanitizeFilename('')).toBe('unknown')
    expect(sanitizeFilename('://missing-protocol')).toBe('unknown')
  })

  it('drops query parameters and fragments from the filename', () => {
    // URL constructor puts query in .search and fragment in .hash,
    // neither of which is part of .pathname
    const result = sanitizeFilename(
      'https://example.com/page?key=value#section',
    )
    expect(result).toBe('example.com_page')
  })

  it('handles URLs with port numbers', () => {
    // Port is not part of hostname or pathname in URL constructor
    const result = sanitizeFilename('https://example.com:8080/path')
    expect(result).toBe('example.com_path')
  })

  it('handles URL with special characters in path', () => {
    const result = sanitizeFilename('https://example.com/path/to/file%20name')
    expect(result).toBe('example.com_path_to_file_20name')
  })
})

describe('getTimestamp', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns a string in the expected format YYYY-MM-DD_HH-MM-SS', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-26T14:30:45.123Z'))

    const result = getTimestamp()
    expect(result).toBe('2026-03-26_14-30-45')
  })

  it('pads single-digit months and days', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-05T09:05:03.000Z'))

    const result = getTimestamp()
    expect(result).toBe('2026-01-05_09-05-03')
  })

  it('returns exactly 19 characters', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-12-31T23:59:59.999Z'))

    const result = getTimestamp()
    expect(result.length).toBe(19)
  })

  it('replaces colons and dots with hyphens', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-15T10:20:30.456Z'))

    const result = getTimestamp()
    expect(result).not.toContain(':')
    expect(result).not.toContain('.')
  })

  it('replaces T separator with underscore', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-15T10:20:30.000Z'))

    const result = getTimestamp()
    expect(result).not.toContain('T')
    expect(result).toContain('_')
  })
})
