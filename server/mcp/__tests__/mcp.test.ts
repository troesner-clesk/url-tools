import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  type FixtureSite,
  startFixtureSite,
} from '../../crawler/__tests__/fixtures/site'

/**
 * MCP protocol + tools against a real crawl of the fixture site. Modules are
 * imported after OUTPUT_DIR is set (path-guard reads it at import time).
 */

let site: FixtureSite
let outputDir: string
let crawlId: string
let protocol: typeof import('../protocol')
let tools: typeof import('../tools')

async function rpc(method: string, params?: Record<string, unknown>, id = 1) {
  return protocol.handleMcpMessage({ jsonrpc: '2.0', id, method, params })
}

async function call(name: string, args: Record<string, unknown> = {}) {
  const response = await rpc('tools/call', { name, arguments: args })
  const result = response?.result as {
    content: Array<{ type: string; text: string }>
    isError?: boolean
  }
  const text = result.content[0]?.text ?? ''
  // biome-ignore lint/suspicious/noExplicitAny: tests inspect arbitrary tool JSON
  let json: { untrusted_content_notice?: string; data?: any } | null = null
  try {
    json = JSON.parse(text)
  } catch {
    json = null
  }
  return { isError: result.isError === true, text, json }
}

beforeAll(async () => {
  outputDir = mkdtempSync(join(tmpdir(), 'url-tools-mcp-'))
  process.env.OUTPUT_DIR = outputDir
  process.env.URL_TOOLS_ALLOW_LOCALHOST = '1'
  site = await startFixtureSite()
  const engine = await import('../../crawler/engine')
  protocol = await import('../protocol')
  tools = await import('../tools')
  const job = engine.startCrawl({
    startUrl: `${site.base}/`,
    requestsPerSecond: 20,
    source: 'api',
  })
  crawlId = job.crawlId
  await job.done
}, 60_000)

afterAll(async () => {
  const { destroyAgents } = await import('../../crawler/http-client')
  destroyAgents()
  await site?.close()
  rmSync(outputDir, { recursive: true, force: true })
  delete process.env.URL_TOOLS_ALLOW_LOCALHOST
})

afterEach(() => {
  delete process.env.URL_TOOLS_MCP_ALLOW_CRAWL
})

describe('MCP protocol', () => {
  it('negotiates the protocol version on initialize', async () => {
    const supported = await rpc('initialize', { protocolVersion: '2025-06-18' })
    expect(supported?.result).toMatchObject({
      protocolVersion: '2025-06-18',
      capabilities: { tools: {} },
      serverInfo: { name: 'url-tools' },
    })
    const unknown = await rpc('initialize', { protocolVersion: '1999-01-01' })
    expect(
      (unknown?.result as { protocolVersion: string }).protocolVersion,
    ).toBe(protocol.SUPPORTED_PROTOCOL_VERSIONS[0])
  })

  it('answers notifications with nothing and unknown methods with -32601', async () => {
    expect(
      await protocol.handleMcpMessage({
        jsonrpc: '2.0',
        method: 'notifications/initialized',
      }),
    ).toBeNull()
    expect((await rpc('resources/list'))?.error?.code).toBe(-32601)
    expect((await protocol.handleMcpMessage({ foo: 1 }))?.error?.code).toBe(
      -32600,
    )
  })

  it('lists only read tools by default (read-only agent)', async () => {
    const names = (
      (await rpc('tools/list'))?.result as { tools: Array<{ name: string }> }
    ).tools.map((t) => t.name)
    expect(names).toEqual([
      'list_crawls',
      'crawl_overview',
      'list_issues',
      'query_urls',
      'url_details',
      'run_sql',
      'crawl_status',
    ])
    const disabled = await call('start_crawl', { url: 'https://example.com/' })
    expect(disabled.isError).toBe(true)
    expect(disabled.text).toContain('URL_TOOLS_MCP_ALLOW_CRAWL=1')
  })

  it('adds crawl tools when URL_TOOLS_MCP_ALLOW_CRAWL=1', async () => {
    process.env.URL_TOOLS_MCP_ALLOW_CRAWL = '1'
    const names = (
      (await rpc('tools/list'))?.result as { tools: Array<{ name: string }> }
    ).tools.map((t) => t.name)
    expect(names).toContain('start_crawl')
    expect(names).toContain('stop_crawl')
  })

  it('rejects unknown tools with -32602', async () => {
    expect((await rpc('tools/call', { name: 'nope' }))?.error?.code).toBe(
      -32602,
    )
  })
})

