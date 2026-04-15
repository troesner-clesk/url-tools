# Inbound Link Analyzer (Silo)

Find which internal pages link **to** a given target URL — the inverse of the Link Analyzer. Useful for topical-silo analysis: "which pages form the cluster around `/kunststofffenster`?"

## Modes

### Target modes
- **Single**: one target URL; collect every internal page that links to it.
- **Multi**: list of target URLs; each target gets its own set of inbound links.
- **Matrix**: every internal page is treated as a potential target — produces a full internal-link matrix. Heavier; use the grouped view to rank pages by inbound count.

### Crawl scopes
- **Recursive**: start from one URL, BFS over internal links up to `maxDepth` / `maxUrls`.
- **Sitemap**: fetch `sitemap.xml` (sitemap indices supported) and only analyze the pages listed there.

## Views
- **Flat**: one row per source→target edge (Source | Target | Anchor | Rel | Status).
- **Grouped**: per target URL: inbound count, unique sources, anchor-text distribution bar chart, source table.
- **Graph**: Obsidian-style force-directed SVG graph (d3-force). Target nodes are highlighted; node radius scales with inbound count. Pan via drag, zoom via wheel.

## Output

Files are written to `OUTPUT_DIR/silo/`:

- `<timestamp>_inbound-links.json` — full `InboundLink[]`
- `<timestamp>_inbound-links.csv` — flat CSV (Papa.unparse)
- `<timestamp>_inbound-links.txt` — unique **source** URLs (the actionable list)

## API

`POST /api/analyze-inbound-links-stream` (SSE)

Request:
```ts
{
  startUrls: string[]
  crawlScope: 'recursive' | 'sitemap'
  targetMode: 'single' | 'multi' | 'matrix'
  targets?: string[]        // required for single/multi, max 500
  maxUrls?: number          // default 200, cap 10000
  maxDepth?: number         // default 3, cap 10
  rateLimit?: number        // req/s, default 2, min 0.1
  pathInclude?: string      // comma-separated
  pathExclude?: string
  settings?: RequestSettings
}
```

SSE events:
- `result` — one `InboundLink` `{ sourceUrl, targetUrl, anchorText, rel, sourceStatus, depth }`
- `progress` — `{ done, total, currentUrl }`
- `log` — `{ message, type }`
- `done` — `{ pagesProcessed, inboundFound, visited }`
- `error` — `{ message }`

## Guardrails

- Same-domain enforced (internal-only by definition).
- SSRF check on every fetched URL.
- 10 MB response cap, timeout/retry clamps.
- Max 500 targets to prevent DoS via massive matcher sets.
- Regex filter limited to 200 chars (ReDoS).
- No per-link HEAD redirect probe — kept fast by design.
