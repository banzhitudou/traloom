import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { reserveNewProjectFile } from '../src/main/services/new-project-file'
import { newProjectFileName } from '../src/shared/project-file-name'

describe('PDF-adjacent project file', () => {
  it('uses the same name on both platforms', () => {
    expect(newProjectFileName('/books/Food.PDF')).toBe('Food-翻译工程.twproj')
    expect(newProjectFileName('C:\\books\\Food.pdf')).toBe('Food-翻译工程.twproj')
    expect(newProjectFileName('/books/A:B.pdf')).toBe('A_B-翻译工程.twproj')
  })
  it('creates beside PDF and never overwrites an existing project or PDF', () => {
    const folder = mkdtempSync(join(tmpdir(), 'workbench-adjacent-'))
    try {
      const pdf = join(folder, 'Food.pdf')
      writeFileSync(pdf, 'original PDF')
      const first = reserveNewProjectFile(pdf)
      writeFileSync(first, 'saved translations')
      const second = reserveNewProjectFile(pdf)
      expect(first).toBe(join(folder, 'Food-翻译工程.twproj'))
      expect(second).toBe(join(folder, 'Food-翻译工程-2.twproj'))
      expect(readFileSync(first, 'utf8')).toBe('saved translations')
      expect(readFileSync(pdf, 'utf8')).toBe('original PDF')
    } finally { rmSync(folder, { recursive: true, force: true }) }
  })
})
