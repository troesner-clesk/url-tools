import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { OUTPUT_ROOT, assertWithinOutput } from '../path-guard'

describe('assertWithinOutput', () => {
  it('allows paths within the output directory', () => {
    const path = resolve(OUTPUT_ROOT, 'scraper', 'test.json')
    expect(assertWithinOutput(path)).toBe(path)
  })

  it('allows the output directory itself', () => {
    expect(assertWithinOutput(OUTPUT_ROOT)).toBe(OUTPUT_ROOT)
  })

  it('allows nested subdirectories', () => {
    const path = resolve(OUTPUT_ROOT, 'images', '2026-01', 'test.png')
    expect(assertWithinOutput(path)).toBe(path)
  })

  it('blocks paths outside the output directory', () => {
    expect(() => assertWithinOutput('/etc/passwd')).toThrow(
      'Path must be within output directory',
    )
    expect(() => assertWithinOutput('/tmp/evil')).toThrow(
      'Path must be within output directory',
    )
  })

  it('blocks path traversal attacks', () => {
    const traversal = resolve(OUTPUT_ROOT, '..', '..', 'etc', 'passwd')
    expect(() => assertWithinOutput(traversal)).toThrow(
      'Path must be within output directory',
    )
  })

  it('blocks relative path traversal via ../', () => {
    expect(() => assertWithinOutput(`${OUTPUT_ROOT}/../secret`)).toThrow(
      'Path must be within output directory',
    )
  })
})
