/**
 * Parity with server/utils/text-similarity.ts — the client uses only
 * the hammingDistance helper but the two must never drift.
 */
import { describe, expect, it } from 'vitest'
import { hammingDistance as serverHamming } from '../../../server/utils/text-similarity'
import { hammingDistance } from '../text-similarity'

describe('hammingDistance (client)', () => {
  it('matches server implementation', () => {
    const pairs: Array<[number, number]> = [
      [0, 0],
      [1, 2],
      [0xff, 0x00],
      [0xffffffff, 0x00000000],
      [0xdeadbeef, 0xcafebabe],
      [0x12345678, 0xabcdef00],
    ]
    for (const [a, b] of pairs) {
      expect(hammingDistance(a, b)).toBe(serverHamming(a, b))
    }
  })

  it('returns 0 for identical', () => {
    expect(hammingDistance(0xdeadbeef, 0xdeadbeef)).toBe(0)
  })

  it('counts differing bits', () => {
    expect(hammingDistance(0x00000000, 0xffffffff)).toBe(32)
  })
})
