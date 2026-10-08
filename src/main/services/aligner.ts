/**
 * 译稿对齐算法（两段式）。
 * 来源：《技术方案文档》第 5 节，PRD 4.6 F-IMP-2。
 *
 * 第一遍：相似度滑动窗口匹配（免费、即时），覆盖 ~95%
 * 第二遍：AI 判定待核对段（S5 接入 LLM，本文件只留接口）
 *
 * 核心难点：md 的"段"和 json 的"块"粒度不一致。
 *   - OCR 可能把一段切成多块（一对多）
 *   - md 可能合并多句为一段（多对一）
 *   - 滑动窗口 + 合并匹配 处理这两种情况
 */
import type { AlignResult } from '@shared/types'

/** 归一化：去标点空白、转小写，用于相似度比较 */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')   // 标点转空格（保留字母数字）
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * 文本相似度：token 级 Jaccard。
 * 按词拆分后求交集/并集。对词序不敏感，适合中英对齐。
 */
function jaccard(a: string, b: string): number {
  const ta = new Set(a.split(' ').filter(Boolean))
  const tb = new Set(b.split(' ').filter(Boolean))
  if (ta.size === 0 && tb.size === 0) return 1
  if (ta.size === 0 || tb.size === 0) return 0
  let inter = 0
  for (const t of ta) if (tb.has(t)) inter++
  return inter / (ta.size + tb.size - inter)
}

/**
 * 包含度：b 的词有多少比例出现在 a 中。
 * 用于判断 "draft 是否包含了 json 块的内容"（draft 是多 json 块拼接时）。
 */
function containment(a: string, b: string): number {
  const ta = new Set(a.split(' ').filter(Boolean))
  const tb = new Set(b.split(' ').filter(Boolean))
  if (tb.size === 0) return 1
  let inCount = 0
  for (const t of tb) if (ta.has(t)) inCount++
  return inCount / tb.size
}

/** 段落数据（json 侧） */
export interface JsonBlock {
  id: number
  en: string
}

/** 草稿配对（md 侧，来自 draft-parser） */
export interface DraftPairInput {
  en: string
  zh: string
  isTitle?: boolean
}

/** 相似度阈值：≥ 此值视为对齐成功 */
const THRESHOLD = 0.5

/**
 * 第一遍：相似度滑动窗口匹配。
 *
 * 算法：
 *   - 两个游标 i（draft）、j（json）从 0 开始
 *   - 对每个 draft[i]，在 json[j..j+WINDOW] 内找最高相似度的块
 *   - 命中（≥阈值）：记录对齐，json 游标推进到命中点+1
 *   - 未命中：尝试"合并连续 draft 段"与当前 json 块匹配（处理多对一）
 *   - 仍未命中：标记 pending
 */
