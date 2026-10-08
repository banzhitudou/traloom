import { dirname, isAbsolute, relative, resolve, sep, win32 } from 'path'

export const projectFileKeys = [
  'pdf_path', 'json_path', 'model_json_path', 'primary_markdown_path',
  'draft_md_path', 'glossary_md_path', 'style_guide_md_path',
  'name_dict_csv_path', 'place_dict_xlsx_path'
] as const

export const projectPathKeys = [...projectFileKeys, 'mineru_root_path'] as const

export function resolveProjectPath(projectPath: string, storedPath: string): string {
  if (!storedPath) return ''
  if (isAbsolute(storedPath) || win32.isAbsolute(storedPath)) return storedPath
  return resolve(dirname(projectPath), ...storedPath.replace(/\\/g, '/').split('/'))
}

export function storeProjectPath(projectPath: string, filePath: string): string {
  if (!filePath) return ''
  const absolute = resolveProjectPath(projectPath, filePath)
  const local = relative(dirname(projectPath), absolute)
  const foreignWindowsPath = process.platform !== 'win32' && (/^[A-Za-z]:[\\/]/.test(absolute) || absolute.startsWith('\\\\'))
  if (isAbsolute(local) || local === '..' || local.startsWith(`..${sep}`) || foreignWindowsPath) return absolute
  return local.split(sep).join('/') || '.'
}
