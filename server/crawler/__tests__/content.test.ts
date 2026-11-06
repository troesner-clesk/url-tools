import { describe, expect, it } from 'vitest'
import { isValidHreflang } from '../analyze'
import {
  countWords,
  exactContentHash,
  hammingDistance,
  parseSimhash,
  simhash64,
} from '../content'
import { prose } from './fixtures/site'

describe('text fingerprints', () => {
  it('counts Unicode words', () => {
    expect(countWords('Größe, Maße & Öffnungszeiten – 24/7')).toBe(5)
  })

  it('hashes normalized words, ignoring case and punctuation', () => {
    expect(exactContentHash('Hello,  World!')).toBe(
      exactContentHash('hello world'),
    )
    expect(exactContentHash('')).toBe('')
  })

  it('keeps near-duplicates close and different texts far apart', () => {
    const base = prose(1, 300)
    const near = simhash64(`${base} extra`)
    const same = parseSimhash(simhash64(base))
    const other = parseSimhash(simhash64(prose(2, 300)))
    const close = parseSimhash(near)
    if (!same || !other || !close) throw new Error('invalid simhash')
    expect(hammingDistance(same, close)).toBeLessThanOrEqual(3)
    expect(hammingDistance(same, other)).toBeGreaterThan(10)
  })
})

describe('isValidHreflang', () => {
  it.each([
    'de',
    'de-AT',
    'en-GB',
    'zh-Hans',
    'zh-Hant-TW',
    'es-419',
    'x-default',
    'EN-gb',
  ])('accepts %s', (code) => {
    expect(isValidHreflang(code)).toBe(true)
  })

  it.each([
    'en-UK',
    'english',
    'de_DE',
    'xx',
    'en-XX',
    '',
  ])('rejects %s', (code) => {
    expect(isValidHreflang(code)).toBe(false)
  })
})
