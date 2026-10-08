import { useEffect, useState } from 'react'
import { api } from '@renderer/lib/ipc'
import ReferenceSettings from '../Workbench/ReferenceSettings'
import type { LlmConfig, AiTask } from '@shared/types'

interface Props {
  onBack: () => void
}

interface EditState {
  id?: number
  name: string
  protocol: LlmConfig['protocol']
  baseUrl: string
  apiKey: string
  model: string
  temperature: number
  maxTokens: number
  systemPrompt: string
  isDefault: boolean
}

const EMPTY_EDIT: EditState = {
  name: '',
  protocol: 'openai_chat',
  baseUrl: '',
  apiKey: '',
  model: '',
  temperature: 0.3,
  maxTokens: 2048,
  systemPrompt: '',
  isDefault: false
}

const PROTOCOLS: Record<LlmConfig['protocol'], { label: string; baseUrl: string; endpoint: string }> = {
  openai_chat: {
    label: 'OpenAI Chat Completions',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    endpoint: '/chat/completions'
  },
  openai_responses: {
    label: 'OpenAI Responses',
    baseUrl: 'https://open.bigmodel.cn/api/v1',
    endpoint: '/responses'
  },
  anthropic: {
    label: 'Anthropic Messages',
    baseUrl: 'https://open.bigmodel.cn/api/anthropic',
    endpoint: '/v1/messages'
  }
}

const TASK_LABELS: Record<AiTask, string> = {
  whole_para: '整段参考译文',
  hard_sentence: '难句分析',
  hard_word: '难词解释',
  consistency: '一致性检查',
  align: '对齐判定'
}

const TASKS: AiTask[] = ['whole_para']

/**
 * LLM 设置页（模型配置 + 用途分配）。
 * 见《UI线框图》第 6 节。
 */
