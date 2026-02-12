import { resolve } from 'path'

const OUTPUT_ROOT = resolve(process.cwd(), 'output')

// Prüft ob ein Pfad innerhalb des output-Ordners liegt
export function assertWithinOutput(path: string): string {
    const resolved = resolve(path)
    if (resolved !== OUTPUT_ROOT && !resolved.startsWith(OUTPUT_ROOT + '/')) {
        throw new Error('Path must be within output directory')
    }
    return resolved
}
