import { describe, it, expect } from 'vitest'
import { isInternalLink, normalizeUrl, extractLinks, isSitemap, formatRedirectChain } from '../link-analyzer'

describe('isInternalLink', () => {
    it('identifies internal links', () => {
        expect(isInternalLink('https://example.com', 'https://example.com/page')).toBe(true)
        expect(isInternalLink('https://example.com/a', 'https://example.com/b')).toBe(true)
    })

    it('identifies external links', () => {
        expect(isInternalLink('https://example.com', 'https://other.com/page')).toBe(false)
    })

    it('handles relative URLs', () => {
        expect(isInternalLink('https://example.com', '/page')).toBe(true)
    })

    it('treats relative paths as internal (resolved against base)', () => {
        // 'not-a-url' is treated as a relative path by new URL(target, base)
        expect(isInternalLink('https://example.com', 'not-a-url')).toBe(true)
    })
})

describe('normalizeUrl', () => {
    it('removes fragments', () => {
        expect(normalizeUrl('https://example.com/page#section')).toBe('https://example.com/page')
    })

    it('removes trailing slashes except root', () => {
        expect(normalizeUrl('https://example.com/page/')).toBe('https://example.com/page')
        expect(normalizeUrl('https://example.com/')).toBe('https://example.com/')
    })

    it('resolves relative URLs with base', () => {
        expect(normalizeUrl('/page', 'https://example.com')).toBe('https://example.com/page')
    })

    it('returns null for invalid URLs', () => {
        expect(normalizeUrl('not-a-url')).toBe(null)
    })
})

describe('extractLinks', () => {
    it('extracts links from HTML', () => {
        const html = '<html><body><a href="https://example.com/page">Link</a></body></html>'
        const links = extractLinks(html, 'https://example.com')
        expect(links).toHaveLength(1)
        expect(links[0].targetUrl).toBe('https://example.com/page')
        expect(links[0].anchorText).toBe('Link')
        expect(links[0].isInternal).toBe(true)
    })

    it('identifies external links', () => {
        const html = '<a href="https://other.com">External</a>'
        const links = extractLinks(html, 'https://example.com')
        expect(links[0].isInternal).toBe(false)
    })

    it('ignores javascript: and mailto: links', () => {
        const html = `
            <a href="javascript:void(0)">JS</a>
            <a href="mailto:test@example.com">Email</a>
            <a href="tel:123456">Phone</a>
            <a href="#section">Anchor</a>
            <a href="https://example.com/real">Real</a>
        `
        const links = extractLinks(html, 'https://example.com')
        expect(links).toHaveLength(1)
        expect(links[0].targetUrl).toBe('https://example.com/real')
    })

    it('deduplicates links', () => {
        const html = `
            <a href="https://example.com/page">First</a>
            <a href="https://example.com/page">Second</a>
        `
        const links = extractLinks(html, 'https://example.com')
        expect(links).toHaveLength(1)
    })

    it('extracts rel attributes', () => {
        const html = '<a href="https://example.com/page" rel="nofollow noopener">Link</a>'
        const links = extractLinks(html, 'https://example.com')
        expect(links[0].rel).toEqual(['nofollow', 'noopener'])
    })

    it('returns empty array for HTML with no links', () => {
        expect(extractLinks('<p>No links</p>', 'https://example.com')).toEqual([])
    })
})

describe('isSitemap', () => {
    it('detects XML sitemaps', () => {
        expect(isSitemap('<?xml version="1.0"?><urlset></urlset>')).toBe(true)
        expect(isSitemap('<sitemapindex></sitemapindex>')).toBe(true)
    })

    it('rejects regular HTML', () => {
        expect(isSitemap('<html><body>Hello</body></html>')).toBe(false)
        expect(isSitemap('plain text')).toBe(false)
    })
})

describe('formatRedirectChain', () => {
    it('formats chain as status codes joined by arrows', () => {
        expect(formatRedirectChain([
            { url: 'http://a.com', status: 301 },
            { url: 'https://a.com', status: 200 },
        ])).toBe('301 → 200')
    })

    it('returns empty string for empty chain', () => {
        expect(formatRedirectChain([])).toBe('')
    })
})