describe('MCP tools on a real crawl', () => {
  it('wraps every result with the untrusted-content notice', async () => {
    const result = await call('list_crawls')
    expect(result.json?.untrusted_content_notice).toBe(tools.UNTRUSTED_NOTICE)
    expect(result.json?.data.crawls[0].crawlId).toBe(crawlId)
    expect(result.json?.data.crawls[0].status).toBe('completed')
  })

  it('gives an overview and issues with explanations', async () => {
    const overview = await call('crawl_overview', { crawl_id: crawlId })
    expect(overview.json?.data.totals.htmlPages).toBe(30)
    const issues = await call('list_issues', {
      crawl_id: crawlId,
      severity: 'error',
    })
    const ids = issues.json?.data.issues.map((i: { id: string }) => i.id)
    expect(ids).toContain('response.client-error')
    expect(ids).toContain('redirect.loop')
    const first = issues.json?.data.issues[0]
    expect(first.fix).toBeTruthy()
    expect(first.examples.length).toBeGreaterThan(0)
  })

  it('pages through query_urls with a cursor bound to the query', async () => {
    const page1 = await call('query_urls', {
      crawl_id: crawlId,
      filter: 'internal',
      columns: ['status_code'],
      limit: 10,
    })
    const total = page1.json?.data.total
    expect(page1.json?.data.rows).toHaveLength(10)
    const seen = new Set(
      page1.json?.data.rows.map((r: { url: string }) => r.url),
    )
    let cursor = page1.json?.data.next_cursor
    while (cursor) {
      const next = await call('query_urls', {
        crawl_id: crawlId,
        filter: 'internal',
        columns: ['status_code'],
        limit: 10,
        cursor,
      })
      for (const row of next.json?.data.rows ?? []) seen.add(row.url)
      cursor = next.json?.data.next_cursor
    }
    expect(seen.size).toBe(total)

    const foreign = await call('query_urls', {
      crawl_id: crawlId,
      filter: 'external',
      cursor: page1.json?.data.next_cursor,
    })
    expect(foreign.isError).toBe(true)
    expect(foreign.text).toContain('cursor')
  })

  it('sorts by issue_count even when the column is not selected', async () => {
    const sorted = await call('query_urls', {
      crawl_id: crawlId,
      columns: ['title'],
      sort: 'issue_count',
      direction: 'desc',
      limit: 3,
    })
    expect(sorted.isError).toBe(false)
    const withCounts = await call('query_urls', {
      crawl_id: crawlId,
      columns: ['issue_count'],
      sort: 'issue_count',
      direction: 'desc',
      limit: 3,
    })
    const counts = withCounts.json?.data.rows.map(
      (r: { issue_count: number }) => r.issue_count,
    )
    expect(counts).toEqual([...counts].sort((a: number, b: number) => b - a))
    expect(sorted.json?.data.rows.map((r: { url: string }) => r.url)).toEqual(
      withCounts.json?.data.rows.map((r: { url: string }) => r.url),
    )
  })

  it('computes next_cursor from the rows that fit into the response', () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({
      i,
      pad: 'x'.repeat(1000),
    }))
    const kept = tools.fitRows(rows, 5_000)
    expect(kept.length).toBe(4)
    expect(tools.fitRows([{ huge: 'x'.repeat(10_000) }], 5_000)).toHaveLength(1)
  })

  it('filters URLs by issue and explains invalid input', async () => {
    const loops = await call('query_urls', {
      crawl_id: crawlId,
      issue_id: 'redirect.loop',
    })
    expect(loops.json?.data.total).toBe(2)
    expect(loops.json?.data.rows[0].issue_detail).toContain('loop')
    const bad = await call('query_urls', {
      crawl_id: crawlId,
      columns: ['password'],
    })
    expect(bad.isError).toBe(true)
    expect(bad.text).toContain('Unknown column')
    const unknown = await call('crawl_overview', {
      crawl_id: '2000-01-01_00-00-00_nothing.example',
    })
    expect(unknown.isError).toBe(true)
  })

  it('returns URL details with inlinks and redirect chain', async () => {
    const details = await call('url_details', {
      crawl_id: crawlId,
      url: `${site.base}/redirect-1`,
    })
    expect(
      details.json?.data.redirectChain.map((s: { status: number }) => s.status),
    ).toEqual([301, 301, 200])
    expect(details.json?.data.inlinks.items[0].source).toBe(`${site.base}/`)
  })

  it('runs read-only SQL and refuses writes and runaway queries', async () => {
    const ok = await call('run_sql', {
      crawl_id: crawlId,
      sql: "SELECT issue_id, COUNT(*) AS n FROM v_issues WHERE severity = 'error' GROUP BY issue_id ORDER BY issue_id",
    })
    expect(ok.isError).toBe(false)
    expect(ok.json?.data.rows.length).toBeGreaterThan(3)

    const write = await call('run_sql', {
      crawl_id: crawlId,
      sql: 'DELETE FROM urls',
    })
    expect(write.isError).toBe(true)
    const pragma = await call('run_sql', {
      crawl_id: crawlId,
      sql: "WITH x AS (SELECT 1) SELECT * FROM pragma_table_info('urls')",
    })
    expect(pragma.isError).toBe(true)
    const sandbox = await import('../../crawler/sql-sandbox')
    await expect(
      sandbox.runReadOnlySql(
        crawlId,
        'WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c) SELECT COUNT(*) FROM c',
        { timeoutMs: 1000 },
      ),
    ).rejects.toThrow(/stopped/)
  }, 20_000)

  it('shortens oversized results instead of flooding the context', () => {
    const rows = Array.from({ length: 5000 }, (_, i) => ({
      url: `https://example.com/${'x'.repeat(50)}/${i}`,
    }))
    const text = tools.formatResult({ total: 5000, rows })
    expect(text.length).toBeLessThanOrEqual(tools.MAX_RESULT_CHARS)
    const parsed = JSON.parse(text)
    expect(parsed.data.truncated).toBe(true)
    expect(parsed.data.rows.length).toBeLessThan(5000)
  })
})
