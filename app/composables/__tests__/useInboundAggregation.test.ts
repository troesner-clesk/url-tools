/**
 * Cross-implementation parity test: the frontend-side `aggregateInboundLinks`
 * (in `app/composables/useInboundAggregation.ts`) and the server-side variant
 * (in `server/utils/inbound-matcher.ts`) are intentional duplicates so they
 * can run in either runtime without a shared dependency. This test pins them
 * to identical output — if they ever drift, the test fails immediately.
 */
import { describe, expect, it } from 'vitest'
import {
  aggregateInboundLinks as serverAggregate,
  type InboundLink,
} from '../../../server/utils/inbound-matcher'
import { aggregateInboundLinks as frontendAggregate } from '../useInboundAggregation'

const SAMPLE: InboundLink[] = [
  {
    sourceUrl: 'https://x.com/a',
    targetUrl: 'https://x.com/target',
    anchorText: 'click here',
    rel: 'nofollow',
    sourceStatus: 200,
    depth: 1,
  },
  {
    sourceUrl: 'https://x.com/a',
    targetUrl: 'https://x.com/target',
    anchorText: 'and again',
    rel: '',
    sourceStatus: 200,
    depth: 1,
  },
  {
    sourceUrl: 'https://x.com/b',
    targetUrl: 'https://x.com/target',
    anchorText: '',
    rel: 'ugc',
    sourceStatus: 200,
    depth: 2,
  },
  {
    sourceUrl: 'https://x.com/b',
    targetUrl: 'https://x.com/other',
    anchorText: 'side',
    rel: '',
    sourceStatus: 200,
    depth: 2,
  },
]

describe('aggregateInboundLinks: frontend ≡ server', () => {
  it('returns identical output for non-trivial input', () => {
    expect(frontendAggregate(SAMPLE)).toEqual(serverAggregate(SAMPLE))
  })

  it('returns identical output for empty input', () => {
    expect(frontendAggregate([])).toEqual(serverAggregate([]))
  })

  it('returns identical output for a single link', () => {
    const single: InboundLink[] = [SAMPLE[0]!]
    expect(frontendAggregate(single)).toEqual(serverAggregate(single))
  })
})
