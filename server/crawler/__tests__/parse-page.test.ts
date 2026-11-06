import { describe, expect, it } from 'vitest'
import {
  parseLinkHeader,
  parsePage,
  parseRobotsDirectives,
  xRobotsDirectives,
} from '../parse-page'

const URL = 'https://example.com/de/page'

describe('parsePage', () => {
  it('extracts head signals', () => {
    const facts = parsePage(
      `<html lang="de"><head>
        <title> Seite  über Fenster </title>
        <meta name="Description" content="Beschreibung">
        <meta name="robots" content="noindex, follow">
        <link rel="canonical" href="/de/page">
        <link rel="alternate" hreflang="en" href="https://example.com/en/page">
        <meta http-equiv="refresh" content="5; url=/neu">
      </head><body><svg><title>icon</title></svg><h1>Fenster</h1><h1>Zwei</h1><h2>a</h2></body></html>`,
      URL,
    )
    expect(facts).toMatchObject({
      title: 'Seite über Fenster',
      titleCount: 1,
      metaDescription: 'Beschreibung',
      metaRobots: 'noindex, follow',
      canonicals: ['https://example.com/de/page'],
      canonicalIsRelative: true,
      hreflang: [{ lang: 'en', url: 'https://example.com/en/page' }],
      lang: 'de',
      metaRefreshUrl: 'https://example.com/neu',
      h1: 'Fenster',
      h1Count: 2,
      h2Count: 1,
    })
  })

  it('extracts links, keeps trailing slashes and merges duplicates', () => {
    const facts = parsePage(
      `<body><base href="https://example.com/base/">
        <a href="sub/">Sub</a>
        <a href="https://example.com/x" rel="nofollow">X1</a>
        <a href="https://example.com/x#frag">X2</a>
        <a href="mailto:a@b.c">Mail</a><a href="#top">Top</a><a href="javascript:void(0)">JS</a>
        <a href="/img"><img src="a.png" alt="Logo"></a>
      </body>`,
      URL,
    )
    expect(facts.links).toEqual([
      {
        url: 'https://example.com/base/sub/',
        anchor: 'Sub',
        rel: '',
        nofollow: false,
      },
      { url: 'https://example.com/x', anchor: 'X1', rel: '', nofollow: false },
      {
        url: 'https://example.com/img',
        anchor: '[img] Logo',
        rel: '',
        nofollow: false,
      },
    ])
  })

  it('counts words of the main content only, Unicode-aware', () => {
    const facts = parsePage(
      '<body><nav>Menü Start Kontakt</nav><main><p>Größe</p><p>Maße und Gewicht</p></main><footer>Impressum</footer><script>var a = 1</script></body>',
      URL,
    )
    expect(facts.wordCount).toBe(4)
    expect(facts.contentHash).toMatch(/^[0-9a-f]{40}$/)
    expect(facts.simhash).toMatch(/^[0-9a-f]{16}$/)
  })

  it('counts images without alt attribute (alt="" is fine) and mixed content', () => {
    const html =
      '<body><img src="a.png"><img src="b.png" alt=""><img src="http://cdn.example.com/c.png" alt="c"><script src="http://x.example.com/a.js"></script><link rel="stylesheet" href="http://x.example.com/a.css"></body>'
    const facts = parsePage(html, URL)
    expect(facts.imagesTotal).toBe(3)
    expect(facts.imagesMissingAlt).toBe(1)
    expect(facts.insecureResources).toBe(3)
    // Mixed content only exists on HTTPS pages.
    expect(parsePage(html, 'http://example.com/').insecureResources).toBe(0)
  })
})

describe('robots directives', () => {
  it('detects noindex/nofollow including "none"', () => {
    expect(parseRobotsDirectives('NOINDEX, follow')).toEqual({
      noindex: true,
      nofollow: false,
    })
    expect(parseRobotsDirectives('none')).toEqual({
      noindex: true,
      nofollow: true,
    })
    expect(parseRobotsDirectives(null)).toEqual({
      noindex: false,
      nofollow: false,
    })
  })

  it('applies X-Robots-Tag values for all bots and googlebot only', () => {
    expect(xRobotsDirectives(['noindex', 'bingbot: nofollow'])).toBe('noindex')
    expect(xRobotsDirectives('googlebot: noindex')).toBe('noindex')
    expect(
      xRobotsDirectives('unavailable_after: 25 Jun 2030 15:00:00 PST'),
    ).toContain('unavailable_after')
  })
})

describe('parseLinkHeader', () => {
  it('reads canonical and hreflang entries', () => {
    expect(
      parseLinkHeader(
        '<https://example.com/a>; rel="canonical", </en/a>; rel="alternate"; hreflang="en"',
        'https://example.com/de/a',
      ),
    ).toEqual([
      { url: 'https://example.com/a', rel: ['canonical'], hreflang: undefined },
      { url: 'https://example.com/en/a', rel: ['alternate'], hreflang: 'en' },
    ])
  })
})
