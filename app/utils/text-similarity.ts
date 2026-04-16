/**
 * Hamming distance between two 32-bit unsigned integers (count of
 * differing bits). Mirror of `server/utils/text-similarity.ts` so the
 * Silo / SEO Audit UI can compare Simhashes produced server-side.
 *
 * The distance scale for content Simhashes:
 * - 0:   identical text
 * - 1–3: near-duplicate (minor edits)
 * - 4–7: strong similarity
 * - >10: different content
 */
export function hammingDistance(hash1: number, hash2: number): number {
  let xor = (hash1 ^ hash2) >>> 0
  let distance = 0
  while (xor > 0) {
    distance += xor & 1
    xor >>>= 1
  }
  return distance
}
