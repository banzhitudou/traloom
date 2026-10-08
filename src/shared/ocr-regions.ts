import type { NormalizedBbox } from './bbox'

export function mapOcrRegion(box: NormalizedBbox, crop: NormalizedBbox, rotation: number): NormalizedBbox {
  const points = [[box.left, box.top], [box.left + box.width, box.top + box.height]].map(([x, y]) =>
    rotation === 90 ? [y, 1 - x] : rotation === 180 ? [1 - x, 1 - y] : rotation === 270 ? [1 - y, x] : [x, y])
  return {
    left: crop.left + Math.min(points[0][0], points[1][0]) * crop.width,
    top: crop.top + Math.min(points[0][1], points[1][1]) * crop.height,
    width: Math.abs(points[0][0] - points[1][0]) * crop.width,
    height: Math.abs(points[0][1] - points[1][1]) * crop.height
  }
}

export function overlapsExisting(box: NormalizedBbox, existing: NormalizedBbox[]): boolean {
  return existing.some(other => {
    const width = Math.max(0, Math.min(box.left + box.width, other.left + other.width) - Math.max(box.left, other.left))
    const height = Math.max(0, Math.min(box.top + box.height, other.top + other.height) - Math.max(box.top, other.top))
    return width * height / Math.min(box.width * box.height, other.width * other.height) > 0.4
  })
}
