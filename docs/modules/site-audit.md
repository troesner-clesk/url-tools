# Module: Site Audit

## Purpose

Crawl a whole website the way a search engine does and find the technical SEO problems that cost rankings: broken links, redirect chains and loops, canonical and hreflang errors, indexability conflicts, sitemap problems, duplicate titles, descriptions and content. The crawl is stored once as an open SQLite file; the UI, the CSV exports and AI agents (via MCP, see [agent-interface.md](agent-interface.md)) all read the same data.

This module complements the per-page tools (SEO Audit, Link Checker, Silo). Those analyse a list of URLs; the Site Audit analyses the site as a graph, which is required for checks like orphan pages, redirect chains, canonical targets or hreflang return links.

## Features

- **Polite crawler:** robots.txt respected by default (RFC 9309, including `Crawl-delay`), global request rate, limited concurrency, own User-Agent (`URLTools/2.0`)
- **Breadth-first:** `depth` is the real click depth from the start URL
- **Every hop recorded:** redirects are not followed silently; each URL keeps its own status and the chain is resolved afterwards
- **Sitemaps:** discovered via robots.txt or `/sitemap.xml` (sitemap indexes followed); URLs only found in the sitemap are crawled after the link frontier (orphan candidates)
- **Canonical and hreflang targets** are crawled too, so their status is known
- **External links** are status-checked (HEAD, GET fallback, redirects followed), never crawled
- **Issue catalog:** 45 checks with stable ids, severity and explanations (what / why / how to fix)
- **Live progress** via SSE, crawls keep running when the tab is switched
- **Exports:** issues, URLs and links as CSV (UTF-8 with BOM for Excel)
- **One file per crawl:** `<OUTPUT_DIR>/crawls/<crawl-id>.sqlite`, queryable with any SQLite client
- **Safe by default:** every connection (including redirect hops) passes an SSRF guard that checks the resolved IP address

## Data Model

