import { defineEventHandler } from 'h3'
import { spawn } from 'child_process'
import { resolve } from 'path'

export default defineEventHandler(async () => {
    const outputDir = resolve(process.cwd(), 'output')
    spawn('open', [outputDir], { stdio: 'ignore' })
    return { ok: true }
})
