import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchSitemapUrls } from '../sitemap'

const SETTINGS = { timeout: 30, retries: 0 }

function xmlResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'application/xml' },
  })
}

function mkUrlset(...urls: string[]): string {
  const inner = urls
    .map((u) => `  <url><loc>${u}</loc></url>`)
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${inner}
</urlset>`
}

function mkIndex(...sitemapUrls: string[]): string {
  const inner = sitemapUrls
    .map((u) => `  <sitemap><loc>${u}</loc></sitemap>`)
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${inner}
</sitemapindex>`
}

describe('fetchSitemapUrls', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch')
  })
  afterEach(() => {
    fetchSpy.mockRestore()
  })

  it('extracts URLs from a simple urlset', async () => {
    fetchSpy.mockResolvedValueOnce(
      xmlResponse(mkUrlset('https://example.com/a', 'https://example.com/b')),
    )
    const result = await fetchSitemapUrls(
      'https://example.com/sitemap.xml',
      SETTINGS,
    )
    expect(result.entries.map((e) => e.loc)).toEqual([
      'https://example.com/a',
      'https://example.com/b',
    ])
    expect(result.sitemapsFetched).toBe(1)
  })

  it('with recursive=false does NOT follow child sitemaps', async () => {
    fetchSpy.mockResolvedValueOnce(
      xmlResponse(mkIndex('https://example.com/sitemap-1.xml')),
    )
    const result = await fetchSitemapUrls(
      'https://example.com/sitemap.xml',
      SETTINGS,
      { recursive: false },
    )
    expect(result.entries).toHaveLength(0)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('with recursive=true follows child sitemaps and merges entries', async () => {
    fetchSpy
      .mockResolvedValueOnce(
        xmlResponse(
          mkIndex(
            'https://example.com/sitemap-1.xml',
            'https://example.com/sitemap-2.xml',
          ),
        ),
      )
      .mockResolvedValueOnce(xmlResponse(mkUrlset('https://example.com/a')))
      .mockResolvedValueOnce(xmlResponse(mkUrlset('https://example.com/b')))
    const result = await fetchSitemapUrls(
      'https://example.com/sitemap.xml',
      SETTINGS,
      { recursive: true },
    )
    expect(result.entries.map((e) => e.loc).sort()).toEqual([
      'https://example.com/a',
      'https://example.com/b',
    ])
    expect(result.sitemapsFetched).toBe(3)
  })

  it('respects maxEntries cap', async () => {
    fetchSpy.mockResolvedValueOnce(
      xmlResponse(
        mkUrlset(
          'https://example.com/a',
          'https://example.com/b',
          'https://example.com/c',
        ),
      ),
    )
    const result = await fetchSitemapUrls(
      'https://example.com/sitemap.xml',
      SETTINGS,
      { maxEntries: 2 },
    )
    expect(result.entries).toHaveLength(2)
  })

  it('respects maxSitemaps cap', async () => {
    fetchSpy
      .mockResolvedValueOnce(
        xmlResponse(
          mkIndex(
            'https://example.com/s1.xml',
            'https://example.com/s2.xml',
            'https://example.com/s3.xml',
          ),
        ),
      )
      .mockResolvedValue(xmlResponse(mkUrlset('https://example.com/x')))
    const result = await fetchSitemapUrls(
      'https://example.com/sitemap.xml',
      SETTINGS,
      { recursive: true, maxSitemaps: 2 },
    )
    // First fetch (the index) counts toward maxSitemaps, so only 1 child is fetched.
    expect(result.sitemapsFetched).toBe(2)
  })

  it('invokes onSitemapFetched callback per fetched sitemap', async () => {
    fetchSpy
      .mockResolvedValueOnce(
        xmlResponse(
          mkIndex(
            'https://example.com/s1.xml',
            'https://example.com/s2.xml',
          ),
        ),
      )
      .mockResolvedValueOnce(
        xmlResponse(
          mkUrlset('https://example.com/a', 'https://example.com/b'),
        ),
      )
      .mockResolvedValueOnce(xmlResponse(mkUrlset('https://example.com/c')))

    const calls: Array<[string, number]> = []
    await fetchSitemapUrls(
      'https://example.com/sitemap.xml',
      SETTINGS,
      {
        recursive: true,
        onSitemapFetched: (url, n) => {
          calls.push([url, n])
        },
      },
    )

    expect(calls).toEqual([
      ['https://example.com/sitemap.xml', 0], // index has no urlset entries
      ['https://example.com/s1.xml', 2],
      ['https://example.com/s2.xml', 1],
    ])
  })

  it('a throwing callback does not abort the fetch loop', async () => {
    fetchSpy
      .mockResolvedValueOnce(
        xmlResponse(mkIndex('https://example.com/s1.xml')),
      )
      .mockResolvedValueOnce(xmlResponse(mkUrlset('https://example.com/a')))

    const result = await fetchSitemapUrls(
      'https://example.com/sitemap.xml',
      SETTINGS,
      {
        recursive: true,
        onSitemapFetched: () => {
          throw new Error('boom')
        },
      },
    )
    expect(result.entries.map((e) => e.loc)).toEqual(['https://example.com/a'])
    expect(result.sitemapsFetched).toBe(2)
  })

  it('deduplicates a URL appearing twice in the same sitemap', async () => {
    fetchSpy.mockResolvedValueOnce(
      xmlResponse(
        mkUrlset('https://example.com/a', 'https://example.com/a'),
      ),
    )
    const result = await fetchSitemapUrls(
      'https://example.com/sitemap.xml',
      SETTINGS,
    )
    expect(result.entries).toHaveLength(1)
  })
})
