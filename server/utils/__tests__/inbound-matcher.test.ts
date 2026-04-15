import { describe, expect, it } from 'vitest'
import {
  aggregateInboundLinks,
  type InboundLink,
  matchesTarget,
  normalizeTargets,
} from '../inbound-matcher'

describe('normalizeTargets', () => {
  it('normalizes trailing slash and fragments', () => {
    const set = normalizeTargets([
      'https://example.com/foo/',
      'https://example.com/foo#section',
      'https://example.com/bar',
    ])
    expect(set.has('https://example.com/foo')).toBe(true)
    expect(set.has('https://example.com/bar')).toBe(true)
    expect(set.size).toBe(2)
  })

  it('skips invalid URLs', () => {
    const set = normalizeTargets(['not-a-url', 'https://example.com/ok'])
    expect(set.size).toBe(1)
  })
})

describe('matchesTarget', () => {
  const targets = normalizeTargets(['https://example.com/fenster'])

  it('matches exact URL', () => {
    expect(matchesTarget('https://example.com/fenster', targets)).toBe(true)
  })

  it('matches with trailing slash', () => {
    expect(matchesTarget('https://example.com/fenster/', targets)).toBe(true)
  })

  it('matches with fragment', () => {
    expect(matchesTarget('https://example.com/fenster#top', targets)).toBe(true)
  })

  it('does not match different URL', () => {
    expect(matchesTarget('https://example.com/other', targets)).toBe(false)
  })

  it('does not match different domain', () => {
    expect(matchesTarget('https://other.com/fenster', targets)).toBe(false)
  })

  it('handles query strings as distinct', () => {
    expect(matchesTarget('https://example.com/fenster?id=1', targets)).toBe(
      false,
    )
  })
})

describe('aggregateInboundLinks', () => {
  const makeLink = (partial: Partial<InboundLink>): InboundLink => ({
    sourceUrl: 'https://example.com/a',
    targetUrl: 'https://example.com/target',
    anchorText: 'click',
    rel: '',
    sourceStatus: 200,
    depth: 1,
    ...partial,
  })

  it('groups by targetUrl', () => {
    const groups = aggregateInboundLinks([
      makeLink({ targetUrl: 'https://example.com/t1' }),
      makeLink({ targetUrl: 'https://example.com/t2' }),
      makeLink({ targetUrl: 'https://example.com/t1' }),
    ])
    expect(groups).toHaveLength(2)
    const t1 = groups.find((g) => g.targetUrl === 'https://example.com/t1')!
    expect(t1.inboundCount).toBe(2)
  })

  it('counts unique sources', () => {
    const groups = aggregateInboundLinks([
      makeLink({ sourceUrl: 'https://example.com/a' }),
      makeLink({ sourceUrl: 'https://example.com/a' }),
      makeLink({ sourceUrl: 'https://example.com/b' }),
    ])
    expect(groups[0].inboundCount).toBe(3)
    expect(groups[0].uniqueSources).toBe(2)
  })

  it('builds anchor distribution', () => {
    const groups = aggregateInboundLinks([
      makeLink({ anchorText: 'fenster' }),
      makeLink({ anchorText: 'fenster' }),
      makeLink({ anchorText: 'kunststofffenster' }),
      makeLink({ anchorText: '' }),
    ])
    expect(groups[0].anchorDistribution.fenster).toBe(2)
    expect(groups[0].anchorDistribution.kunststofffenster).toBe(1)
    expect(groups[0].anchorDistribution['(no anchor text)']).toBe(1)
  })

  it('sorts by inboundCount desc', () => {
    const groups = aggregateInboundLinks([
      makeLink({ targetUrl: 'https://example.com/low' }),
      makeLink({ targetUrl: 'https://example.com/high' }),
      makeLink({ targetUrl: 'https://example.com/high' }),
      makeLink({ targetUrl: 'https://example.com/high' }),
    ])
    expect(groups[0].targetUrl).toBe('https://example.com/high')
    expect(groups[1].targetUrl).toBe('https://example.com/low')
  })

  it('returns empty array for empty input', () => {
    expect(aggregateInboundLinks([])).toEqual([])
  })

  it('collects rel values uniquely per source', () => {
    const groups = aggregateInboundLinks([
      makeLink({ sourceUrl: 'https://example.com/a', rel: 'nofollow' }),
      makeLink({ sourceUrl: 'https://example.com/a', rel: 'nofollow' }),
      makeLink({ sourceUrl: 'https://example.com/a', rel: 'ugc' }),
    ])
    expect(groups[0].sources[0].rels).toEqual(['nofollow', 'ugc'])
  })
})
