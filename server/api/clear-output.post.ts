import { defineEventHandler } from 'h3'
import { rm, mkdir } from 'fs/promises'
import { join } from 'path'

export default defineEventHandler(async () => {
    const outputDir = join(process.cwd(), 'output')

    try {
        // Delete the entire output directory
        await rm(outputDir, { recursive: true, force: true })

        // Recreate empty output directory
        await mkdir(outputDir, { recursive: true })

        return {
            success: true,
            message: 'Output folder cleared'
        }
    } catch (error) {
        throw createError({
            statusCode: 500,
            message: error instanceof Error ? error.message : 'Failed to clear output folder'
        })
    }
})
