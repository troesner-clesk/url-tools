import { defineEventHandler, readBody } from 'h3'
import * as cheerio from 'cheerio'
import { writeFile, mkdir } from 'fs/promises'
import { join, extname } from 'path'
import { assertWithinOutput } from '../utils/path-guard'
import { isAllowedUrl } from '../utils/url-validator'

interface ImageResult {
    src: string
    alt: string
    width?: number
    height?: number
    size?: number
    filename?: string
    localPath?: string
    error?: string
}

interface ScrapeResult {
    sourceUrl: string
    images: ImageResult[]
    total: number
    downloaded: number
    error?: string
}

interface RequestBody {
    urls: string[]
    download: boolean
    minWidth?: number
    minHeight?: number
    formats?: string[]
    outputDir?: string // Use existing output dir (for multi-URL jobs)
    subfolderPerUrl?: boolean // Create subfolder for each URL
}

async function fetchWithTimeout(url: string, timeout = 30000): Promise<Response> {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)

    try {
        const response = await fetch(url, {
            signal: controller.signal,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        })
        clearTimeout(timeoutId)
        return response
    } catch (error) {
        clearTimeout(timeoutId)
        throw error
    }
}

function resolveUrl(base: string, relative: string): string {
    try {
        return new URL(relative, base).href
    } catch {
        return relative
    }
}

function getFilenameFromUrl(imageUrl: string): string {
    try {
        const urlObj = new URL(imageUrl)
        const pathname = urlObj.pathname
        const filename = pathname.split('/').pop() || 'image'

        // Clean up filename
        let cleanName = filename.split('?')[0] || 'image'

        // Add extension if missing
        const ext = extname(cleanName).toLowerCase()
        if (!ext || !['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.ico', '.bmp'].includes(ext)) {
            cleanName += '.jpg'
        }

        return cleanName
    } catch {
        return 'image.jpg'
    }
}

function isValidImageFormat(imageUrl: string, formats?: string[]): boolean {
    if (!formats || formats.length === 0) return true

    const ext = extname(imageUrl).toLowerCase().replace('.', '')
    // Handle URLs with query params
    const cleanExt = ext.split('?')[0]

    return formats.some(f => f.toLowerCase() === cleanExt)
}

