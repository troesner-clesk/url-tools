/**
 * Resolves the closest URL-path parent of `childId` from the given set of
 * known node IDs. Walks up the path segments and tries with/without trailing
 * slash. Falls back to origin root if nothing closer matches. Returns `null`
 * when `childId` is already a root or no ancestor exists in the set.
 *
 * Known limitation: matching is exact-string. A URL like
 * `https://x.com/blog?page=2` will NOT find `https://x.com/blog/` as parent
 * because the query string is part of the candidate string. See
 * `graph-hierarchy.test.ts` for the documented behavior.
 */
export function resolveParentId(
  childId: string,
  allIds: Set<string>,
): string | null {
  let u: URL
  try {
    u = new URL(childId)
  } catch {
    return null
  }
  const origin = u.origin
  const path = u.pathname.replace(/\/+$/, '')
  if (!path) return null // already root

  const segments = path.split('/').filter(Boolean)
  for (let i = segments.length - 1; i > 0; i--) {
    const parentPath = `/${segments.slice(0, i).join('/')}`
    const candidates = [`${origin}${parentPath}/`, `${origin}${parentPath}`]
    for (const c of candidates) {
      if (c !== childId && allIds.has(c)) return c
    }
  }
  const root = `${origin}/`
  if (root !== childId && allIds.has(root)) return root
  return null
}

/**
 * Number of non-empty path segments in a URL. Trailing slashes are ignored.
 * Returns 0 for a URL whose pathname is "/" (or empty after stripping). Returns
 * 0 for any string that fails URL parsing.
 */
export function pathDepth(id: string): number {
  try {
    const u = new URL(id)
    const path = u.pathname.replace(/\/+$/, '')
    if (!path) return 0
    return path.split('/').filter(Boolean).length
  } catch {
    return 0
  }
}
