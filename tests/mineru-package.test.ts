import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { scanMineruPackage } from '../src/main/services/mineru-package'

describe('scanMineruPackage', () => {
  it('从嵌套输出目录识别 MinerU 主文件和所有 Markdown', () => {
    const root = mkdtempSync(join(tmpdir(), 'mineru-package-'))
    const output = join(root, 'book', 'auto')
    const images = join(output, 'images')
    mkdirSync(images, { recursive: true })
    writeFileSync(join(output, 'My_Book_content_list_v2.json'), JSON.stringify([[], [], []]))
    writeFileSync(join(output, 'My_Book_model.json'), JSON.stringify([[], [], []]))
    writeFileSync(join(output, 'My_Book_middle.json'), '{}')
    writeFileSync(join(output, 'My_Book.md'), '# My Book')
    writeFileSync(join(output, 'notes.md'), '# Notes')
    writeFileSync(join(output, 'My_Book.pdf'), '')
    writeFileSync(join(output, 'My_Book_layout.pdf'), '')
    writeFileSync(join(images, 'figure.jpg'), '')

    const preview = scanMineruPackage(root)

    expect(preview.bookTitle).toBe('My_Book')
    expect(preview.pageCount).toBe(3)
    expect(preview.pdfPath).toBe(join(output, 'My_Book.pdf'))
    expect(preview.primaryMarkdownPath).toBe(join(output, 'My_Book.md'))
    expect(preview.modelJsonPath).toBe(join(output, 'My_Book_model.json'))
    expect(preview.markdownFiles).toHaveLength(2)
    expect(preview.imageDirectory).toBe(images)
  })

  it('在缺少必要文件时返回可读的预检警告', () => {
    const root = mkdtempSync(join(tmpdir(), 'mineru-empty-'))
    const preview = scanMineruPackage(root)

    expect(preview.pdfPath).toBe('')
    expect(preview.jsonPath).toBe('')
    expect(preview.warnings).toContain('未找到原始 PDF')
    expect(preview.warnings).toContain('未找到 content_list_v2.json 或 content_list.json')
  })
})