export default defineEventHandler(async (event) => {
    const body = await readBody<RequestBody>(event)
    const { download = false, minWidth = 0, minHeight = 0, formats, outputDir: existingOutputDir, subfolderPerUrl = false } = body
    const urls = filterAllowedUrls(body.urls || [])

    if (urls.length === 0) {
        throw createError({
            statusCode: 400,
            message: 'urls array is required'
        })
    }

    const results: ScrapeResult[] = []
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const outputDir = assertWithinOutput(existingOutputDir || join(process.cwd(), 'output', 'images', timestamp))

    // Create output directory if downloading
    if (download) {
        await mkdir(outputDir, { recursive: true })
    }

    for (const url of urls) {
        const result: ScrapeResult = {
            sourceUrl: url,
            images: [],
            total: 0,
            downloaded: 0
        }

        try {
            // Fetch the page
            const response = await fetchWithTimeout(url)
            if (!response.ok) {
                result.error = `HTTP ${response.status}`
                results.push(result)
                continue
            }

            const html = await response.text()
            const $ = cheerio.load(html)
            const images: ImageResult[] = []
            const seenUrls = new Set<string>()

            // Find all images
            $('img').each((_, el) => {
                const $img = $(el)
                let src = $img.attr('src') || $img.attr('data-src') || $img.attr('data-lazy-src')

                if (!src) return

                // Resolve relative URLs
                src = resolveUrl(url, src)

                // Skip data URLs and duplicates
                if (src.startsWith('data:') || seenUrls.has(src)) return
                seenUrls.add(src)

                // Check format filter
                if (!isValidImageFormat(src, formats)) return

                const width = parseInt($img.attr('width') || '0', 10)
                const height = parseInt($img.attr('height') || '0', 10)

                // Apply size filters if dimensions are known
                if (minWidth > 0 && width > 0 && width < minWidth) return
                if (minHeight > 0 && height > 0 && height < minHeight) return

                images.push({
                    src,
                    alt: $img.attr('alt') || '',
                    width: width || undefined,
                    height: height || undefined
                })
            })

            // Also check for background images in style attributes
            $('[style*="background"]').each((_, el) => {
                const style = $(el).attr('style') || ''
                const match = style.match(/url\(['"]?([^'")\s]+)['"]?\)/i)

                if (match && match[1]) {
                    let src = resolveUrl(url, match[1])

                    if (!src.startsWith('data:') && !seenUrls.has(src)) {
                        if (isValidImageFormat(src, formats)) {
                            seenUrls.add(src)
                            images.push({
                                src,
                                alt: ''
                            })
                        }
                    }
                }
            })

            // Check for srcset
            $('source[srcset], img[srcset]').each((_, el) => {
                const srcset = $(el).attr('srcset') || ''
                const sources = srcset.split(',').map(s => s.trim().split(/\s+/)[0])

                for (const src of sources) {
                    if (!src) continue
                    const resolvedSrc = resolveUrl(url, src)

                    if (!resolvedSrc.startsWith('data:') && !seenUrls.has(resolvedSrc)) {
                        if (isValidImageFormat(resolvedSrc, formats)) {
                            seenUrls.add(resolvedSrc)
                            images.push({
                                src: resolvedSrc,
                                alt: ''
                            })
                        }
                    }
                }
            })

            result.total = images.length

            // Download images if requested
            if (download && images.length > 0) {
                // Determine save directory
                let saveDir = outputDir
                let filenamePrefix = ''

                if (subfolderPerUrl) {
                    // Create subfolder using URL hostname
                    try {
                        const urlObj = new URL(url)
                        const hostname = urlObj.hostname.replace(/[^a-zA-Z0-9.-]/g, '_')
                        saveDir = join(outputDir, hostname)
                        await mkdir(saveDir, { recursive: true })
                    } catch {
                        // Fallback to main folder
                    }
                } else {
                    // Flat structure: prefix with hostname to avoid collisions
                    try {
                        const urlObj = new URL(url)
                        filenamePrefix = urlObj.hostname.replace(/[^a-zA-Z0-9.-]/g, '_') + '_'
                    } catch {
                        filenamePrefix = 'img_'
                    }
                }

                for (let i = 0; i < images.length; i++) {
                    const img = images[i]
                    if (!img) continue

                    try {
                        const imgResponse = await fetchWithTimeout(img.src, 15000)
                        if (!imgResponse.ok) {
                            img.error = `HTTP ${imgResponse.status}`
                            continue
                        }

                        const buffer = await imgResponse.arrayBuffer()
                        img.size = buffer.byteLength

                        // Generate unique filename
                        let filename = getFilenameFromUrl(img.src)
                        const baseName = filename.replace(/\.[^.]+$/, '')
                        const ext = extname(filename)
                        filename = `${filenamePrefix}${i + 1}_${baseName}${ext}`

                        const localPath = join(saveDir, filename)
                        await writeFile(localPath, Buffer.from(buffer))

                        img.filename = filename
                        img.localPath = localPath
                        result.downloaded++
                    } catch (e) {
                        img.error = e instanceof Error ? e.message : 'Download failed'
                    }
                }
            }

            result.images = images
        } catch (e) {
            result.error = e instanceof Error ? e.message : 'Failed to fetch page'
        }

        results.push(result)
    }

    // Calculate totals
    const totalImages = results.reduce((sum, r) => sum + r.total, 0)
    const totalDownloaded = results.reduce((sum, r) => sum + r.downloaded, 0)

    return {
        results,
        outputDir: download ? outputDir : null,
        stats: {
            pages: results.length,
            totalImages,
            downloaded: totalDownloaded
        }
    }
})
