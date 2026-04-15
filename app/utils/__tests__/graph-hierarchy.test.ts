import { describe, expect, it } from 'vitest'
import { pathDepth, resolveParentId } from '../graph-hierarchy'

describe('pathDepth', () => {
  it('returns 0 for root URL', () => {
    expect(pathDepth('https://x.com/')).toBe(0)
    expect(pathDepth('https://x.com')).toBe(0)
  })

  it('counts non-empty path segments', () => {
    expect(pathDepth('https://x.com/a')).toBe(1)
    expect(pathDepth('https://x.com/a/b/c')).toBe(3)
  })

  it('ignores trailing slash', () => {
    expect(pathDepth('https://x.com/a/b/c/')).toBe(3)
    expect(pathDepth('https://x.com/a/b/c///')).toBe(3)
  })

  it('returns 0 for invalid URLs', () => {
    expect(pathDepth('not-a-url')).toBe(0)
    expect(pathDepth('')).toBe(0)
  })
})

describe('resolveParentId', () => {
  it('finds direct parent (with trailing slash)', () => {
    const ids = new Set(['https://x.com/wiki/'])
    expect(resolveParentId('https://x.com/wiki/griff', ids)).toBe(
      'https://x.com/wiki/',
    )
  })

  it('finds direct parent (without trailing slash)', () => {
    const ids = new Set(['https://x.com/wiki'])
    expect(resolveParentId('https://x.com/wiki/griff', ids)).toBe(
      'https://x.com/wiki',
    )
  })

  it('falls back to origin root', () => {
    const ids = new Set(['https://x.com/'])
    expect(resolveParentId('https://x.com/wiki/griff', ids)).toBe(
      'https://x.com/',
    )
  })

  it('returns null when no ancestor matches', () => {
    const ids = new Set(['https://x.com/other/'])
    expect(resolveParentId('https://x.com/wiki/griff', ids)).toBeNull()
  })

  it('returns null for root URL', () => {
    const ids = new Set(['https://x.com/'])
    expect(resolveParentId('https://x.com/', ids)).toBeNull()
  })

  it('does not cross origins (no fallback to a different domain)', () => {
    const ids = new Set(['https://a.com/'])
    expect(resolveParentId('https://b.com/x', ids)).toBeNull()
  })

  it('walks up multiple levels until a match is found', () => {
    const ids = new Set(['https://x.com/a/'])
    // /a/b/c → /a/b (no), /a (yes)
    expect(resolveParentId('https://x.com/a/b/c', ids)).toBe('https://x.com/a/')
  })

  it('prefers closest ancestor when multiple match', () => {
    const ids = new Set([
      'https://x.com/',
      'https://x.com/a/',
      'https://x.com/a/b/',
    ])
    expect(resolveParentId('https://x.com/a/b/c', ids)).toBe(
      'https://x.com/a/b/',
    )
  })

  it('returns null on invalid URL input', () => {
    expect(resolveParentId('not-a-url', new Set())).toBeNull()
  })

  // KNOWN LIMITATION — documented by snapshot
  it('does NOT match parent across query strings (exact-string match only)', () => {
    const ids = new Set(['https://x.com/blog/'])
    expect(resolveParentId('https://x.com/blog?page=2', ids)).toBeNull()
  })
})
