import { normalizeUrl } from './link-analyzer'

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

export function normalizeTargets(targets: string[]): Set<string> {
  const set = new Set<string>()
  for (const target of targets) {
    const normalized = normalizeUrl(target)
    if (normalized) set.add(normalized)
  }
  return set
}

export function matchesTarget(
  targetUrl: string,
  normalizedTargets: Set<string>,
): boolean {
  const normalized = normalizeUrl(targetUrl)
  if (!normalized) return false
  return normalizedTargets.has(normalized)
}

export function aggregateInboundLinks(results: InboundLink[]): InboundGroup[] {
  const groupMap = new Map<string, InboundGroup>()

  for (const link of results) {
    let group = groupMap.get(link.targetUrl)
    if (!group) {
      group = {
        targetUrl: link.targetUrl,
        inboundCount: 0,
        uniqueSources: 0,
        sources: [],
        anchorDistribution: {},
      }
      groupMap.set(link.targetUrl, group)
    }

    group.inboundCount++

    const anchorKey = link.anchorText.trim() || '(no anchor text)'
    group.anchorDistribution[anchorKey] =
      (group.anchorDistribution[anchorKey] || 0) + 1

    let source = group.sources.find((s) => s.sourceUrl === link.sourceUrl)
    if (!source) {
      source = { sourceUrl: link.sourceUrl, anchorTexts: [], rels: [] }
      group.sources.push(source)
    }
    source.anchorTexts.push(link.anchorText)
    if (link.rel && !source.rels.includes(link.rel)) {
      source.rels.push(link.rel)
    }
  }

  for (const group of groupMap.values()) {
    group.uniqueSources = group.sources.length
  }

  return Array.from(groupMap.values()).sort(
    (a, b) => b.inboundCount - a.inboundCount,
  )
}
