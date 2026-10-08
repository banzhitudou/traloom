export function newProjectFileName(pdfPath: string): string {
  const name = pdfPath.split(/[\\/]/).pop()?.replace(/\.pdf$/i, '') || '新建'
  const safe = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 80)
  return `${safe}-翻译工程.twproj`
}
