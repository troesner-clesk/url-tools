import { describe, expect, it } from 'vitest'
import { decideEmitInbound } from '../inbound-stream-helpers'

describe('decideEmitInbound', () => {
  const CAP = 100

  it('emits a fresh pair and adds it to the emitted set', () => {
    const emitted = new Set<string>()
    const result = decideEmitInbound('a', 'b', emitted, 0, CAP)
    expect(result).toEqual({ kind: 'emit', capReached: false })
    expect(emitted.has('a|b')).toBe(true)
  })

  it('skips an already-emitted pair without modifying the set', () => {
    const emitted = new Set<string>(['a|b'])
    const result = decideEmitInbound('a', 'b', emitted, 5, CAP)
    expect(result).toEqual({ kind: 'skip' })
    expect(emitted.size).toBe(1)
  })

  it('signals capReached when inboundFound + 1 reaches cap', () => {
    const emitted = new Set<string>()
    const result = decideEmitInbound('a', 'b', emitted, CAP - 1, CAP)
    expect(result).toEqual({ kind: 'emit', capReached: true })
  })

  it('signals capReached when inboundFound is already at cap', () => {
    const emitted = new Set<string>()
    const result = decideEmitInbound('x', 'y', emitted, CAP, CAP)
    expect(result).toEqual({ kind: 'emit', capReached: true })
  })

  it('treats different sources to same target as distinct', () => {
    const emitted = new Set<string>()
    decideEmitInbound('a', 'target', emitted, 0, CAP)
    const second = decideEmitInbound('b', 'target', emitted, 1, CAP)
    expect(second).toEqual({ kind: 'emit', capReached: false })
    expect(emitted.size).toBe(2)
  })

  it('treats same source to different targets as distinct', () => {
    const emitted = new Set<string>()
    decideEmitInbound('source', 'a', emitted, 0, CAP)
    const second = decideEmitInbound('source', 'b', emitted, 1, CAP)
    expect(second).toEqual({ kind: 'emit', capReached: false })
    expect(emitted.size).toBe(2)
  })

  it('uses pipe-separated keys (collision check for | in URLs)', () => {
    // URLs in practice do not contain raw '|' characters, but just in case
    // the format ever needs to change, the test pins the current behavior.
    const emitted = new Set<string>()
    decideEmitInbound('a|b', 'c', emitted, 0, CAP)
    const second = decideEmitInbound('a', 'b|c', emitted, 1, CAP)
    // Both serialize to "a|b|c" — current behavior treats them as the same.
    expect(second).toEqual({ kind: 'skip' })
  })
})
