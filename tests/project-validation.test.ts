import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
vi.mock('better-sqlite3', () => ({ default: class { pragma() { return [] }; close() {} } }))
import { validateProjectHeader, validateExistingProject } from '../src/main/services/project-validation'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture(text: string) {
  const root = mkdtempSync(join(tmpdir(), 'traloom-validation-')); roots.push(root)
  const file = join(root, 'project.twproj'); writeFileSync(file, text); return file
}
describe('read-only project preflight', () => {
  it.each(['', 'not a database'])('rejects invalid file without changing its contents', text => {
    const file = fixture(text)
    expect(() => validateProjectHeader(file)).toThrow()
    expect(readFileSync(file, 'utf8')).toBe(text)
  })
  it('rejects symlinks and unrelated SQLite schemas', () => {
    const file = fixture('SQLite format 3\0')
    const link = file + '.link.twproj'; symlinkSync(file, link)
    expect(() => validateProjectHeader(link)).toThrow()
    expect(() => validateExistingProject(file)).toThrow(/不是 Traloom/)
    expect(readFileSync(file, 'utf8')).toBe('SQLite format 3\0')
  })
})