- **Endpoints:** `/api/site-audit/...`, see [data-model.md](../data-model.md#site-audit-api)
- **Crawl file schema:** see [data-model.md](../data-model.md#crawl-file-sqlite)
- **Code:** `server/crawler/` (engine, analysis, catalog, store, queries), `server/api/site-audit/`

## Data Flow

1. User (or an agent via MCP) starts a crawl with a start URL and options
2. `server/crawler/engine.ts` creates the crawl file and crawls breadth-first: robots.txt check, rate limiter, guarded HTTP request, parse, enqueue links/canonicals/hreflang targets
3. Sitemap URLs that were not reached via links are crawled afterwards (within the URL budget)
4. External link targets are status-checked in parallel
5. `server/crawler/analyze.ts` resolves redirect chains, link counts and indexability, then evaluates every check of the catalog into the `issues` table
6. UI, CSV export and MCP tools read the file through `server/crawler/queries.ts`

## Settings

| Setting | Default | Range | Description |
|---------|---------|-------|-------------|
| Max URLs | 500 | 1-10,000 | Internal URLs to fetch (MCP: max. 2,000) |
| Max depth | 10 | 0-50 | Maximum click depth from the start URL |
| Requests per second | 5 | 0.2-20 | Global rate; a robots.txt `Crawl-delay` (max. 10 s) slows it down further |
| Concurrency | 4 | 1-10 | Parallel requests |
| Respect robots.txt | on | | Blocked URLs are recorded, not fetched |
| Check external links | on | | Status check of up to 5,000 external URLs |
| Use sitemaps | on | | Needed for orphan and sitemap checks |
| Include subdomains | off | | Treat `*.example.com` as internal (www/non-www always is) |
| Include / exclude paths | | | Path prefixes like the Link Analyzer (`/de` matches `/de` and `/de/...`) |

At most 3 crawls run at the same time.

## Indexability

An internal HTML page that answered 2xx is **indexable** unless it is noindex (meta robots or `X-Robots-Tag`, all bots or Googlebot) or canonicalised to another URL. Redirects, 4xx/5xx, failed and robots-blocked URLs are non-indexable with a reason (`indexability_reason`). On-page checks (titles, descriptions, headings, content, images) only run on indexable pages, so noindex and canonicalised duplicates do not create noise.

## Issue Catalog

Ids are stable and shared by UI, CSV export, the crawl file (`issue_catalog` table) and MCP tools. Never rename an id; add a new one instead. Severity: **error** = broken or blocks indexing, **warning** = hurts SEO and should be fixed, **notice** = worth checking, often intentional.

| ID | Severity | Check | How to fix |
|----|----------|-------|------------|
| `response.client-error` | error | Internal URL returns 4xx | Restore the page, redirect it with a 301 to the best matching live URL, or remove the internal links pointing to it (see Inlinks). |
| `response.server-error` | error | Internal URL returns 5xx | Check the server logs for this URL, fix the application or capacity problem and crawl again. |
| `response.fetch-failed` | error | Internal URL could not be fetched | Open the URL in a browser and read the error detail. Typical causes are expired certificates, firewalls that block bots and very slow responses. |
| `response.slow` | notice | Slow response (over 1 second) | Check caching, database queries and hosting resources for these URLs and compare them with faster templates of the same site. |
| `links.broken-internal` | error | Page links to broken internal URLs | Update or remove the links. The detail lists the broken targets. |
| `links.broken-external` | warning | Broken external link target | Replace the link with a working source or remove it; Inlinks show where it is used. Verify 403/429 answers manually, some sites block automated requests. |
| `links.to-redirect` | notice | Page links to internal redirects | Point the links directly to the final destination URL. |
| `links.orphan` | warning | Orphan page (in sitemap, no internal links) | Link to the page from relevant pages or the navigation, or remove it from the sitemap if it is obsolete. |
| `links.dead-end` | notice | Page without internal outlinks | Add links to related content, categories or the navigation. |
| `links.deep` | notice | Deep page (5+ clicks from start) | Flatten the structure with category links, better pagination or links from strong pages. |
| `links.internal-nofollow` | notice | Internal links with nofollow | Remove nofollow from internal links. Pages that should stay out of search are better handled with noindex. |
| `redirect.chain` | warning | Redirect chain (2+ hops) | Redirect directly to the final URL and update internal links to point there. |
| `redirect.loop` | error | Redirect loop | Correct the redirect rules so the chain ends at a URL that returns 200. |
| `redirect.temporary` | notice | Temporary redirect (302/303/307) | Use 301 or 308 when the move is permanent. |
| `redirect.meta-refresh` | warning | Meta refresh redirect | Replace the meta refresh with a server-side 301 redirect. |
| `canonical.missing` | notice | No canonical | Add a self-referencing canonical to every indexable page. |
| `canonical.multiple` | warning | Multiple different canonicals | Keep exactly one canonical and check that templates, plugins or CDN headers do not add a second one. |
| `canonical.relative` | notice | Relative canonical URL | Use absolute URLs including protocol and host. |
| `canonical.non-indexable-target` | error | Canonical points to a non-indexable URL | Point the canonical to the final, indexable URL that returns 200. |
| `canonical.canonicalised` | notice | Canonicalised to another URL | Check that the canonical target is the preferred version. Pages that should rank need a self-referencing canonical. |
| `indexability.noindex` | notice | Noindex page | Check whether the page should be indexed and remove noindex if it should rank. |
| `indexability.blocked-by-robots` | notice | Blocked by robots.txt | Allow crawling if the content should be found. Otherwise remove the links or use noindex, which requires crawling. |
| `indexability.conflicting-signals` | warning | Noindex combined with canonical to another URL | Use one signal: a canonical for duplicates, noindex for pages that should not appear at all. |
| `sitemap.non-indexable` | warning | Non-indexable URL in sitemap | Remove the URL from the sitemap or replace it with its final canonical URL. |
| `sitemap.not-found` | notice | No XML sitemap found | Publish an XML sitemap with all indexable URLs and reference it in robots.txt. |
| `hreflang.missing-return` | warning | Hreflang without return link | Add reciprocal hreflang annotations on all language versions. |
| `hreflang.non-indexable-target` | warning | Hreflang points to a non-indexable URL | Reference the final, indexable URL of each language version. |
| `hreflang.missing-self` | notice | Hreflang without self-reference | Add an hreflang entry for the page's own language that points to its own URL. |
| `hreflang.invalid-code` | warning | Invalid hreflang code | Use codes like "de", "de-AT", "en-GB" or "x-default". |
| `title.missing` | error | Missing title | Add a unique, descriptive title of about 30 to 60 characters. |
| `title.duplicate` | warning | Duplicate title | Write a unique title per page. If the pages are duplicates, consolidate them. |
| `title.multiple` | warning | Multiple title elements | Keep exactly one title element in the <head>. |
| `title.too-long` | notice | Title over 60 characters | Put the most important words first and shorten the title to about 60 characters. |
| `title.too-short` | notice | Title under 30 characters | Make the title more descriptive. |
| `meta-description.missing` | warning | Missing meta description | Write a description of about 120 to 160 characters that summarises the page. |
| `meta-description.duplicate` | warning | Duplicate meta description | Write a unique description for each page. |
| `meta-description.too-long` | notice | Meta description over 160 characters | Shorten the description and put the key message first. |
| `h1.missing` | warning | Missing H1 | Add one clear H1 that matches the topic of the page. |
| `h1.multiple` | notice | Multiple H1 headings | Keep one H1 for the main topic and use H2 to H6 for sections. |
| `content.exact-duplicate` | warning | Exact duplicate content | Redirect or canonicalise the duplicates to one preferred URL, or make the content distinct. |
| `content.near-duplicate` | notice | Near-duplicate content | Merge the pages, canonicalise one to the other or make the content clearly different. |
| `content.thin` | notice | Low word count (under 200 words) | Expand the content, merge it with a related page or set it to noindex if it has no search value. |
| `images.missing-alt` | notice | Images without alt attribute | Add a descriptive alt text, or alt="" for purely decorative images. |
| `security.http-page` | warning | Page served over HTTP | Serve the site over HTTPS and redirect all HTTP URLs with a 301. |
| `security.mixed-content` | warning | Mixed content | Load all resources over HTTPS. |
Thresholds: titles 30-60 characters, descriptions up to 160 characters, slow response over 1,000 ms, thin content under 200 words of main text (navigation, header, footer, forms excluded), deep pages from 5 clicks, near-duplicates at a SimHash distance of 3 bits or less (64-bit, pages with at least 50 words).

## Tests

`server/crawler/__tests__/crawl-golden.test.ts` crawls a local fixture site (`__tests__/fixtures/site.ts`) in which every page triggers specific checks and compares all findings with an expected issue → URL list. A new or changed check has to update that list deliberately.

## Known Limitations

- No JavaScript rendering (pages are analysed as delivered by the server)
- gzip-compressed sitemap files (`.xml.gz`) are skipped
- Title length is measured in characters, not pixels
- Crawls are not resumable after a server restart (the file is kept with status `interrupted`)
