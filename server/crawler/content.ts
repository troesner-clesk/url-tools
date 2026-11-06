import { createHash } from 'node:crypto'

/**
 * Text fingerprints for duplicate detection. Unicode-aware, so German
 * umlauts and other non-ASCII letters count as word characters.
 */

const WORD = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu

export function words(text: string): string[] {
  return text.toLowerCase().match(WORD) ?? []
}

export function countWords(text: string): number {
  return text.match(WORD)?.length ?? 0
}

/** SHA-1 of the normalized word sequence; '' for pages without text. */
export function exactContentHash(text: string): string {
  const tokens = words(text)
  if (tokens.length === 0) return ''
  return createHash('sha1').update(tokens.join(' ')).digest('hex')
}

function fnv1a32(input: string, offsetBasis: number): number {
  let hash = offsetBasis
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/**
 * 64-bit SimHash over word bi-grams, returned as 16 hex characters.
 * 32 bits (as in `server/utils/text-similarity.ts`) produce too many chance
 * collisions once thousands of pages are compared pairwise.
 */
export function simhash64(text: string): string {
  const tokens = words(text)
  const shingles =
    tokens.length < 2
      ? tokens
      : tokens.slice(0, -1).map((token, i) => `${token} ${tokens[i + 1]}`)
  if (shingles.length === 0) return ''

  const weights = new Int32Array(64)
  for (const shingle of shingles) {
    const hi = fnv1a32(shingle, 0x811c9dc5)
    const lo = fnv1a32(shingle, 0x050c5d1f)
    for (let bit = 0; bit < 32; bit++) {
      weights[bit] = (weights[bit] ?? 0) + ((lo >>> bit) & 1 ? 1 : -1)
      weights[bit + 32] = (weights[bit + 32] ?? 0) + ((hi >>> bit) & 1 ? 1 : -1)
    }
  }
  let lo = 0
  let hi = 0
  for (let bit = 0; bit < 32; bit++) {
    if ((weights[bit] ?? 0) >= 0) lo |= 1 << bit
    if ((weights[bit + 32] ?? 0) >= 0) hi |= 1 << bit
  }
  return (
    (hi >>> 0).toString(16).padStart(8, '0') +
    (lo >>> 0).toString(16).padStart(8, '0')
  )
}

function popcount32(value: number): number {
  let x = value >>> 0
  x -= (x >>> 1) & 0x55555555
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333)
  return Math.imul((x + (x >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24
}

/** Pre-parsed SimHash for fast pairwise comparison. */
export interface SimhashParts {
  hi: number
  lo: number
}

export function parseSimhash(hex: string): SimhashParts | null {
  if (!/^[0-9a-f]{16}$/.test(hex)) return null
  return {
    hi: Number.parseInt(hex.slice(0, 8), 16),
    lo: Number.parseInt(hex.slice(8), 16),
  }
}

export function hammingDistance(a: SimhashParts, b: SimhashParts): number {
  return popcount32(a.hi ^ b.hi) + popcount32(a.lo ^ b.lo)
}
