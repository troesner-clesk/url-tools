/**
 * A fast, dependency-free Simhash implementation for Near-Duplicate Detection.
 * Generates a 32-bit fingerprint of text where similar texts map to similar hashes.
 */

// Simple 32-bit FNV-1a hash function
function fnv32a(str: string): number {
  let hval = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    hval ^= str.charCodeAt(i)
    hval += (hval << 1) + (hval << 4) + (hval << 7) + (hval << 8) + (hval << 24)
  }
  return hval >>> 0
}

/**
 * Tokenizes text into word-shingles (bi-grams)
 */
function getShingles(text: string): string[] {
  // Normalize text: lowercase, keep only alphanumeric
  const normalized = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
  const words = normalized.split(' ')
  const shingles: string[] = []

  if (words.length < 2) return words

  // Create bi-grams
  for (let i = 0; i < words.length - 1; i++) {
    shingles.push(`${words[i]} ${words[i + 1]}`)
  }
  return shingles
}

/**
 * Computes a 32-bit Simhash for a given string
 */
export function computeSimhash(text: string): number {
  const shingles = getShingles(text)
  const v = new Int32Array(32)

  for (const shingle of shingles) {
    const hash = fnv32a(shingle)
    for (let i = 0; i < 32; i++) {
      const bit = (hash >> i) & 1
      v[i] += bit ? 1 : -1
    }
  }

  let fingerprint = 0
  for (let i = 0; i < 32; i++) {
    if (v[i] >= 0) {
      fingerprint |= 1 << i
    }
  }
  return fingerprint >>> 0
}

/**
 * Calculates the Hamming distance (number of differing bits) between two 32-bit integers.
 * Distance interpretation for Simhash:
 * 0: Identical text
 * 1-3: Near duplicates (very minor differences)
 * 4-7: Strong similarity
 * >10 : Different texts
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
