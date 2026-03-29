import { readdir, stat } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { defineEventHandler } from 'h3'
import { OUTPUT_ROOT } from '../utils/path-guard'

interface OutputFile {
  name: string
  path: string
  size: number
  modified: string
  type: 'json' | 'csv' | 'html' | 'folder' | 'other'
}

async function getFilesRecursive(
  dir: string,
  baseDir: string,
): Promise<OutputFile[]> {
  const files: OutputFile[] = []

  try {
    const entries = await readdir(dir, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = join(dir, entry.name)

      // Skip hidden files
      if (entry.name.startsWith('.')) continue

      if (entry.isDirectory()) {
        // Show folder
        const subFiles = await getFilesRecursive(fullPath, baseDir)
        const folderStat = await stat(fullPath)

        files.push({
          name: entry.name,
          path: fullPath,
          size: subFiles.reduce((sum, f) => sum + f.size, 0),
          modified: folderStat.mtime.toISOString(),
          type: 'folder',
        })

        // Add files from folder (with prefix)
        for (const subFile of subFiles) {
          files.push({
            ...subFile,
            name: `${entry.name}/${subFile.name}`,
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
          type,
        })
      }
    }
  } catch (_error) {
    // Ignore errors
  }

  return files
}

export default defineEventHandler(async () => {
  const outputDir = OUTPUT_ROOT

  try {
    const files = await getFilesRecursive(outputDir, outputDir)

    // Sort by date (newest first), folders first
    files.sort((a, b) => {
      // Folders first (top-level only)
      if (a.type === 'folder' && b.type !== 'folder' && !a.name.includes('/'))
        return -1
      if (b.type === 'folder' && a.type !== 'folder' && !b.name.includes('/'))
        return 1
      // By date
      return new Date(b.modified).getTime() - new Date(a.modified).getTime()
    })

    return {
      outputDir,
      files,
    }
  } catch (_error) {
    return {
      outputDir,
      files: [],
    }
  }
})