export function similarityMatch(
  drafts: DraftPairInput[],
  jsonBlocks: JsonBlock[],
  threshold = THRESHOLD
): AlignResult[] {
  const results: AlignResult[] = []
  const normJson = jsonBlocks.map((b) => ({ id: b.id, norm: normalize(b.en), raw: b.en }))

  let j = 0
  let i = 0
  const WINDOW = 3

  while (i < drafts.length) {
    const draftEn = drafts[i].en
    const draftNorm = normalize(draftEn)

    // 1. 在窗口内找最佳单块匹配
    let bestK = -1
    let bestScore = 0
    for (let k = j; k < Math.min(j + WINDOW, normJson.length); k++) {
      const score = jaccard(draftNorm, normJson[k].norm)
      if (score > bestScore) {
        bestScore = score
        bestK = k
      }
    }

    if (bestScore >= threshold && bestK >= 0) {
      // 命中
      results.push({
        jsonId: normJson[bestK].id,
        draftIdx: i,
        similarity: bestScore,
        status: 'aligned',
        enMd: draftEn,
        enJson: normJson[bestK].raw,
        zh: drafts[i].zh
      })
      j = bestK + 1
      i++
      continue
    }

    // 2. 拆分匹配：draft[i] 是否包含了连续多个 json 块的内容
    //    （draft 粒度比 json 粗——draft 把多个 json 块合成了一段）
    //    在窗口范围内找"起点"k0，从 k0 开始连续累计 containment 达标的 json 块。
    if (j < normJson.length) {
      const CONTAIN_THRESHOLD = 0.7
      let bestK0 = -1
      let bestConsumed = 0

      for (let k0 = j; k0 < Math.min(j + WINDOW, normJson.length); k0++) {
        // 从 k0 开始连续累计
        let consumed = 0
        for (let k = k0; k < normJson.length; k++) {
          const c = containment(draftNorm, normJson[k].norm)
          if (c >= CONTAIN_THRESHOLD) {
            consumed++
          } else {
            break
          }
        }
        // 取累计块数最多的起点
        if (consumed > bestConsumed) {
          bestConsumed = consumed
          bestK0 = k0
        }
      }

      if (bestK0 >= 0 && bestConsumed >= 1) {
        // draft[i] 映射到 json[bestK0..bestK0+bestConsumed-1]
        let avgContain = 0
        for (let kk = bestK0; kk < bestK0 + bestConsumed; kk++) {
          avgContain += containment(draftNorm, normJson[kk].norm)
        }
        avgContain /= bestConsumed
        const zh = drafts[i].zh
        for (let kk = bestK0; kk < bestK0 + bestConsumed; kk++) {
          results.push({
            jsonId: normJson[kk].id,
            draftIdx: i,
            similarity: avgContain,
            status: 'aligned',
            enMd: kk === bestK0 ? draftEn : '',
            enJson: normJson[kk].raw,
            zh: kk === bestK0 ? zh : ''
          })
        }
        j = bestK0 + bestConsumed
        i++
        continue
      }
    }

    // 3. 合并匹配：多个 draft 段 = 1 个 json 块（贪婪合并）
    if (j < normJson.length) {
      let mergedNorm = draftNorm
      let bestMergeCount = 0      // 0 = 未达到阈值
      let bestMergeScore = 0

      for (let m = i + 1; m < Math.min(i + WINDOW, drafts.length); m++) {
        mergedNorm = `${mergedNorm} ${normalize(drafts[m].en)}`.trim()
        const score = jaccard(mergedNorm, normJson[j].norm)
        if (score >= threshold) {
          const count = m - i + 1
          // 贪婪：取分数最高的合并数（并列时取合并更多段的）
          if (score > bestMergeScore || (score === bestMergeScore && count > bestMergeCount)) {
            bestMergeScore = score
            bestMergeCount = count
          }
        }
      }

      if (bestMergeCount > 0) {
        // 把 bestMergeCount 个 draft 段都映射到 json[j]
        for (let mm = i; mm < i + bestMergeCount; mm++) {
          results.push({
            jsonId: normJson[j].id,
            draftIdx: mm,
            similarity: bestMergeScore,
            status: 'aligned',
            enMd: drafts[mm].en,
            enJson: normJson[j].raw,
            zh: drafts[mm].zh
          })
        }
        j++
        i += bestMergeCount
        continue
      }
    }

    // 4. 重新同步：窗口内没对上，可能在更大范围内有高相似度匹配
    //    （前面的合并/跳过累积了偏移，导致 j 落后或超前——图注章节会让
    //    json 比 draft 多出几十块）。在大范围内全局搜，若找到极高分，跳过去对齐。
    //    SYNC_RANGE 取较大值以覆盖累积偏移；用 0.85 高阈值避免误匹配。
    const SYNC_RANGE = 60
    let syncK = -1
    let syncScore = 0
    const syncStart = Math.max(0, j - SYNC_RANGE)
    const syncEnd = Math.min(normJson.length, j + SYNC_RANGE)
    for (let k = syncStart; k < syncEnd; k++) {
      const score = jaccard(draftNorm, normJson[k].norm)
      if (score > syncScore) {
        syncScore = score
        syncK = k
      }
    }
    if (syncScore >= 0.85 && syncK >= 0) {
      results.push({
        jsonId: normJson[syncK].id,
        draftIdx: i,
        similarity: syncScore,
        status: 'aligned',
        enMd: draftEn,
        enJson: normJson[syncK].raw,
        zh: drafts[i].zh
      })
      j = syncK + 1
      i++
      continue
    }

    // 5. 未命中。
    //    区分两种情况：
    //    a) draft[i] 是极短段（≤3 词，疑似图注词/标题词）：与长 json 句本就无词汇重叠，
    //       相似度对齐无效——直接记 pending，推进两边（这类靠人工或跳过）。
    //    b) draft[i] 是正常段但没对上 json[j]：尝试推进 j 重试（跳过 json 孤儿块）。
    const draftWordCount = draftNorm.split(' ').filter(Boolean).length

    if (draftWordCount <= 3) {
      // 极短段：图注词等，直接 pending
      results.push({
        jsonId: j < normJson.length ? normJson[j].id : -1,
        draftIdx: i,
        similarity: bestScore,
        status: 'pending',
        enMd: draftEn,
        enJson: j < normJson.length ? normJson[j].raw : '',
        zh: drafts[i].zh
      })
      i++
      if (j < normJson.length) j++
      continue
    }

    // 正常段：尝试推进 j 重试（跳过 json 孤儿块，最多 WINDOW 次）
    let resolved = false
    for (let retry = 1; retry <= WINDOW && j + retry < normJson.length; retry++) {
      const jj = j + retry
      const retryScore = jaccard(draftNorm, normJson[jj].norm)
      if (retryScore >= threshold) {
        results.push({
          jsonId: normJson[jj].id,
          draftIdx: i,
          similarity: retryScore,
          status: 'aligned',
          enMd: draftEn,
          enJson: normJson[jj].raw,
          zh: drafts[i].zh
        })
        j = jj + 1
        i++
        resolved = true
        break
      }
    }

    if (resolved) continue

    // 仍失败：记 pending，推进两边
    results.push({
      jsonId: j < normJson.length ? normJson[j].id : -1,
      draftIdx: i,
      similarity: bestScore,
      status: 'pending',
      enMd: draftEn,
      enJson: j < normJson.length ? normJson[j].raw : '',
      zh: drafts[i].zh
    })
    i++
    if (j < normJson.length) j++
  }

  return results
}

/**
 * 统计对齐覆盖率。
 */
export function alignStats(results: AlignResult[]): {
  total: number
  aligned: number
  pending: number
  coverage: number
} {
  const aligned = results.filter((r) => r.status === 'aligned').length
  const pending = results.filter((r) => r.status === 'pending').length
  const total = results.length
  return {
    total,
    aligned,
    pending,
    coverage: total > 0 ? Math.round((aligned / total) * 1000) / 10 : 0
  }
}
