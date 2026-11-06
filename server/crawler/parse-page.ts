import * as cheerio from 'cheerio'
import { countWords, exactContentHash, simhash64 } from './content'
import { normalizeCrawlUrl } from './url-utils'

export interface ExtractedLink {
  url: string
  anchor: string
  rel: string
  nofollow: boolean
}

export interface HreflangEntry {
  lang: string
  url: string
}

export interface PageFacts {
  title: string | null
  titleCount: number
  metaDescription: string | null
  metaDescriptionCount: number
  h1: string | null
  h1Count: number
  h2Count: number
  metaRobots: string | null
  /** Absolute canonical URLs from `<link rel=canonical>` (document order). */
  canonicals: string[]
  canonicalIsRelative: boolean
  hreflang: HreflangEntry[]
  lang: string | null
  metaRefreshUrl: string | null
  links: ExtractedLink[]
  imagesTotal: number
  imagesMissingAlt: number
  insecureResources: number
  wordCount: number
  contentHash: string
  simhash: string
}

/** Minimal structural view of the domhandler nodes cheerio produces. */
interface DomNode {
  type: string
  name?: string
  data?: string
  children?: DomNode[]
}

/** Boilerplate containers left out of the "main text" used for duplicates. */
const SKIP_TEXT = new Set([
  'script',
  'style',
  'noscript',
  'template',
  'svg',
  'iframe',
  'nav',
  'header',
  'footer',
  'form',
])

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function relTokens(value: string | undefined): string[] {
  return (value ?? '').toLowerCase().split(/\s+/).filter(Boolean)
}

/** Joins text nodes with spaces so "<p>a</p><p>b</p>" counts as two words. */
function mainText(root: DomNode | undefined): string {
  const parts: string[] = []
  const walk = (node: DomNode) => {
    if (node.type === 'text') {
      if (node.data) parts.push(node.data)
      return
    }
    if (node.name && SKIP_TEXT.has(node.name)) return
    if (node.type === 'script' || node.type === 'style') return
    for (const child of node.children ?? []) walk(child)
  }
  if (root) walk(root)
  return collapse(parts.join(' '))
}

export function parseRobotsDirectives(value: string | null | undefined): {
  noindex: boolean
  nofollow: boolean
} {
  const tokens = (value ?? '')
    .toLowerCase()
    .split(',')
    .map((token) => token.trim())
  return {
    noindex: tokens.includes('noindex') || tokens.includes('none'),
    nofollow: tokens.includes('nofollow') || tokens.includes('none'),
  }
}

/**
 * Directives from `X-Robots-Tag` that apply to all crawlers or to Googlebot.
 * Values scoped to other bots ("bingbot: noindex") are ignored.
 */
export function xRobotsDirectives(
  header: string | string[] | undefined,
): string {
  const values = Array.isArray(header) ? header : header ? [header] : []
  const applicable: string[] = []
  for (const value of values) {
    const scoped = value.match(/^\s*([a-z][\w-]*)\s*:\s*(.*)$/i)
    const agent = scoped?.[1]?.toLowerCase()
    const isDirectiveWithValue =
      agent === 'unavailable_after' ||
      agent === 'max-snippet' ||
      agent === 'max-image-preview' ||
      agent === 'max-video-preview'
    if (scoped && !isDirectiveWithValue) {
      if (agent === 'googlebot') applicable.push(scoped[2] ?? '')
      continue
    }
    applicable.push(value)
  }
  return applicable.join(', ')
}

export interface LinkHeaderEntry {
  url: string
  rel: string[]
  hreflang?: string
}

