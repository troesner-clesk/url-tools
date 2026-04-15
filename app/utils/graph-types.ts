export type SizeMode = 'inbound' | 'outbound' | 'equal'
export type LinkEdgeMode = 'hover' | 'always' | 'hidden'
export type LabelMode = 'always' | 'hover' | 'never'

/**
 * Statistics shown in the GraphSidebar. Kept minimal — only id + inboundCount
 * for topTarget, not the full SimNode, so the component boundary is narrow.
 */
export interface GraphStats {
  nodeCount: number
  edgeCount: number
  targetCount: number
  orphanCount: number
  hubCount: number
  topTarget: { id: string; inboundCount: number } | null
}
