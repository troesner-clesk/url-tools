import { describe, expect, it } from 'vitest'
import { crawlDelaySeconds, isAllowedByRobots, parseRobotsTxt } from '../robots'

const TOKEN = 'urltools'

describe('parseRobotsTxt / isAllowedByRobots', () => {
  it('applies the * group and collects sitemaps', () => {
    const robots = parseRobotsTxt(
      'User-agent: *\nDisallow: /private/\n\nSitemap: https://example.com/sitemap.xml\n',
    )
    expect(isAllowedByRobots(robots, '/private/page', TOKEN)).toBe(false)
    expect(isAllowedByRobots(robots, '/public', TOKEN)).toBe(true)
    expect(robots.sitemaps).toEqual(['https://example.com/sitemap.xml'])
  })

  it('prefers a group for our own token over *', () => {
    const robots = parseRobotsTxt(
      'User-agent: *\nDisallow: /\n\nUser-agent: URLTools\nDisallow: /admin\n',
    )
    expect(isAllowedByRobots(robots, '/blog', TOKEN)).toBe(true)
    expect(isAllowedByRobots(robots, '/admin', TOKEN)).toBe(false)
  })

  it('lets the longest match win and allow win ties', () => {
    const robots = parseRobotsTxt(
      'User-agent: *\nDisallow: /shop\nAllow: /shop/public\nDisallow: /a\nAllow: /a\n',
    )
    expect(isAllowedByRobots(robots, '/shop/cart', TOKEN)).toBe(false)
    expect(isAllowedByRobots(robots, '/shop/public/item', TOKEN)).toBe(true)
    expect(isAllowedByRobots(robots, '/a', TOKEN)).toBe(true)
  })

  it('supports * and $ wildcards', () => {
    const robots = parseRobotsTxt(
      'User-agent: *\nDisallow: /*.pdf$\nDisallow: /*?sessionid=\n',
    )
    expect(isAllowedByRobots(robots, '/files/report.pdf', TOKEN)).toBe(false)
    expect(isAllowedByRobots(robots, '/files/report.pdf?x=1', TOKEN)).toBe(true)
    expect(isAllowedByRobots(robots, '/page?sessionid=123', TOKEN)).toBe(false)
  })

  it('treats an empty Disallow as allow-all and always allows /robots.txt', () => {
    const robots = parseRobotsTxt('User-agent: *\nDisallow:\n')
    expect(isAllowedByRobots(robots, '/anything', TOKEN)).toBe(true)
    const strict = parseRobotsTxt('User-agent: *\nDisallow: /\n')
    expect(isAllowedByRobots(strict, '/robots.txt', TOKEN)).toBe(true)
  })

  it('merges consecutive user-agent lines into one group', () => {
    const robots = parseRobotsTxt(
      'User-agent: googlebot\nUser-agent: urltools\nDisallow: /x\n',
    )
    expect(isAllowedByRobots(robots, '/x', TOKEN)).toBe(false)
  })

  it('ignores comments and reads crawl-delay', () => {
    const robots = parseRobotsTxt(
      '# hello\nUser-agent: * # all\nCrawl-delay: 2\nDisallow: /tmp # temp\n',
    )
    expect(crawlDelaySeconds(robots, TOKEN)).toBe(2)
    expect(isAllowedByRobots(robots, '/tmp/file', TOKEN)).toBe(false)
  })
})
