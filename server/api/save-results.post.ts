import { defineEventHandler, readBody } from 'h3'
import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import Papa from 'papaparse'

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
    mode: 'html' | 'links'
    baseOutputDir?: string
}

function getTimestamp(): string {
    const now = new Date()
    return now.toISOString()
        .replace(/[:.]/g, '-')
        .replace('T', '_')
        .slice(0, 19)
}

function sanitizeFilename(url: string): string {
    try {
        const parsed = new URL(url)
        // Domain + Path, ohne Protokoll
        let filename = parsed.hostname + parsed.pathname
        // Ungültige Zeichen ersetzen
        filename = filename.replace(/[^a-zA-Z0-9.-]/g, '_')
        // Doppelte Unterstriche entfernen
        filename = filename.replace(/_+/g, '_')
        // Max 100 Zeichen
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
            message: 'results array required'
        })
    }

    // Scraper-Ergebnisse in output/scraper/ speichern
    const baseOutputDir = body.baseOutputDir || join(process.cwd(), 'output', 'scraper')
    const timestamp = getTimestamp()
    const baseFilename = `${timestamp}_${body.mode}`

    const savedFiles: string[] = []

    try {
        // Ordner erstellen falls nicht vorhanden
        await mkdir(baseOutputDir, { recursive: true })

        // HTML Mode: Einzelne HTML-Dateien speichern
        if (body.mode === 'html') {
            const htmlDir = join(baseOutputDir, `${timestamp}_html_files`)
            await mkdir(htmlDir, { recursive: true })

            for (const result of body.results as HtmlResult[]) {
                if (result.html && !result.error) {
                    const filename = sanitizeFilename(result.url) + '.html'
                    const filePath = join(htmlDir, filename)
                    await writeFile(filePath, result.html, 'utf-8')
                    savedFiles.push(filePath)
                }
            }

            // Auch eine Übersichts-CSV mit Metadaten speichern
            const metaResults = (body.results as HtmlResult[]).map(r => ({
                url: r.url,
                status: r.status,
                contentType: r.contentType,
                size: r.size,
                filename: r.error ? '' : sanitizeFilename(r.url) + '.html',
                error: r.error || ''
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
            // Links Mode: JSON/CSV + TXT (nur Links)
            if (body.format === 'json' || body.format === 'both') {
                const jsonPath = join(baseOutputDir, `${baseFilename}.json`)
                await writeFile(jsonPath, JSON.stringify(body.results, null, 2), 'utf-8')
                savedFiles.push(jsonPath)
            }

            if (body.format === 'csv' || body.format === 'both') {
                const csvPath = join(baseOutputDir, `${baseFilename}.csv`)
                const csv = Papa.unparse(body.results)
                await writeFile(csvPath, csv, 'utf-8')
                savedFiles.push(csvPath)
            }

            // TXT mit nur den Links (eine URL pro Zeile)
            const linkResults = body.results as Array<{ targetUrl?: string }>
            const uniqueLinks = [...new Set(linkResults.map(r => r.targetUrl).filter(Boolean))]
            const txtPath = join(baseOutputDir, `${baseFilename}.txt`)
            await writeFile(txtPath, uniqueLinks.join('\n'), 'utf-8')
            savedFiles.push(txtPath)
        }

        return {
            success: true,
            files: savedFiles,
            message: `Saved ${savedFiles.length} file(s)`
        }
    } catch (error) {
        throw createError({
            statusCode: 500,
            message: error instanceof Error ? error.message : 'Failed to save files'
        })
    }
})
