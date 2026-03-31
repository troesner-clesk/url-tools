import { spawn } from 'node:child_process'
import { platform } from 'node:os'
import { resolve } from 'node:path'
import { defineEventHandler, getQuery } from 'h3'
import { OUTPUT_ROOT } from '../utils/path-guard'

function getOpenCommand(): string {
  switch (platform()) {
    case 'darwin':
      return 'open'
    case 'win32':
      return 'explorer'
    default:
      return 'xdg-open'
  }
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const inputPath = query.path as string

  if (!inputPath) {
    throw createError({
      statusCode: 400,
      message: 'path parameter required',
    })
  }

  // Resolve path and validate it's within the output directory
  const resolvedPath = resolve(inputPath)

  if (
    !resolvedPath.startsWith(`${OUTPUT_ROOT}/`) &&
    resolvedPath !== OUTPUT_ROOT
  ) {
    throw createError({
      statusCode: 403,
      message: 'Access denied: path must be within output directory',
    })
  }

  return new Promise((resolvePromise, reject) => {
    // Use spawn with arguments array to prevent command injection
    const child = spawn(getOpenCommand(), [resolvedPath], { stdio: 'ignore' })

    child.on('close', (code) => {
      if (code === 0) {
        resolvePromise({ success: true })
      } else {
        reject(
          createError({
            statusCode: 500,
            message: 'Failed to open folder',
          }),
        )
      }
    })

    child.on('error', () => {
      reject(
        createError({
          statusCode: 500,
          message: 'Failed to open folder',
        }),
      )
    })
  })
})
