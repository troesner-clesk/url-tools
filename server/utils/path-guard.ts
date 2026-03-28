import { resolve } from 'node:path'

const OUTPUT_ROOT = resolve(process.cwd(), 'output')

// Checks if a path is within the output directory
export function assertWithinOutput(path: string): string {
  const resolved = resolve(path)
  if (resolved !== OUTPUT_ROOT && !resolved.startsWith(`${OUTPUT_ROOT}/`)) {
    throw new Error('Path must be within output directory')
  }
  return resolved
}
