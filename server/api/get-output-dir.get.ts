import { defineEventHandler } from 'h3'
import { readdir, stat, readFile } from 'fs/promises'
import { join, extname } from 'path'

interface OutputFile {
    name: string
    path: string
    size: number
    modified: string
    type: 'json' | 'csv' | 'html' | 'folder' | 'other'
}

async function getFilesRecursive(dir: string, baseDir: string): Promise<OutputFile[]> {
    const files: OutputFile[] = []

    try {
        const entries = await readdir(dir, { withFileTypes: true })

        for (const entry of entries) {
            const fullPath = join(dir, entry.name)

            // Skip hidden files
            if (entry.name.startsWith('.')) continue

            if (entry.isDirectory()) {
                // Ordner anzeigen
                const subFiles = await getFilesRecursive(fullPath, baseDir)
                const folderStat = await stat(fullPath)

                files.push({
                    name: entry.name,
                    path: fullPath,
                    size: subFiles.reduce((sum, f) => sum + f.size, 0),
                    modified: folderStat.mtime.toISOString(),
                    type: 'folder'
                })

                // Dateien im Ordner hinzufügen (mit Präfix)
                for (const subFile of subFiles) {
                    files.push({
                        ...subFile,
                        name: `${entry.name}/${subFile.name}`
                    })
                }
            } else {
                const ext = extname(entry.name).toLowerCase()
                const fileStat = await stat(fullPath)

                let type: OutputFile['type'] = 'other'
                if (ext === '.json') type = 'json'
                else if (ext === '.csv') type = 'csv'
                else if (ext === '.html') type = 'html'

                files.push({
                    name: entry.name,
                    path: fullPath,
                    size: fileStat.size,
                    modified: fileStat.mtime.toISOString(),
                    type
                })
            }
        }
    } catch (error) {
        // Ignore errors
    }

    return files
}

export default defineEventHandler(async () => {
    const outputDir = join(process.cwd(), 'output')

    try {
        const files = await getFilesRecursive(outputDir, outputDir)

        // Nach Datum sortieren (neueste zuerst), Ordner zuerst
        files.sort((a, b) => {
            // Ordner zuerst (nur Top-Level)
            if (a.type === 'folder' && b.type !== 'folder' && !a.name.includes('/')) return -1
            if (b.type === 'folder' && a.type !== 'folder' && !b.name.includes('/')) return 1
            // Nach Datum
            return new Date(b.modified).getTime() - new Date(a.modified).getTime()
        })

        return {
            outputDir,
            files
        }
    } catch (error) {
        return {
            outputDir,
            files: []
        }
    }
})
