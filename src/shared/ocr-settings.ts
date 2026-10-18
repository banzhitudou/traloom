export interface OcrSettings { language: 'eng' | 'jpn'; direction: 'horizontal' | 'vertical' }
export const DEFAULT_OCR: OcrSettings = { language: 'eng', direction: 'horizontal' }
export function validateOcrSettings(value: OcrSettings): OcrSettings {
  if (!value || !['eng', 'jpn'].includes(value.language) || !['horizontal', 'vertical'].includes(value.direction) || (value.language === 'eng' && value.direction !== 'horizontal')) throw new Error('无效的识别语言或排版方向。')
  return { language: value.language, direction: value.direction }
}
export function readOcrSettings(meta: Record<string, string>): OcrSettings {
  return { language: meta.ocr_language === 'jpn' ? 'jpn' : 'eng', direction: meta.ocr_language === 'jpn' && meta.ocr_direction === 'vertical' ? 'vertical' : 'horizontal' }
}
export function ocrModel(settings: OcrSettings): string { return settings.language === 'jpn' && settings.direction === 'vertical' ? 'jpn_vert' : settings.language }
export function joinOcrLines(lines: string[], settings: OcrSettings): string {
  const text = lines.map(line => line.trim()).filter(Boolean).join(settings.language === 'jpn' ? '' : '\n')
  // Tesseract's vertical model separates Japanese glyph groups with artificial spaces.
  return settings.language === 'jpn' ? text.replace(/([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー、。！？「」『』（）])[ \t]+(?=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー、。！？「」『』（）])/gu, '$1') : text
}
export function orderOcrBlocks<T extends { box: { left: number; top: number; width: number; height: number } }>(blocks: T[], settings: OcrSettings): T[] {
  return settings.direction === 'vertical' ? [...blocks].sort((a, b) => b.box.left - a.box.left || a.box.top - b.box.top) : blocks
}
