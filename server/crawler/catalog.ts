/**
 * Issue catalog for the Site Audit. Every check has a stable id that the UI,
 * exports, the crawl file (`issue_catalog` table) and the MCP tools share.
 * Never rename an id; add a new one and retire the old one instead.
 * Documented in docs/modules/site-audit.md.
 */

export type Severity = 'error' | 'warning' | 'notice'

export interface IssueDefinition {
  id: string
  category: string
  severity: Severity
  title: string
  /** What does it mean? */
  description: string
  /** Why does it matter? */
  why: string
  /** How to fix it. */
  fix: string
}

export const SEVERITY_ORDER: Record<Severity, number> = {
  error: 0,
  warning: 1,
  notice: 2,
}

export const ISSUE_CATALOG: readonly IssueDefinition[] = [
  // Response codes
  {
    id: 'response.client-error',
    category: 'response',
    severity: 'error',
    title: 'Internal URL returns 4xx',
    description:
      'An internal URL answers with a client error, usually 404 Not Found or 410 Gone.',
    why: 'Visitors and search engines run into a dead end, and every link pointing here is wasted.',
    fix: 'Restore the page, redirect it with a 301 to the best matching live URL, or remove the internal links pointing to it (see Inlinks).',
  },
  {
    id: 'response.server-error',
    category: 'response',
    severity: 'error',
    title: 'Internal URL returns 5xx',
    description: 'An internal URL answers with a server error.',
    why: 'Search engines slow down crawling and eventually drop URLs that keep failing. Visitors see an error page.',
    fix: 'Check the server logs for this URL, fix the application or capacity problem and crawl again.',
  },
  {
    id: 'response.fetch-failed',
    category: 'response',
    severity: 'error',
    title: 'Internal URL could not be fetched',
    description:
      'The request failed without an HTTP response: timeout, DNS error, refused connection or TLS problem.',
    why: 'If the crawler cannot load the URL, search engines most likely cannot either.',
    fix: 'Open the URL in a browser and read the error detail. Typical causes are expired certificates, firewalls that block bots and very slow responses.',
  },
  {
    id: 'response.slow',
    category: 'performance',
    severity: 'notice',
    title: 'Slow response (over 1 second)',
    description:
      'Downloading the HTML of the page took longer than one second.',
    why: 'Slow responses hurt user experience and Core Web Vitals and limit how many pages search engines crawl.',
    fix: 'Check caching, database queries and hosting resources for these URLs and compare them with faster templates of the same site.',
  },
  // Links
  {
    id: 'links.broken-internal',
    category: 'links',
    severity: 'error',
    title: 'Page links to broken internal URLs',
    description:
      'The page contains links to internal URLs that return 4xx/5xx or cannot be fetched.',
    why: 'Broken links frustrate visitors and send link equity into dead ends.',
    fix: 'Update or remove the links. The detail lists the broken targets.',
  },
  {
    id: 'links.broken-external',
    category: 'links',
    severity: 'warning',
    title: 'Broken external link target',
    description:
      'An external URL linked from the site returns an error or cannot be reached.',
    why: 'Links to dead external pages look neglected and give visitors a bad experience.',
    fix: 'Replace the link with a working source or remove it; Inlinks show where it is used. Verify 403/429 answers manually, some sites block automated requests.',
  },
  {
    id: 'links.to-redirect',
    category: 'links',
    severity: 'notice',
    title: 'Page links to internal redirects',
    description: 'The page links to internal URLs that redirect.',
    why: 'Every redirect costs an extra request for visitors and crawlers.',
    fix: 'Point the links directly to the final destination URL.',
  },
  {
    id: 'links.orphan',
    category: 'links',
    severity: 'warning',
    title: 'Orphan page (in sitemap, no internal links)',
    description:
      'The URL is listed in the XML sitemap and works, but no crawled page links to it.',
    why: 'Without internal links search engines consider the page unimportant and visitors cannot find it.',
    fix: 'Link to the page from relevant pages or the navigation, or remove it from the sitemap if it is obsolete.',
  },
  {
    id: 'links.dead-end',
    category: 'links',
    severity: 'notice',
    title: 'Page without internal outlinks',
    description: 'The indexable page has no links to other internal pages.',
    why: 'Dead ends stop visitors and crawlers, and link equity does not flow any further.',
    fix: 'Add links to related content, categories or the navigation.',
  },
  {
    id: 'links.deep',
    category: 'links',
    severity: 'notice',
    title: 'Deep page (5+ clicks from start)',
    description: 'The page is five or more clicks away from the start URL.',
    why: 'Deep pages are crawled less often and are treated as less important.',
    fix: 'Flatten the structure with category links, better pagination or links from strong pages.',
  },
  {
    id: 'links.internal-nofollow',
    category: 'links',
    severity: 'notice',
    title: 'Internal links with nofollow',
    description: 'The page links to internal URLs with rel="nofollow".',
    why: 'Nofollow on internal links withholds signals from your own pages and is rarely intended.',
    fix: 'Remove nofollow from internal links. Pages that should stay out of search are better handled with noindex.',
  },
  // Redirects
  {
    id: 'redirect.chain',
    category: 'redirects',
    severity: 'warning',
    title: 'Redirect chain (2+ hops)',
    description:
      'The URL redirects more than once before it reaches its final destination.',
    why: 'Each hop adds latency, and search engines may stop following long chains.',
    fix: 'Redirect directly to the final URL and update internal links to point there.',
  },
  {
    id: 'redirect.loop',
    category: 'redirects',
    severity: 'error',
    title: 'Redirect loop',
    description:
      'The redirects of this URL lead back to a URL that is already part of the chain.',
    why: 'The page can never be loaded, neither by visitors nor by search engines.',
    fix: 'Correct the redirect rules so the chain ends at a URL that returns 200.',
  },
  {
    id: 'redirect.temporary',
    category: 'redirects',
    severity: 'notice',
    title: 'Temporary redirect (302/303/307)',
    description: 'The URL redirects with a temporary status code.',
    why: 'Temporary redirects ask search engines to keep the old URL indexed, which is the wrong signal for permanent moves.',
    fix: 'Use 301 or 308 when the move is permanent.',
  },
  {
    id: 'redirect.meta-refresh',
    category: 'redirects',
    severity: 'warning',
    title: 'Meta refresh redirect',
    description:
      'The page forwards or reloads itself with <meta http-equiv="refresh">.',
    why: 'Meta refreshes are slower than server redirects, confuse users and are not reliably treated as redirects.',
    fix: 'Replace the meta refresh with a server-side 301 redirect.',
  },
  // Canonicals
  {
    id: 'canonical.missing',
    category: 'canonicals',
    severity: 'notice',
    title: 'No canonical',
    description:
      'The page has neither a canonical link element nor a canonical Link header.',
    why: 'Without a canonical, search engines choose the preferred version of duplicate and parameter URLs on their own.',
    fix: 'Add a self-referencing canonical to every indexable page.',
  },
  {
    id: 'canonical.multiple',
    category: 'canonicals',
    severity: 'warning',
    title: 'Multiple different canonicals',
    description:
      'The page declares more than one different canonical URL (HTML and/or HTTP header).',
    why: 'Conflicting canonicals are usually ignored, so the page loses its canonical signal.',
    fix: 'Keep exactly one canonical and check that templates, plugins or CDN headers do not add a second one.',
  },
  {
    id: 'canonical.relative',
    category: 'canonicals',
    severity: 'notice',
    title: 'Relative canonical URL',
    description:
      'The canonical href is a relative path instead of an absolute URL.',
    why: 'Relative canonicals break easily, for example on staging hosts or with a wrong base URL.',
    fix: 'Use absolute URLs including protocol and host.',
  },
  {
    id: 'canonical.non-indexable-target',
    category: 'canonicals',
    severity: 'error',
    title: 'Canonical points to a non-indexable URL',
    description:
      'The canonical target redirects, returns an error, is blocked by robots.txt or is set to noindex.',
    why: 'Search engines ignore such canonicals or drop the page from the index.',
    fix: 'Point the canonical to the final, indexable URL that returns 200.',
  },
  {
    id: 'canonical.canonicalised',
    category: 'canonicals',
    severity: 'notice',
    title: 'Canonicalised to another URL',
    description: 'The page names a different URL as its canonical version.',
    why: 'The page itself will usually not be indexed. That is right for duplicates and a mistake for unique pages.',
    fix: 'Check that the canonical target is the preferred version. Pages that should rank need a self-referencing canonical.',
  },
  // Indexability
  {
    id: 'indexability.noindex',
    category: 'indexability',
    severity: 'notice',
    title: 'Noindex page',
    description:
      'The page carries noindex in the meta robots tag or in the X-Robots-Tag header.',
    why: 'The page is removed from search results. Unintended noindex tags are a common cause of traffic loss.',
    fix: 'Check whether the page should be indexed and remove noindex if it should rank.',
  },
  {
    id: 'indexability.blocked-by-robots',
    category: 'indexability',
    severity: 'notice',
    title: 'Blocked by robots.txt',
    description:
      'The internal URL is linked but disallowed by robots.txt, so it was not crawled.',
    why: 'Search engines cannot read blocked pages, yet linked URLs can still be indexed without content.',
    fix: 'Allow crawling if the content should be found. Otherwise remove the links or use noindex, which requires crawling.',
  },
  {
    id: 'indexability.conflicting-signals',
    category: 'indexability',
    severity: 'warning',
    title: 'Noindex combined with canonical to another URL',
    description:
      'The page is noindex and canonicalises to a different URL at the same time.',
    why: 'The signals contradict each other and can lead search engines to treat the canonical target as noindex as well.',
    fix: 'Use one signal: a canonical for duplicates, noindex for pages that should not appear at all.',
  },
  // Sitemaps
  {
    id: 'sitemap.non-indexable',
    category: 'sitemaps',
    severity: 'warning',
    title: 'Non-indexable URL in sitemap',
    description:
      'The XML sitemap lists a URL that redirects, fails, is noindex, is blocked or is canonicalised to another URL.',
    why: 'Sitemaps should only contain canonical, indexable URLs. Wrong entries waste crawl budget and make the sitemap less trustworthy.',
    fix: 'Remove the URL from the sitemap or replace it with its final canonical URL.',
  },
  {
    id: 'sitemap.not-found',
    category: 'sitemaps',
    severity: 'notice',
    title: 'No XML sitemap found',
    description:
      'Neither robots.txt nor /sitemap.xml pointed to a usable XML sitemap.',
    why: 'Sitemaps help search engines discover new and deep pages faster.',
    fix: 'Publish an XML sitemap with all indexable URLs and reference it in robots.txt.',
  },
  // Hreflang
  {
    id: 'hreflang.missing-return',
    category: 'hreflang',
    severity: 'warning',
    title: 'Hreflang without return link',
    description:
      'The page references an alternate language version that does not reference this page back.',
    why: 'Search engines ignore hreflang pairs that are not confirmed from both sides.',
    fix: 'Add reciprocal hreflang annotations on all language versions.',
  },
  {
    id: 'hreflang.non-indexable-target',
    category: 'hreflang',
    severity: 'warning',
    title: 'Hreflang points to a non-indexable URL',
    description:
      'An hreflang target redirects, fails, is noindex or is canonicalised to another URL.',
    why: 'Annotations pointing to non-canonical or broken URLs are ignored.',
    fix: 'Reference the final, indexable URL of each language version.',
  },
  {
    id: 'hreflang.missing-self',
    category: 'hreflang',
    severity: 'notice',
    title: 'Hreflang without self-reference',
    description:
      'The page has hreflang annotations, but none of them points to the page itself.',
    why: 'Each language version should list itself as well, otherwise the set can be incomplete.',
    fix: "Add an hreflang entry for the page's own language that points to its own URL.",
  },
  {
    id: 'hreflang.invalid-code',
    category: 'hreflang',
    severity: 'warning',
    title: 'Invalid hreflang code',
    description:
      'An hreflang value is not a valid language code (ISO 639-1, optionally with ISO 3166-1 region) or x-default.',
    why: 'Invalid codes such as "en-UK" are ignored by search engines.',
    fix: 'Use codes like "de", "de-AT", "en-GB" or "x-default".',
  },
  // Titles
  {
    id: 'title.missing',
    category: 'titles',
    severity: 'error',
    title: 'Missing title',
    description: 'The indexable page has no title or an empty one.',
    why: 'The title is a primary relevance signal and the headline of the search snippet.',
    fix: 'Add a unique, descriptive title of about 30 to 60 characters.',
  },
  {
    id: 'title.duplicate',
    category: 'titles',
    severity: 'warning',
    title: 'Duplicate title',
    description: 'Several indexable pages share the same title.',
    why: 'Search engines struggle to tell the pages apart and may show the wrong one.',
    fix: 'Write a unique title per page. If the pages are duplicates, consolidate them.',
  },
  {
    id: 'title.multiple',
    category: 'titles',
    severity: 'warning',
    title: 'Multiple title elements',
    description: 'The page contains more than one <title> element.',
    why: 'Search engines may use any of them, often not the intended one.',
    fix: 'Keep exactly one title element in the <head>.',
  },
  {
    id: 'title.too-long',
    category: 'titles',
    severity: 'notice',
    title: 'Title over 60 characters',
    description: 'The title is longer than 60 characters.',
    why: 'Long titles are usually truncated in search results.',
    fix: 'Put the most important words first and shorten the title to about 60 characters.',
  },
  {
    id: 'title.too-short',
    category: 'titles',
    severity: 'notice',
    title: 'Title under 30 characters',
    description: 'The title has fewer than 30 characters.',
    why: 'Short titles waste space in the snippet and often lack descriptive terms.',
    fix: 'Make the title more descriptive.',
  },
  // Meta descriptions
  {
    id: 'meta-description.missing',
    category: 'descriptions',
    severity: 'warning',
    title: 'Missing meta description',
    description: 'The indexable page has no meta description or an empty one.',
    why: 'Search engines then build the snippet from page text, which is often less convincing.',
    fix: 'Write a description of about 120 to 160 characters that summarises the page.',
  },
  {
    id: 'meta-description.duplicate',
    category: 'descriptions',
    severity: 'warning',
    title: 'Duplicate meta description',
    description: 'Several indexable pages share the same meta description.',
    why: 'Identical snippets make results look interchangeable and reduce clicks.',
    fix: 'Write a unique description for each page.',
  },
  {
    id: 'meta-description.too-long',
    category: 'descriptions',
    severity: 'notice',
    title: 'Meta description over 160 characters',
    description: 'The meta description is longer than 160 characters.',
    why: 'Long descriptions are cut off in search results.',
    fix: 'Shorten the description and put the key message first.',
  },
  // Headings
  {
    id: 'h1.missing',
    category: 'headings',
    severity: 'warning',
    title: 'Missing H1',
    description: 'The indexable page has no (or only an empty) <h1> heading.',
    why: 'The H1 tells visitors and search engines what the page is about.',
    fix: 'Add one clear H1 that matches the topic of the page.',
  },
  {
    id: 'h1.multiple',
    category: 'headings',
    severity: 'notice',
    title: 'Multiple H1 headings',
    description: 'The page has more than one <h1>.',
    why: 'Several H1 headings blur the main topic and usually point to a template problem.',
    fix: 'Keep one H1 for the main topic and use H2 to H6 for sections.',
  },
  // Content
  {
    id: 'content.exact-duplicate',
    category: 'content',
    severity: 'warning',
    title: 'Exact duplicate content',
    description:
      'The main text of the page is identical to that of another indexable page.',
    why: 'Search engines index only one version, signals are split and the wrong URL may rank.',
    fix: 'Redirect or canonicalise the duplicates to one preferred URL, or make the content distinct.',
  },
  {
    id: 'content.near-duplicate',
    category: 'content',
    severity: 'notice',
    title: 'Near-duplicate content',
    description:
      'The main text is almost identical to another indexable page (SimHash distance of 3 bits or less).',
    why: 'Very similar pages compete with each other and may be treated as duplicates.',
    fix: 'Merge the pages, canonicalise one to the other or make the content clearly different.',
  },
  {
    id: 'content.thin',
    category: 'content',
    severity: 'notice',
    title: 'Low word count (under 200 words)',
    description:
      'The main text of the indexable page has fewer than 200 words (navigation, header and footer excluded).',
    why: 'Pages with little content rarely answer a search query well.',
    fix: 'Expand the content, merge it with a related page or set it to noindex if it has no search value.',
  },
  // Images
  {
    id: 'images.missing-alt',
    category: 'images',
    severity: 'notice',
    title: 'Images without alt attribute',
    description: 'The page contains <img> elements without an alt attribute.',
    why: 'Alt text makes images accessible for screen readers and understandable for image search.',
    fix: 'Add a descriptive alt text, or alt="" for purely decorative images.',
  },
  // Security
  {
    id: 'security.http-page',
    category: 'security',
    severity: 'warning',
    title: 'Page served over HTTP',
    description: 'The internal HTML page is delivered over unencrypted HTTP.',
    why: 'Browsers mark HTTP pages as not secure, and search engines prefer HTTPS.',
    fix: 'Serve the site over HTTPS and redirect all HTTP URLs with a 301.',
  },
  {
    id: 'security.mixed-content',
    category: 'security',
    severity: 'warning',
    title: 'Mixed content',
    description:
      'The HTTPS page loads images, scripts, styles or frames over HTTP.',
    why: 'Browsers block or flag insecure resources, which breaks layouts and shows security warnings.',
    fix: 'Load all resources over HTTPS.',
  },
]

export const ISSUE_BY_ID: ReadonlyMap<string, IssueDefinition> = new Map(
  ISSUE_CATALOG.map((issue) => [issue.id, issue]),
)
