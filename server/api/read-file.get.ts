import { defineEventHandler, getQuery } from 'h3'
import { readFile } from 'fs/promises'
import { resolve } from 'path'

export default defineEventHandler(async (event) => {
    const query = getQuery(event)
    const filePath = query.path as string
    const base64 = query.base64 === 'true'

    if (!filePath) {
        throw createError({
            statusCode: 400,
            message: 'path parameter required'
        })
    }

    // Resolve paths to prevent path traversal attacks
    const outputDir = resolve(process.cwd(), 'output')
    const resolvedPath = resolve(filePath)

    if (!resolvedPath.startsWith(outputDir + '/') && resolvedPath !== outputDir) {
        throw createError({
            statusCode: 403,
            message: 'Access denied'
        })
    }

    try {
        if (base64) {
            // Read as binary and encode to base64
            const buffer = await readFile(resolvedPath)
            const content = buffer.toString('base64')
            return { content }
        } else {
            // Read as text
            const content = await readFile(resolvedPath, 'utf-8')
            return { content }
        }
    } catch (error) {
        throw createError({
            statusCode: 404,
            message: 'File not found'
        })
    }
})
