import { defineEventHandler } from 'h3'
import { exec } from 'child_process'
import { resolve } from 'path'

export default defineEventHandler(async () => {
    const outputDir = resolve(process.cwd(), 'output')
    exec(`open "${outputDir}"`)
    return { ok: true }
})
