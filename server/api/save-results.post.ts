import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createError, defineEventHandler, readBody } from 'h3'
import Papa from 'papaparse'
import { assertWithinOutput, OUTPUT_ROOT } from '../utils/path-guard'

interface HtmlResult {
  url: string
  status: number
  contentType: string
  size: number
  html: string
  error?: string
}

interface SaveResultsRequest {
  results: Record<string, unknown>[]
  format: 'csv' | 'json' | 'both'
  mode: 'html' | 'links' | 'inbound-links' | 'seo'
  baseOutputDir?: string
}

export function getTimestamp(): string {
  const now = new Date()
  return now.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19)
}

export function sanitizeFilename(url: string): string {
  try {
    const parsed = new URL(url)
    // Domain + path, without protocol
    let filename = parsed.hostname + parsed.pathname
    // Replace invalid characters
    filename = filename.replace(/[^a-zA-Z0-9.-]/g, '_')
    // Remove duplicate underscores
    filename = filename.replace(/_+/g, '_')
    // Max 100 characters
    return filename.slice(0, 100)
  } catch {
    return 'unknown'
  }
}

export default defineEventHandler(async (event) => {
  const body = await readBody<SaveResultsRequest>(event)

  if (!body.results || !Array.isArray(body.results)) {
    throw createError({
      statusCode: 400,
      message: 'results array required',
    })
  }

  // Guard against OOM when serializing very large matrix results
  const MAX_RESULTS = 50000
  if (body.results.length > MAX_RESULTS) {
    throw createError({
      statusCode: 413,
      message: `too many results (max ${MAX_RESULTS}); refine filters or use sitemap scope`,
    })
  }

  // Output subdirectory depends on mode
  const defaultDir =
    body.mode === 'inbound-links'
      ? join(OUTPUT_ROOT, 'silo')
      : body.mode === 'seo'
        ? join(OUTPUT_ROOT, 'seo-audit')
        : join(OUTPUT_ROOT, 'scraper')
  const baseOutputDir = assertWithinOutput(body.baseOutputDir || defaultDir)
  const timestamp = getTimestamp()
  const baseFilename = `${timestamp}_${body.mode}`

  const savedFiles: string[] = []

  try {
    // Create directory if it doesn't exist
    await mkdir(baseOutputDir, { recursive: true })

    // HTML mode: save individual HTML files
    if (body.mode === 'html') {
      const htmlDir = join(baseOutputDir, `${timestamp}_html_files`)
      await mkdir(htmlDir, { recursive: true })

      for (const result of body.results as HtmlResult[]) {
        if (result.html && !result.error) {
          const filename = `${sanitizeFilename(result.url)}.html`
          const filePath = join(htmlDir, filename)
          await writeFile(filePath, result.html, 'utf-8')
          savedFiles.push(filePath)
        }
      }

      // Also save a summary CSV with metadata
      const metaResults = (body.results as HtmlResult[]).map((r) => ({
        url: r.url,
        status: r.status,
        contentType: r.contentType,
        size: r.size,
        filename: r.error ? '' : `${sanitizeFilename(r.url)}.html`,
        error: r.error || '',
      }))

      if (body.format === 'csv' || body.format === 'both') {
        const csvPath = join(baseOutputDir, `${baseFilename}_meta.csv`)
        const csv = Papa.unparse(metaResults)
        await writeFile(csvPath, csv, 'utf-8')
        savedFiles.push(csvPath)
      }

      if (body.format === 'json' || body.format === 'both') {
        const jsonPath = join(baseOutputDir, `${baseFilename}_meta.json`)
        await writeFile(jsonPath, JSON.stringify(metaResults, null, 2), 'utf-8')
        savedFiles.push(jsonPath)
      }
    } else {
      // Links / inbound-links mode: JSON/CSV + TXT
      if (body.format === 'json' || body.format === 'both') {
        const jsonPath = join(baseOutputDir, `${baseFilename}.json`)
        await writeFile(
          jsonPath,
          JSON.stringify(body.results, null, 2),
          'utf-8',
        )
        savedFiles.push(jsonPath)
      }

      if (body.format === 'csv' || body.format === 'both') {
        const csvPath = join(baseOutputDir, `${baseFilename}.csv`)
        const csv = Papa.unparse(body.results)
        await writeFile(csvPath, csv, 'utf-8')
        savedFiles.push(csvPath)
      }

      // TXT: inbound-links → unique sourceUrls;
      // links → unique targetUrls; seo → unique url.
      let urlField = 'targetUrl'
      if (body.mode === 'inbound-links') urlField = 'sourceUrl'
      else if (body.mode === 'seo') urlField = 'url'
      const linkResults = body.results as Array<Record<string, unknown>>
      const uniqueLinks = [
        ...new Set(
          linkResults
            .map((r) => r[urlField])
            .filter((v): v is string => typeof v === 'string' && v.length > 0),
        ),
      ]
      const txtPath = join(baseOutputDir, `${baseFilename}.txt`)
      await writeFile(txtPath, uniqueLinks.join('\n'), 'utf-8')
      savedFiles.push(txtPath)
    }

    return {
      success: true,
      files: savedFiles,
      message: `Saved ${savedFiles.length} file(s)`,
    }
  } catch (error) {
    throw createError({
      statusCode: 500,
      message: error instanceof Error ? error.message : 'Failed to save files',
    })
  }
})