/** Parses an RFC 8288 `Link` header (used for canonical/hreflang via HTTP). */
export function parseLinkHeader(
  header: string | string[] | undefined,
  base: string,
): LinkHeaderEntry[] {
  const raw = Array.isArray(header) ? header.join(',') : (header ?? '')
  const entries: LinkHeaderEntry[] = []
  const pattern = /<([^>]*)>((?:\s*;\s*[^;,]+(?:=(?:"[^"]*"|[^;,]*))?)*)/g
  for (const match of raw.matchAll(pattern)) {
    const url = normalizeCrawlUrl(match[1] ?? '', base)
    if (!url) continue
    const params = new Map<string, string>()
    for (const param of (match[2] ?? '').split(';')) {
      const [key, ...rest] = param.split('=')
      if (!key?.trim()) continue
      params.set(
        key.trim().toLowerCase(),
        rest.join('=').trim().replace(/^"|"$/g, ''),
      )
    }
    entries.push({
      url,
      rel: relTokens(params.get('rel')),
      hreflang: params.get('hreflang') || undefined,
    })
  }
  return entries
}

export function parsePage(html: string, pageUrl: string): PageFacts {
  const $ = cheerio.load(html)

  let baseUrl = pageUrl
  const baseHref = $('base[href]').first().attr('href')
  if (baseHref) {
    try {
      baseUrl = new URL(baseHref, pageUrl).href
    } catch {
      // keep page URL as base
    }
  }

  // <title> inside inline SVG icons is not the document title.
  const titles = $('title').filter((_, el) => $(el).closest('svg').length === 0)
  const title = titles.length
    ? collapse(titles.first().text()).slice(0, 1000)
    : null

  const descriptions = $('meta[name="description" i]')
  const metaDescription = descriptions.length
    ? collapse(descriptions.first().attr('content') ?? '').slice(0, 2000)
    : null

  const robotsValues = $('meta[name="robots" i], meta[name="googlebot" i]')
    .map((_, el) => $(el).attr('content') ?? '')
    .get()
    .filter(Boolean)

  const h1s = $('h1')

  const canonicalHrefs = $('link[rel][href]')
    .filter((_, el) => relTokens($(el).attr('rel')).includes('canonical'))
    .map((_, el) => ($(el).attr('href') ?? '').trim())
    .get()
  const canonicals = canonicalHrefs
    .map((href) => normalizeCrawlUrl(href, baseUrl))
    .filter((url): url is string => Boolean(url))

  const hreflang: HreflangEntry[] = []
  $('link[rel][hreflang][href]').each((_, el) => {
    if (!relTokens($(el).attr('rel')).includes('alternate')) return
    const url = normalizeCrawlUrl($(el).attr('href') ?? '', baseUrl)
    const lang = ($(el).attr('hreflang') ?? '').trim()
    if (url && lang) hreflang.push({ lang, url })
  })

  let metaRefreshUrl: string | null = null
  const refresh = $('meta[http-equiv="refresh" i]').first().attr('content')
  if (refresh) {
    const target = refresh.match(/url\s*=\s*['"]?([^'";]+)/i)?.[1]
    metaRefreshUrl = target
      ? (normalizeCrawlUrl(target, baseUrl) ?? target)
      : pageUrl
  }

  const links = new Map<string, ExtractedLink>()
  $('a[href], area[href]').each((_, el) => {
    const url = normalizeCrawlUrl($(el).attr('href') ?? '', baseUrl)
    if (!url) return
    const rel = ($(el).attr('rel') ?? '').trim()
    const nofollow = relTokens(rel).includes('nofollow')
    let anchor = collapse($(el).text()).slice(0, 200)
    if (!anchor) {
      const alt = $(el).find('img[alt]').first().attr('alt')
      if (alt) anchor = `[img] ${collapse(alt)}`.slice(0, 200)
    }
    const existing = links.get(url)
    if (!existing) {
      links.set(url, { url, anchor, rel, nofollow })
      return
    }
    // A target counts as followed when any link to it is followed.
    if (existing.nofollow && !nofollow) {
      existing.nofollow = false
      existing.rel = rel
    }
    if (!existing.anchor && anchor) existing.anchor = anchor
  })

  const images = $('img')
  let imagesMissingAlt = 0
  images.each((_, el) => {
    // alt="" is valid for decorative images; only a missing attribute counts.
    if ($(el).attr('alt') === undefined) imagesMissingAlt++
  })

  let insecureResources = 0
  if (pageUrl.startsWith('https:')) {
    const isHttp = (value: string | undefined) =>
      /^\s*http:\/\//i.test(value ?? '')
    $('img, script, iframe, audio, video, source, embed, track').each(
      (_, el) => {
        if (isHttp($(el).attr('src'))) insecureResources++
      },
    )
    $('link[rel][href]').each((_, el) => {
      const rel = relTokens($(el).attr('rel'))
      const isSubresource =
        rel.includes('stylesheet') ||
        rel.includes('icon') ||
        rel.includes('preload')
      if (isSubresource && isHttp($(el).attr('href'))) insecureResources++
    })
  }

  const body = $('body').get(0) ?? $.root().get(0)
  const text = mainText(body as unknown as DomNode)

  return {
    title: title || null,
    titleCount: titles.length,
    metaDescription: metaDescription || null,
    metaDescriptionCount: descriptions.length,
    h1: h1s.length ? collapse(h1s.first().text()).slice(0, 300) || null : null,
    h1Count: h1s.length,
    h2Count: $('h2').length,
    metaRobots: robotsValues.length ? robotsValues.join(', ') : null,
    canonicals,
    canonicalIsRelative: canonicalHrefs.some(
      (href) => href !== '' && !/^https?:\/\//i.test(href),
    ),
    hreflang,
    lang: ($('html').attr('lang') ?? '').trim() || null,
    metaRefreshUrl,
    links: [...links.values()],
    imagesTotal: images.length,
    imagesMissingAlt,
    insecureResources,
    wordCount: countWords(text),
    contentHash: exactContentHash(text),
    simhash: simhash64(text),
  }
}
