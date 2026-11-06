import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

/**
 * Golden test site: every page deliberately triggers specific issues of the
 * catalog (see EXPECTED_ISSUES in crawl-golden.test.ts). Served on 127.0.0.1
 * (internal host); a second server on "localhost" plays the external site.
 */

const VOCABULARY =
  'river stone garden window market silver morning planet coffee bridge yellow forest letter engine orange rocket mirror basket candle valley shadow winter summer castle meadow pepper copper anchor ladder island harbor violet thunder blanket compass lantern feather marble saddle tunnel orchard falcon glacier harvest jungle kettle lemon magnet needle oyster parrot quartz ribbon saffron timber umbrella velvet walnut zephyr acorn breeze cobalt dolphin ember fossil granite hollow ivory jasmine kayak lagoon mosaic nectar olive pebble quiver raven sparrow tulip urchin vortex willow yarrow amber beacon canyon dune estuary fjord grove heron inlet juniper kelp lichen mango nutmeg opal prairie quill reef sage thistle tundra verbena wren yucca alder birch cedar dahlia elm fern gorse hazel iris laurel maple nettle oak poppy rowan sorrel teasel vetch'.split(
    ' ',
  )

/** Deterministic pseudo-random prose so pages are clearly distinct. */
export function prose(seed: number, count: number): string {
  let state = seed * 7919 + 13
  const words: string[] = []
  for (let i = 0; i < count; i++) {
    state = (state * 1103515245 + 12345) % 2147483648
    words.push(VOCABULARY[state % VOCABULARY.length] as string)
  }
  return words.join(' ')
}

/** Base URL of the running fixture site (absolute canonicals need it). */
let BASE = ''

interface PageOptions {
  title?: string | null
  titles?: string[]
  description?: string | null
  h1?: string | null
  extraH1?: boolean
  canonical?: string | null
  hreflang?: Array<[string, string]>
  head?: string
  body?: string
  words?: number
  seed?: number
  links?: string[]
  homeLink?: boolean
  lang?: string
}

function page(name: string, options: PageOptions = {}): string {
  const titleTags = options.titles
    ? options.titles.map((t) => `<title>${t}</title>`).join('')
    : options.title === null
      ? ''
      : `<title>${options.title ?? `Fixture page ${name} for crawler tests`}</title>`
  const description =
    options.description === null
      ? ''
      : `<meta name="description" content="${
          options.description ??
          `This is the description of the ${name} page. It exists to test the url-tools site crawler and has a length that fits snippets.`
        }">`
  const canonical =
    options.canonical === null
      ? ''
      : `<link rel="canonical" href="${options.canonical ?? `${BASE}/${name}`}">`
  const hreflang = (options.hreflang ?? [])
    .map(
      ([lang, href]) =>
        `<link rel="alternate" hreflang="${lang}" href="${href}">`,
    )
    .join('')
  const h1 =
    options.h1 === null ? '' : `<h1>${options.h1 ?? `Heading of ${name}`}</h1>`
  const links = (options.links ?? [])
    .map((href) => `<a href="${href}">Link to ${href}</a>`)
    .join(' ')
  const nav =
    options.homeLink === false ? '' : '<nav><a href="/">Home</a></nav>'
  const text = prose(
    options.seed ?? name.length * 31 + name.charCodeAt(0),
    options.words ?? 250,
  )
  return `<!doctype html><html lang="${options.lang ?? 'en'}"><head><meta charset="utf-8">${titleTags}${description}${canonical}${hreflang}${options.head ?? ''}</head><body>${nav}<main>${h1}${options.extraH1 ? '<h1>Second heading</h1>' : ''}<p>${text}</p>${options.body ?? ''}<p>${links}</p></main></body></html>`
}

export interface FixtureSite {
  base: string
  externalBase: string
  close: () => Promise<void>
  requests: string[]
}

