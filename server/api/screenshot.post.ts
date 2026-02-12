import { defineEventHandler, readBody } from 'h3'
import puppeteer, { Browser, Page } from 'puppeteer'
import { writeFile, mkdir } from 'fs/promises'
import { resolve, join } from 'path'
import { assertWithinOutput } from '../utils/path-guard'
import { isAllowedUrl } from '../utils/url-validator'

interface ScreenshotRequest {
    urls: string[]
    format: 'png' | 'jpg' | 'pdf'
    viewport: {
        width: number
        height: number
    }
    fullPage: boolean
    quality?: number // 0-100 for jpg
    timeout?: number // seconds
    outputDir?: string // Use existing output dir (for multi-URL jobs)
    startIndex?: number // Starting index for filename numbering
}

interface ScreenshotResult {
    url: string
    success: boolean
    filename?: string
    size?: number
    error?: string
}

let browser: Browser | null = null

async function getBrowser(): Promise<Browser> {
    if (!browser) {
        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        })
    }
    return browser
}

async function takeScreenshot(
    page: Page,
    url: string,
    options: ScreenshotRequest,
    outputDir: string,
    index: number
): Promise<ScreenshotResult> {
    try {
        // Viewport setzen
        await page.setViewport({
            width: options.viewport.width,
            height: options.viewport.height
        })

        // Seite laden
        await page.goto(url, {
            waitUntil: 'networkidle2',
            timeout: (options.timeout || 30) * 1000
        })

        // Dateiname generieren
        const urlObj = new URL(url)
        const safeName = urlObj.hostname.replace(/[^a-z0-9]/gi, '_')
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
        const ext = options.format === 'pdf' ? 'pdf' : options.format
        const filename = `${String(index + 1).padStart(3, '0')}_${safeName}.${ext}`
        const filepath = join(outputDir, filename)

        let fileSize = 0

        if (options.format === 'pdf') {
            // PDF erstellen
            const pdfBuffer = await page.pdf({
                format: 'A4',
                printBackground: true,
                margin: { top: '1cm', right: '1cm', bottom: '1cm', left: '1cm' }
            })
            await writeFile(filepath, pdfBuffer)
            fileSize = pdfBuffer.length
        } else {
            // Screenshot erstellen
            const screenshotOptions = {
                path: filepath,
                type: options.format === 'jpg' ? 'jpeg' as const : 'png' as const,
                fullPage: options.fullPage,
                quality: options.format === 'jpg' ? options.quality : undefined
            }

            const buffer = await page.screenshot(screenshotOptions)
            fileSize = buffer.length
        }

        return {
            url,
            success: true,
            filename,
            size: fileSize
        }
    } catch (error) {
        return {
            url,
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        }
    }
}

export default defineEventHandler(async (event) => {
    const body = await readBody<ScreenshotRequest>(event)

    if (!body.urls || !Array.isArray(body.urls) || body.urls.length === 0) {
        throw createError({
            statusCode: 400,
            message: 'urls array required'
        })
    }

    body.urls = filterAllowedUrls(body.urls)

    // Output folder - reuse existing or create new
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')
    const outputDir = assertWithinOutput(body.outputDir || resolve(process.cwd(), 'output', 'screenshots', timestamp))
    await mkdir(outputDir, { recursive: true })

    const results: ScreenshotResult[] = []

    try {
        const browserInstance = await getBrowser()
        const page = await browserInstance.newPage()

        const startIndex = body.startIndex || 0
        for (let i = 0; i < body.urls.length; i++) {
            const url = body.urls[i]
            if (!url) continue

            const result = await takeScreenshot(
                page,
                url,
                body,
                outputDir,
                startIndex + i
            )
            results.push(result)
        }

        await page.close()
    } catch (error) {
        // Bei Browser-Fehler: Browser zurücksetzen
        if (browser) {
            try {
                await browser.close()
            } catch { }
            browser = null
        }

        throw createError({
            statusCode: 500,
            message: error instanceof Error ? error.message : 'Browser error'
        })
    }

    return {
        results,
        outputDir,
        stats: {
            total: body.urls.length,
            success: results.filter(r => r.success).length,
            failed: results.filter(r => !r.success).length
        }
    }
})
