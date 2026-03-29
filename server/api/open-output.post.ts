import { spawn } from 'node:child_process'
import { platform } from 'node:os'
import { defineEventHandler } from 'h3'
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

export default defineEventHandler(async () => {
  spawn(getOpenCommand(), [OUTPUT_ROOT], { stdio: 'ignore' })
  return { ok: true }
})
