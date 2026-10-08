export interface NormalizedBbox {
  left: number
  top: number
  width: number
  height: number
}

const clamp = (value: number): number => Math.min(1, Math.max(0, value))

function normalizeBox(values: unknown[]): NormalizedBbox | null {
  if (values.length !== 4) return null
  const coords = values.map(Number)
  if (coords.some((value) => !Number.isFinite(value))) return null
  const scale = Math.max(...coords.map(Math.abs)) > 1.5 ? 1000 : 1
  const [rawX1, rawY1, rawX2, rawY2] = coords.map((value) => value / scale)
  const x1 = clamp(Math.min(rawX1, rawX2))
  const y1 = clamp(Math.min(rawY1, rawY2))
  const x2 = clamp(Math.max(rawX1, rawX2))
  const y2 = clamp(Math.max(rawY1, rawY2))

  if (x2 <= x1 || y2 <= y1) return null
  return { left: x1, top: y1, width: x2 - x1, height: y2 - y1 }
}

/**
 * 一个翻译段可以对应一个坐标框，也可以在合并后对应多个坐标框。
 */
export function parseNormalizedBboxes(bboxJson: string): NormalizedBbox[] {
  try {
    const value = JSON.parse(bboxJson) as unknown
    if (!Array.isArray(value)) return []
    if (value.length === 4 && value.every((item) => !Array.isArray(item))) {
      const box = normalizeBox(value)
      return box ? [box] : []
    }
    return value
      .filter((item): item is unknown[] => Array.isArray(item))
      .map(normalizeBox)
      .filter((box): box is NormalizedBbox => box !== null)
  } catch {
    return []
  }
}

/**
 * 兼容 MinerU content_list（0-1000）和 model.json（0-1）两种坐标。
 */
export function parseNormalizedBbox(bboxJson: string): NormalizedBbox | null {
  const boxes = parseNormalizedBboxes(bboxJson)
  if (boxes.length === 0) return null
  const left = Math.min(...boxes.map((box) => box.left))
  const top = Math.min(...boxes.map((box) => box.top))
  const right = Math.max(...boxes.map((box) => box.left + box.width))
  const bottom = Math.max(...boxes.map((box) => box.top + box.height))
  return { left, top, width: right - left, height: bottom - top }
}

/**
 * 单框沿用扁平数组，多框保留嵌套数组，兼容项目库里的既有格式。
 */
export function serializeNormalizedBboxes(boxes: NormalizedBbox[]): string {
  const coordinates = boxes.map((box) => [
    box.left,
    box.top,
    box.left + box.width,
    box.top + box.height
  ])
  return JSON.stringify(coordinates.length === 1 ? coordinates[0] : coordinates)
}
