import type { InformationItem, WatchCategory } from '../types'

export type CategoryFilter = WatchCategory | 'all'
export type SourceFilter = string | 'all'

/** カテゴリの表示順（薬局業務→クリニック業務→治療・臨床→医療システム、固定）。 */
export const categoryOrder: WatchCategory[] = ['pharmacy', 'clinic', 'clinical', 'system']

/**
 * カテゴリ・情報源の2つの絞り込みを同時に適用する（AND条件）。
 * どちらも'all'であれば絞り込みなし（元の配列と同じ内容を返す）。
 */
export function filterByCategoryAndSource(
  items: InformationItem[],
  category: CategoryFilter,
  source: SourceFilter,
): InformationItem[] {
  return items.filter(
    (item) => (category === 'all' || item.category === category) && (source === 'all' || item.sourceName === source),
  )
}

/**
 * 一覧に含まれる情報源名を、重複なく初出順で取り出す（情報源フィルタのプルダウン用）。
 * 件数の多い順ではなく初出順にしているのは、取得のたびに件数で並び順が変わって
 * プルダウンの位置が毎回動く、という使いにくさを避けるため。
 */
export function uniqueSourceNames(items: InformationItem[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  items.forEach((item) => {
    if (!seen.has(item.sourceName)) {
      seen.add(item.sourceName)
      result.push(item.sourceName)
    }
  })
  return result
}

/** カテゴリごとの件数（カテゴリ絞り込みチップの横に出す数字用）。 */
export function countByCategory(items: InformationItem[]): Record<WatchCategory, number> {
  const counts: Record<WatchCategory, number> = { pharmacy: 0, clinic: 0, clinical: 0, system: 0 }
  items.forEach((item) => {
    counts[item.category] += 1
  })
  return counts
}

export interface CategoryGroup {
  category: WatchCategory
  items: InformationItem[]
}

/**
 * 「すべてのカテゴリ」を見ているときに、項目（カテゴリ）別にグループ化する。
 * グループの並び順はcategoryOrder固定。1件も無いカテゴリのグループは作らない。
 * グループ内の並び替え（新しい順等）は呼び出し側（ItemList）の責務とし、
 * ここでは元の配列の並び順をそのまま保つ（既に並び替え済みの配列を渡してもらう前提）。
 */
export function groupByCategory(items: InformationItem[]): CategoryGroup[] {
  return categoryOrder
    .map((category) => ({ category, items: items.filter((item) => item.category === category) }))
    .filter((group) => group.items.length > 0)
}
