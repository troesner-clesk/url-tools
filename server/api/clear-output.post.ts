import { mkdir, rm } from 'node:fs/promises'
import { defineEventHandler } from 'h3'
import { OUTPUT_ROOT } from '../utils/path-guard'

export default defineEventHandler(async () => {
  const outputDir = OUTPUT_ROOT

  try {
    // Delete the entire output directory
    await rm(outputDir, { recursive: true, force: true })

    // Recreate empty output directory
    await mkdir(outputDir, { recursive: true })

    return {
      success: true,
      message: 'Output folder cleared',
    }
  } catch (error) {
    throw createError({
      statusCode: 500,
      message:
        error instanceof Error
          ? error.message
          : 'Failed to clear output folder',
    })
  }
})
