/**
 * 双语对照稿解析器。
 * 解析双语 Markdown → (en, zh) 配对列表。
 *
 * 实测格式规律：
 *   - 英文段（含 # 标题）后跟中文段，交替排列
 *   - 图片行 ![](images/...) 是分隔锚点，跳过
 *   - 空行分隔段落
 *   - 判定语种：是否含中文字符
 *
 * 边界情况：
 *   - 纯英文行（如人名、版权）后面跟"几乎相同"的英文行（非中文）→ 视为英文，等下个中文行
 *   - 连续两个英文行（无中间中文）→ 拼接视为一个英文段（md 漏译或多行英文）
 *   - 连续两个中文行 → 第二个并入第一个的译文
 */
import { readFileSync } from 'fs'

export interface DraftPair {
  en: string
  zh: string
  /** 是否标题（英文以 # 开头） */
  isTitle: boolean
}

const CN_RE = /[\u4e00-\u9fa5]/
const IMG_RE = /^!\[.*\]\(.*\)$/
const HEADING_RE = /^#+\s*/

/** 去除行首 # 标记和首尾空白 */
function stripHeading(s: string): string {
  return s.replace(HEADING_RE, '').trim()
}

/**
 * 解析双语对照 md，产出 (en, zh) 配对。
 * 策略：顺序扫描，遇英文行暂存，遇中文行则与暂存的英文配对产出。
 */
export function parseDraftMd(mdPath: string): DraftPair[] {
  const raw = readFileSync(mdPath, 'utf-8')
  const lines = raw.split(/\r?\n/)

  const result: DraftPair[] = []
  let pendingEn = ''       // 暂存的英文段
  let pendingIsTitle = false

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue              // 空行跳过
    if (IMG_RE.test(line)) continue  // 图片行跳过

    const isHeading = /^#+\s/.test(line)
    const text = stripHeading(line)

    if (CN_RE.test(line)) {
      // 中文行：与暂存英文配对
      if (pendingEn) {
        result.push({ en: pendingEn, zh: text, isTitle: pendingIsTitle })
        pendingEn = ''
        pendingIsTitle = false
      } else {
        // 无对应英文的中文行（孤立译文）：并入上一条的译文
        const last = result[result.length - 1]
        if (last) {
          last.zh = last.zh ? `${last.zh} ${text}` : text
        }
      }
    } else {
      // 英文行
      if (pendingEn) {
        // 已有暂存英文（连续英文）：拼接
        pendingEn = `${pendingEn} ${text}`.trim()
      } else {
        pendingEn = text
        pendingIsTitle = isHeading
      }
    }
  }

  // 收尾：末尾若有未配对的英文段，单独产出（zh 为空）
  if (pendingEn) {
    result.push({ en: pendingEn, zh: '', isTitle: pendingIsTitle })
  }

  return result
}
