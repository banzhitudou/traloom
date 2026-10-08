/**
 * 渲染进程对 window.api 的类型化封装。
 * 来源契约：src/shared/ipc-api.ts
 */
import type { ExposedApi } from '@shared/ipc-api'

// 全局 window.api 类型声明（由 preload 注入）
declare global {
  interface Window {
    api: ExposedApi
  }
}

export const REVISION_CHANGED = 'workbench-revision-changed'
const revisionMethods = /^(setGlossaryAcceptance|update|flush|save|create|delete|merge|unmerge|reorder|commit|apply|resolve|bulk|undo|adopt|restoreRevision|annotateRevision|recordOcr|aiCall|getTranslationOptions|cleanOcr)/
// contextBridge freezes its API; wrap a copy so replacing methods respects Proxy invariants.
export const api: ExposedApi = new Proxy({ ...window.api }, {
  get(target, key) {
    const method = target[key as keyof ExposedApi]
    if (typeof method !== 'function' || !revisionMethods.test(String(key))) return method
    return (...args: unknown[]) => {
      const result = (method as (...values: unknown[]) => unknown)(...args)
      if (result instanceof Promise) return result.finally(() => window.dispatchEvent(new Event(REVISION_CHANGED)))
      window.dispatchEvent(new Event(REVISION_CHANGED))
      return result
    }
  }
})
