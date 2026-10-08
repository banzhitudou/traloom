import { describe, expect, it } from 'vitest'
import { join, resolve } from 'path'
import { resolveProjectPath, storeProjectPath } from '../src/main/services/project-paths'

describe('project-relative resources', () => {
  const project = resolve('fixtures/book/project.twproj')
  it('resolves resource paths from the project rather than the working directory', () => {
    expect(resolveProjectPath(project, 'files/source.pdf')).toBe(resolve('fixtures/book/files/source.pdf'))
    expect(resolveProjectPath(project, 'files\\source.pdf')).toBe(resolve('fixtures/book/files/source.pdf'))
    expect(resolveProjectPath(project, '../draft.md')).toBe(resolve('fixtures/draft.md'))
    expect(resolveProjectPath(project, '')).toBe('')
  })
  it('stores contained files relative to the project and preserves external absolute references', () => {
    expect(storeProjectPath(project, resolve('fixtures/book/files/source.pdf'))).toBe('files/source.pdf')
    expect(storeProjectPath(project, resolve('fixtures/other/source.pdf'))).toBe(resolve('fixtures/other/source.pdf'))
    expect(resolveProjectPath(project, 'C:\\Books\\source.pdf')).toBe('C:\\Books\\source.pdf')
  })
  it('keeps a moved package independent of the original directory', () => {
    const stored = storeProjectPath(project, resolve('fixtures/book/files/source.pdf'))
    expect(resolveProjectPath(resolve('elsewhere/project.twproj'), stored)).toBe(join(resolve('elsewhere'), 'files/source.pdf'))
  })
})
