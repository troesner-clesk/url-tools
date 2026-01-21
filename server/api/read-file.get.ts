import { defineEventHandler, getQuery } from 'h3'
import { readFile } from 'fs/promises'
import { resolve } from 'path'

export default defineEventHandler(async (event) => {
    const query = getQuery(event)
    const filePath = query.path as string

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
        const content = await readFile(resolvedPath, 'utf-8')
        return { content }
    } catch (error) {
        throw createError({
            statusCode: 404,
            message: 'File not found'
        })
    }
})
