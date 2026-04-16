import { describe, expect, it } from 'vitest'
import { computeSimhash, hammingDistance } from '../text-similarity'

describe('computeSimhash', () => {
  it('returns the same hash for identical input', () => {
    const text = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.'
    expect(computeSimhash(text)).toBe(computeSimhash(text))
  })

  it('normalizes case and punctuation', () => {
    const a = 'Hello World foo bar baz'
    const b = 'hello, world! FOO bar baz.'
    expect(computeSimhash(a)).toBe(computeSimhash(b))
  })

  it('produces a small Hamming distance for near-duplicates', () => {
    const a =
      'The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs.'
    const b =
      'The quick brown fox jumps over the lazy cat. Pack my box with five dozen liquor jugs.'
    expect(hammingDistance(computeSimhash(a), computeSimhash(b))).toBeLessThan(
      8,
    )
  })

  it('produces a large Hamming distance for unrelated text', () => {
    const a =
      'Kunststofffenster sind energieeffizient und pflegeleicht. Sie bieten gute Wärmedämmung und sind in vielen Stilen verfügbar.'
    const b =
      'The Roman Empire was founded in 27 BC by Augustus after he emerged victorious from the civil wars that followed the assassination of Julius Caesar.'
    expect(
      hammingDistance(computeSimhash(a), computeSimhash(b)),
    ).toBeGreaterThan(8)
  })

  it('returns a non-negative 32-bit unsigned integer', () => {
    const h = computeSimhash('something arbitrary here to hash')
    expect(h).toBeGreaterThanOrEqual(0)
    expect(h).toBeLessThan(2 ** 32)
    expect(Number.isInteger(h)).toBe(true)
  })

  it('handles short/single-word text without crashing', () => {
    expect(() => computeSimhash('hi')).not.toThrow()
    expect(() => computeSimhash('')).not.toThrow()
  })
})

describe('hammingDistance', () => {
  it('returns 0 for identical hashes', () => {
    expect(hammingDistance(0xdeadbeef, 0xdeadbeef)).toBe(0)
    expect(hammingDistance(0, 0)).toBe(0)
  })

  it('counts differing bits', () => {
    // 0b0001 vs 0b0010 → 2 bits differ
    expect(hammingDistance(1, 2)).toBe(2)
    // 0xff vs 0x00 → 8 bits differ
    expect(hammingDistance(0xff, 0x00)).toBe(8)
    // All 32 bits flipped
    expect(hammingDistance(0x00000000, 0xffffffff)).toBe(32)
  })

  it('is symmetric', () => {
    const a = 0x12345678
    const b = 0xabcdef00
    expect(hammingDistance(a, b)).toBe(hammingDistance(b, a))
  })
})
