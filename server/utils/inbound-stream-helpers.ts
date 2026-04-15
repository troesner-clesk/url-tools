/**
 * Decision returned by `decideEmitInbound` for a discovered (source, target)
 * pair while streaming inbound results.
 */
export type EmitDecision =
  | { kind: 'emit'; capReached: boolean }
  | { kind: 'skip' }

/**
 * Decides whether an inbound (source → target) edge should be emitted by the
 * SSE stream handler, deduplicating identical pairs and signalling when the
 * result cap is reached.
 *
 * Mutates `emitted` by inserting the new key when emit is decided. After an
 * emit, `capReached` is true if `inboundFound + 1 >= cap` — i.e. the caller
 * should increment `inboundFound` and then stop the loop.
 */
export function decideEmitInbound(
  source: string,
  target: string,
  emitted: Set<string>,
  inboundFound: number,
  cap: number,
): EmitDecision {
  const key = `${source}|${target}`
  if (emitted.has(key)) return { kind: 'skip' }
  emitted.add(key)
  return { kind: 'emit', capReached: inboundFound + 1 >= cap }
}