export default function Settings({ onBack }: Props) {
  const [mode, setMode] = useState<'models' | 'reference'>('models')
  const [configs, setConfigs] = useState<LlmConfig[]>([])
  const [editing, setEditing] = useState<EditState | null>(null)
  const [busy, setBusy] = useState(false)
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [testMsgCopied, setTestMsgCopied] = useState(false)
  const [assignment, setAssignment] = useState<Record<string, number>>({})

  const refresh = async () => {
    const list = await api.listLlmConfigs()
    setConfigs(list)
    const assignments = await api.getLlmAssignments()
    setAssignment(assignments)
  }

  useEffect(() => {
    refresh()
  }, [])

  const startEdit = (c?: LlmConfig) => {
    setTestMsg(null)
    setTestMsgCopied(false)
    if (c) {
      setEditing({
        id: c.id, name: c.name, protocol: c.protocol, baseUrl: c.baseUrl,
        apiKey: '', model: c.model, temperature: c.temperature, maxTokens: c.maxTokens,
        systemPrompt: c.systemPrompt, isDefault: c.isDefault
      })
    } else {
      setEditing({ ...EMPTY_EDIT })
    }
  }

  const save = async () => {
    if (!editing || !editing.name || !editing.model) return
    setBusy(true)
    try {
      await api.saveLlmConfig(editing)
      setEditing(null)
      refresh()
    } catch (error) {
      setTestMsg({ ok: false, text: error instanceof Error ? error.message : String(error) })
    } finally { setBusy(false) }
  }

  const test = async () => {
    if (!editing) return
    setBusy(true)
    setTestMsg(null)
    setTestMsgCopied(false)
    try {
      const r = await api.testLlmConnection(editing)
      setTestMsg({ ok: r.ok, text: r.ok ? '连接成功' : String(r.error) })
    } catch (error) {
      setTestMsg({ ok: false, text: error instanceof Error ? error.message : String(error) })
    } finally { setBusy(false) }
  }

  const copyTestMessage = async () => {
    if (!testMsg) return
    await navigator.clipboard.writeText(testMsg.text)
    setTestMsgCopied(true)
  }

  const assignTask = async (task: AiTask, configId: number) => {
    setAssignment((prev) => ({ ...prev, [task]: configId }))
    await api.setLlmAssignment(task, configId)
  }

  return (
    <div className="flex h-screen flex-col bg-neutral-50">
      <header className="flex items-center border-b bg-white px-6 py-3">
        <button onClick={onBack} className="text-sm text-neutral-500 hover:underline">
          ← 返回
        </button>
        <h1 className="ml-4 text-lg font-medium">设置</h1>
      </header>
      <nav aria-label="设置分类" className="flex shrink-0 gap-2 border-b bg-white px-6 text-sm">{([
        ['models', '模型配置'], ['reference', '译文参考']
      ] as const).map(([id, title]) => <button type="button" key={id} aria-pressed={mode === id} onClick={() => setMode(id)} className={`border-b-2 px-3 py-3 ${mode === id ? 'border-blue-600 text-blue-700' : 'border-transparent text-neutral-600'}`}>{title}</button>)}</nav>

      {mode === 'reference' && <div className="flex-1 overflow-auto p-6"><ReferenceSettings /></div>}

      <div className={mode === 'models' ? 'flex-1 overflow-auto p-6' : 'hidden'}>
        {/* 配置列表 */}
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-medium">我的模型配置</h2>
          <button
            onClick={() => startEdit()}
            className="rounded border px-3 py-1 text-sm hover:bg-neutral-50"
          >
            + 新建配置
          </button>
        </div>

        <div className="mb-6 rounded bg-white shadow">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-xs text-neutral-500">
              <tr>
                <th className="p-3">配置名</th>
                <th className="p-3">协议</th>
                <th className="p-3">模型</th>
                <th className="p-3 w-20">操作</th>
              </tr>
            </thead>
            <tbody>
              {configs.length === 0 && (
                <tr className="border-b text-neutral-400">
                  <td className="p-3" colSpan={4}>
                    暂无配置，点击"新建配置"添加模型服务。
                  </td>
                </tr>
              )}
              {configs.map((c) => (
                <tr key={c.id} className="border-b last:border-0">
                  <td className="p-3">
                    {c.isDefault && <span className="mr-1 text-yellow-500">★</span>}
                    {c.name}
                  </td>
                  <td className="p-3 text-neutral-500">{PROTOCOLS[c.protocol].label}</td>
                  <td className="p-3 text-neutral-500">{c.model}</td>
                  <td className="p-3">
                    <button onClick={() => startEdit(c)} className="text-blue-600 hover:underline">
                      编辑
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 用途分配 */}
        {configs.length > 0 && (
          <div className="mb-6 rounded bg-white p-4 shadow">
            <h3 className="mb-3 font-medium">用途分配（哪个任务用哪个模型）</h3>
            <div className="space-y-2 text-sm">
              {TASKS.map((t) => (
                <div key={t} className="flex items-center gap-3">
                  <span className="w-32 text-neutral-600">{TASK_LABELS[t]}</span>
                  <select
                    value={assignment[t] ?? configs[0]?.id ?? 0}
                    onChange={(e) => assignTask(t, Number(e.target.value))}
                    className="rounded border px-2 py-1"
                  >
                    {configs.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-neutral-400">
              建议：整段/难句用强模型，难词用便宜模型，省钱且效果好。
            </p>
          </div>
        )}

        {/* 编辑/新建表单 */}
        {editing && (
          <div className="rounded bg-white p-4 shadow">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-medium">{editing.id ? '编辑配置' : '新建配置'}</h3>
              <button onClick={() => setEditing(null)} className="text-sm text-neutral-400 hover:text-neutral-600">
                ✕ 关闭
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <label className="flex flex-col gap-1">
                配置名
                <input
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  className="rounded border px-2 py-1"
                  placeholder="整段翻译-DeepSeek"
                />
              </label>
              <label className="flex flex-col gap-1">
                协议
                <select
                  value={editing.protocol}
                  onChange={(e) => {
                    const protocol = e.target.value as LlmConfig['protocol']
                    setTestMsg(null)
                    setTestMsgCopied(false)
                    setEditing({ ...editing, protocol })
                  }}
                  className="rounded border px-2 py-1"
                >
                  <option value="openai_chat">OpenAI Chat Completions</option>
                  <option value="openai_responses">OpenAI Responses</option>
                  <option value="anthropic">Anthropic Messages</option>
                </select>
              </label>
              <label className="col-span-2 flex flex-col gap-1">
                Base URL
                <input
                  value={editing.baseUrl}
                  onChange={(e) => setEditing({ ...editing, baseUrl: e.target.value })}
                  className="rounded border px-2 py-1 font-mono text-xs"
                />
                <span className="text-xs text-neutral-400">
                  填写服务商 Base URL，工作台会自动追加 {PROTOCOLS[editing.protocol].endpoint}
                </span>
              </label>
              <label className="flex flex-col gap-1">
                API Key{editing.id && '（留空保留原值）'}
                <input
                  type="password"
                  value={editing.apiKey}
                  onChange={(e) => setEditing({ ...editing, apiKey: e.target.value })}
                  className="rounded border px-2 py-1 font-mono text-xs"
                />
              </label>
              <label className="flex flex-col gap-1">
                模型名
                <input
                  value={editing.model}
                  onChange={(e) => setEditing({ ...editing, model: e.target.value })}
                  className="rounded border px-2 py-1 font-mono text-xs"
                />
              </label>
              <label className="flex flex-col gap-1">
                温度
                <input
                  type="number"
                  step="0.1"
                  value={editing.temperature}
                  onChange={(e) => setEditing({ ...editing, temperature: Number(e.target.value) })}
                  className="rounded border px-2 py-1"
                />
              </label>
              <label className="flex flex-col gap-1">
                最大 token
                <input
                  type="number"
                  value={editing.maxTokens}
                  onChange={(e) => setEditing({ ...editing, maxTokens: Number(e.target.value) })}
                  className="rounded border px-2 py-1"
                />
              </label>
              <label className="col-span-2 flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={editing.isDefault}
                  onChange={(e) => setEditing({ ...editing, isDefault: e.target.checked })}
                />
                设为默认配置
              </label>
            </div>

            {testMsg && (
              <div
                role="alert"
                className={`mt-3 flex items-start gap-3 rounded p-2 text-sm ${testMsg.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}
              >
                <div className="selectable min-w-0 flex-1 whitespace-pre-wrap break-words">
                  {testMsg.text}
                </div>
                {!testMsg.ok && (
                  <button
                    type="button"
                    onClick={copyTestMessage}
                    className="shrink-0 rounded border border-red-200 bg-white px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                  >
                    {testMsgCopied ? '已复制' : '复制错误'}
                  </button>
                )}
              </div>
            )}

            <div className="mt-4 flex gap-2">
              <button
                onClick={test}
                disabled={busy || !editing.model}
                className="rounded border px-3 py-1 text-sm hover:bg-neutral-50 disabled:opacity-40"
              >
                {busy ? '测试中...' : '测试连接'}
              </button>
              <button
                onClick={save}
                disabled={busy || !editing.name || !editing.model}
                className="rounded bg-para-doing px-3 py-1 text-sm text-white hover:bg-blue-600 disabled:opacity-40"
              >
                {busy ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
