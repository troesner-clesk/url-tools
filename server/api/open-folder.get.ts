import { defineEventHandler, getQuery } from 'h3'
import { spawn } from 'child_process'
import { resolve } from 'path'

export default defineEventHandler(async (event) => {
    const query = getQuery(event)
    const inputPath = query.path as string

    if (!inputPath) {
        throw createError({
            statusCode: 400,
            message: 'path parameter required'
        })
    }

    // Resolve path and validate it's within the output directory
    const outputDir = resolve(process.cwd(), 'output')
    const resolvedPath = resolve(inputPath)

    if (!resolvedPath.startsWith(outputDir + '/') && resolvedPath !== outputDir) {
        throw createError({
            statusCode: 403,
            message: 'Access denied: path must be within output directory'
        })
    }

    return new Promise((resolvePromise, reject) => {
        // Use spawn with arguments array to prevent command injection
        const child = spawn('open', [resolvedPath], { stdio: 'ignore' })

        child.on('close', (code) => {
            if (code === 0) {
                resolvePromise({ success: true })
            } else {
                reject(createError({
                    statusCode: 500,
                    message: 'Failed to open folder'
                }))
            }
        })

        child.on('error', () => {
            reject(createError({
                statusCode: 500,
                message: 'Failed to open folder'
            }))
        })
    })
})
