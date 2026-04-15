export interface InboundLink {
  sourceUrl: string
  targetUrl: string
  anchorText: string
  rel: string
  sourceStatus: number
  depth: number
}

export interface InboundSource {
  sourceUrl: string
  anchorTexts: string[]
  rels: string[]
}

export interface InboundGroup {
  targetUrl: string
  inboundCount: number
  uniqueSources: number
  sources: InboundSource[]
  anchorDistribution: Record<string, number>
}

export function aggregateInboundLinks(
  results: InboundLink[],
): InboundGroup[] {
  const map = new Map<string, InboundGroup>()

  for (const link of results) {
    let group = map.get(link.targetUrl)
    if (!group) {
      group = {
        targetUrl: link.targetUrl,
        inboundCount: 0,
        uniqueSources: 0,
        sources: [],
        anchorDistribution: {},
      }
      map.set(link.targetUrl, group)
    }
    group.inboundCount++
    const anchorKey = link.anchorText.trim() || '(no anchor text)'
    group.anchorDistribution[anchorKey] =
      (group.anchorDistribution[anchorKey] || 0) + 1

    let src = group.sources.find((s) => s.sourceUrl === link.sourceUrl)
    if (!src) {
      src = { sourceUrl: link.sourceUrl, anchorTexts: [], rels: [] }
      group.sources.push(src)
    }
    src.anchorTexts.push(link.anchorText)
    if (link.rel && !src.rels.includes(link.rel)) src.rels.push(link.rel)
  }

  for (const g of map.values()) g.uniqueSources = g.sources.length

  return Array.from(map.values()).sort(
    (a, b) => b.inboundCount - a.inboundCount,
  )
}
