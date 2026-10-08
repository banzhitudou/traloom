import { beforeEach, expect, it, vi } from 'vitest'

const mock = vi.hoisted(() => ({ handlers: new Map<string, Function>(), rows: new Set<number>(), deletes: [] as number[] }))
vi.mock('electron', () => ({ ipcMain: { on: vi.fn(), handle: (name: string, handler: Function) => mock.handlers.set(name, handler) } }))
// Deletion rules are isolated here; the SQLite runtime suite verifies journaling.
vi.mock('../src/main/ipc/recorded-ipc', async () => ({ recordedIpc: (await import('electron')).ipcMain }))
vi.mock('../src/main/db', () => ({ getDb: () => ({
  prepare: (sql: string) => ({
    get: (id: number) => mock.rows.has(id) ? { id } : undefined,
    run: (id: number) => {
      if (sql.startsWith('DELETE FROM paragraph ')) { mock.rows.delete(id); mock.deletes.push(id) }
    }
  }),
  transaction: (fn: Function) => () => {
    const before = new Set(mock.rows)
    try { fn() } catch (error) { mock.rows = before; throw error }
  }
}) }))

import { registerParagraphHandlers } from '../src/main/ipc/paragraph'

beforeEach(() => {
  mock.rows = new Set([1, 2, 3])
  mock.deletes = []
  registerParagraphHandlers()
})

const remove = (ids: unknown) => mock.handlers.get('paragraph:delete-many')!({}, ids)

it('deletes each selected paragraph once and preserves unselected paragraphs', async () => {
  await remove([1, 1, 3])
  expect([...mock.rows]).toEqual([2])
  expect(mock.deletes).toEqual([1, 3])
})

it('rejects invalid selection without deleting anything', async () => {
  for (const ids of [[], [0], [1, '2'], null]) await expect(remove(ids)).rejects.toThrow()
  expect([...mock.rows]).toEqual([1, 2, 3])
})

it('uses a transaction so a missing paragraph rolls back the batch', async () => {
  await expect(remove([1, 99])).rejects.toThrow()
  expect([...mock.rows]).toEqual([1, 2, 3])
})
