import { closeSync, openSync } from 'fs'
import { dirname, join } from 'path'
import { newProjectFileName } from '../../shared/project-file-name'

export function reserveNewProjectFile(pdfPath: string): string {
  const name = newProjectFileName(pdfPath).replace(/\.twproj$/, '')
  for (let index = 1; index <= 10000; index++) {
    const file = join(dirname(pdfPath), `${name}${index === 1 ? '' : `-${index}`}.twproj`)
    try {
      const fd = openSync(file, 'wx')
      closeSync(fd)
      return file
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue
      throw new Error('无法在 PDF 所在文件夹建立工程。请把 PDF 放到有写入权限的本地文件夹后重试。', { cause: error })
    }
  }
  throw new Error('同名工程过多，请更换 PDF 文件名后重试。')
}
