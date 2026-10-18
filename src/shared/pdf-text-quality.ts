import type { OcrSettings } from './ocr-settings'

/** Broken ToUnicode maps can return printable characters as well as private glyph codes. */
export function hasBrokenPdfText(text: string, settings: OcrSettings): boolean {
  if (/[\p{Co}\uFFFD\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(text)) return true
  // Japanese PDFs may contain Latin units and Greek mathematical symbols, but these
  // unrelated scripts are a strong signal of a damaged font map in Japanese mode.
  return settings.language === 'jpn' && /[\p{Script=Armenian}\p{Script=Hebrew}\p{Script=Arabic}\p{Script=Georgian}\p{Script=Coptic}\p{Script=Javanese}]/u.test(text)
}
