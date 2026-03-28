import { defineEventHandler } from 'h3'
import { spawn } from 'child_process'
import { resolve } from 'path'
import { platform } from 'os'

function getOpenCommand(): string {
    switch (platform()) {
        case 'darwin': return 'open'
        case 'win32': return 'explorer'
        default: return 'xdg-open'
    }
}

export default defineEventHandler(async () => {
    const outputDir = resolve(process.cwd(), 'output')
    spawn(getOpenCommand(), [outputDir], { stdio: 'ignore' })
    return { ok: true }
})