export async function startFixtureSite(): Promise<FixtureSite> {
  const requests: string[] = []
  let base = ''
  let externalBase = ''

  const external = createServer((req, res) => {
    if (req.url === '/ext-ok') {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end('<html><body>ok</body></html>')
      return
    }
    res.writeHead(404, { 'content-type': 'text/html' })
    res.end('<html><body>missing</body></html>')
  })

  const pages: Record<
    string,
    () => {
      status?: number
      headers?: Record<string, string>
      body?: string
      delay?: number
    }
  > = {
    '/robots.txt': () => ({
      headers: { 'content-type': 'text/plain' },
      body: `User-agent: *\nDisallow: /private/\nSitemap: ${base}/sitemap.xml\n`,
    }),
    '/sitemap.xml': () => ({
      headers: { 'content-type': 'application/xml' },
      body: `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${[
        '/',
        '/about',
        '/noindex',
        '/orphan',
        '/redirect-1',
        '/de/',
      ]
        .map((p) => `<url><loc>${base}${p}</loc></url>`)
        .join('')}</urlset>`,
    }),
    '/': () => ({
      body: page('', {
        title: 'Home of the fixture site for url-tools tests',
        canonical: `${base}/`,
        seed: 1,
        homeLink: false,
        links: [
          '/about',
          '/redirect-1',
          '/temp',
          '/loop-1',
          '/broken',
          '/error',
          '/noindex',
          '/dup-1',
          '/dup-2',
          '/canon-to-404',
          '/de/',
          '/no-title',
          '/thin',
          '/private/secret',
          '/meta-refresh',
          '/image-page',
          '/deep-1',
          '/dead-end',
          '/long-title',
          '/short-title',
          '/multi',
          '/relative-canonical',
          '/no-canonical',
          '/slow',
          '/x-noindex-conflict',
          '/near-1',
          '/near-2',
          '/formula',
          `${externalBase}/ext-404`,
          `${externalBase}/ext-ok`,
          'mailto:hello@example.com',
          '#top',
        ],
        body: '<a href="/nofollow-target" rel="nofollow">Hidden</a>',
      }),
    }),
    '/about': () => ({ body: page('about', { seed: 2 }) }),
    '/redirect-1': () => ({
      status: 301,
      headers: { location: '/redirect-2' },
    }),
    '/redirect-2': () => ({ status: 301, headers: { location: '/about' } }),
    '/temp': () => ({ status: 302, headers: { location: '/about' } }),
    '/loop-1': () => ({ status: 301, headers: { location: '/loop-2' } }),
    '/loop-2': () => ({ status: 301, headers: { location: '/loop-1' } }),
    '/broken': () => ({ status: 404, body: 'Not found' }),
    '/gone': () => ({ status: 404, body: 'Not found' }),
    '/error': () => ({ status: 500, body: 'Server error' }),
    '/noindex': () => ({
      body: page('noindex', {
        canonical: null,
        head: '<meta name="robots" content="noindex, follow">',
        seed: 3,
      }),
    }),
    '/dup-1': () => ({
      body: page('dup', {
        title: 'Duplicate page title for the tests',
        description:
          'Same description on two pages so that the duplicate description check fires for both of them.',
        canonical: `${base}/dup-1`,
        seed: 4,
      }),
    }),
    '/dup-2': () => ({
      body: page('dup', {
        title: 'Duplicate page title for the tests',
        description:
          'Same description on two pages so that the duplicate description check fires for both of them.',
        canonical: `${base}/dup-2`,
        seed: 4,
      }),
    }),
    '/canon-to-404': () => ({
      body: page('canon-to-404', { canonical: `${base}/gone`, seed: 5 }),
    }),
    '/de/': () => ({
      body: page('de/', {
        lang: 'de',
        seed: 6,
        hreflang: [
          ['de', '/de/'],
          ['en', '/en/'],
          ['en-UK', '/en/'],
          ['fr', '/fr/'],
        ],
      }),
    }),
    '/en/': () => ({
      body: page('en/', { seed: 7, hreflang: [['en', '/en/']] }),
    }),
    '/fr/': () => ({ status: 301, headers: { location: '/en/' } }),
    '/no-title': () => ({
      body: page('no-title', {
        title: null,
        description: null,
        h1: null,
        seed: 8,
      }),
    }),
    '/thin': () => ({ body: page('thin', { words: 20, seed: 9 }) }),
    '/private/secret': () => ({ body: page('private/secret', { seed: 10 }) }),
    '/meta-refresh': () => ({
      body: page('meta-refresh', {
        head: '<meta http-equiv="refresh" content="0; url=/about">',
        seed: 11,
      }),
    }),
    '/orphan': () => ({ body: page('orphan', { seed: 12 }) }),
    '/nofollow-target': () => ({ body: page('nofollow-target', { seed: 13 }) }),
    '/image-page': () => ({
      body: page('image-page', {
        seed: 14,
        body: '<img src="/a.png" alt="A"><img src="/b.png" alt=""><img src="/c.png"><img src="/d.png">',
      }),
    }),
    '/deep-1': () => ({
      body: page('deep-1', { seed: 15, links: ['/deep-2'] }),
    }),
    '/deep-2': () => ({
      body: page('deep-2', { seed: 16, links: ['/deep-3'] }),
    }),
    '/deep-3': () => ({
      body: page('deep-3', { seed: 17, links: ['/deep-4'] }),
    }),
    '/deep-4': () => ({
      body: page('deep-4', { seed: 18, links: ['/deep-5'] }),
    }),
    '/deep-5': () => ({ body: page('deep-5', { seed: 19 }) }),
    '/dead-end': () => ({
      body: page('dead-end', { seed: 20, homeLink: false }),
    }),
    '/long-title': () => ({
      body: page('long-title', {
        seed: 21,
        title:
          'This title is far too long for a search result snippet and gets cut',
        description:
          'This meta description is deliberately written to be much longer than one hundred and sixty characters so that the length check for descriptions reports it as too long.',
      }),
    }),
    '/short-title': () => ({
      body: page('short-title', { seed: 22, title: 'Short' }),
    }),
    '/multi': () => ({
      headers: { link: `<${base}/about>; rel="canonical"` },
      body: page('multi', {
        seed: 23,
        titles: [
          'First title element of the multi page',
          'Second title element of the multi page',
        ],
        extraH1: true,
      }),
    }),
    '/relative-canonical': () => ({
      body: page('relative-canonical', {
        seed: 24,
        canonical: 'relative-canonical',
      }),
    }),
    '/no-canonical': () => ({
      body: page('no-canonical', { seed: 25, canonical: null }),
    }),
    '/slow': () => ({ body: page('slow', { seed: 26 }), delay: 1100 }),
    '/x-noindex-conflict': () => ({
      headers: { 'x-robots-tag': 'noindex' },
      body: page('x-noindex-conflict', {
        seed: 27,
        canonical: `${base}/about`,
      }),
    }),
    '/formula': () => ({
      body: page('formula', {
        seed: 29,
        title: '=HYPERLINK("https://example.com/x","Click me")',
      }),
    }),
    '/near-1': () => ({
      body: page('near-1', {
        seed: 28,
        title: 'Near duplicate page number one',
        body: `<p>${prose(99, 300)} alpha</p>`,
        words: 1,
      }),
    }),
    '/near-2': () => ({
      body: page('near-2', {
        seed: 28,
        title: 'Near duplicate page number two',
        body: `<p>${prose(99, 300)} omega</p>`,
        words: 1,
      }),
    }),
  }

  const site = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0] as string
    requests.push(path)
    const handler = pages[path]
    if (!handler) {
      res.writeHead(404, { 'content-type': 'text/plain' })
      res.end('Not found')
      return
    }
    const result = handler()
    const send = () => {
      res.writeHead(result.status ?? 200, {
        'content-type': 'text/html; charset=utf-8',
        ...result.headers,
      })
      res.end(result.body ?? '')
    }
    if (result.delay) setTimeout(send, result.delay)
    else send()
  })

  await new Promise<void>((resolve) => site.listen(0, '127.0.0.1', resolve))
  await new Promise<void>((resolve) => external.listen(0, 'localhost', resolve))
  base = `http://127.0.0.1:${(site.address() as AddressInfo).port}`
  BASE = base
  externalBase = `http://localhost:${(external.address() as AddressInfo).port}`

  return {
    base,
    externalBase,
    requests,
    close: async () => {
      site.closeAllConnections()
      external.closeAllConnections()
      await Promise.all([
        new Promise((resolve) => site.close(resolve)),
        new Promise((resolve) => external.close(resolve)),
      ])
    },
  }
}
