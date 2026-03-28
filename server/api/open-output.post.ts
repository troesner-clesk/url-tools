import { spawn } from 'node:child_process'
import { platform } from 'node:os'
import { resolve } from 'node:path'
import { defineEventHandler } from 'h3'

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

export default defineEventHandler(async () => {
  const outputDir = resolve(process.cwd(), 'output')
  spawn(getOpenCommand(), [outputDir], { stdio: 'ignore' })
  return { ok: true }
})
