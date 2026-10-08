import type { ReferenceSettings } from './ipc-api'

export function validateReferenceSettings(settings: ReferenceSettings): ReferenceSettings {
  if (!settings || !Number.isInteger(settings.count) || settings.count < 1 || settings.count > 5 || !Array.isArray(settings.profiles) || settings.profiles.length !== settings.count) throw new Error('参考数量须为 1–5，每条参考都须有对应方案。')
  const profiles = settings.profiles.map((profile, index) => {
    if (!profile || typeof profile.name !== 'string' || !profile.name.trim() || profile.name.trim().length > 60 || typeof profile.instructions !== 'string' || profile.instructions.length > 12000) throw new Error('请填写方案名称（最多 60 字），翻译要求最多 12000 字。')
    if (index === 0 && (profile.name !== '默认' || profile.instructions !== '')) throw new Error('默认方案名称为“默认”，翻译要求为空。')
    return { name: profile.name.trim(), instructions: profile.instructions.trim() }
  })
  if (new Set(profiles.map(profile => profile.name)).size !== profiles.length) throw new Error('方案名称不能重复。')
  return { count: settings.count, profiles }
}

export function migrateReferenceSettings(count: number, instructions: string): ReferenceSettings {
  const legacy = instructions.trim()
  const size = Math.min(5, Math.max(legacy ? 2 : 1, Number.isInteger(count) ? count : 1))
  return validateReferenceSettings({ count: size, profiles: Array.from({ length: size }, (_, index) => index === 0
    ? { name: '默认', instructions: '' }
    : { name: legacy && index === 1 ? '已有要求' : `方案 ${index + 1}`, instructions: legacy }) })
}
