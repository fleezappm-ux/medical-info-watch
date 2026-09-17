import { describe, expect, it } from 'vitest'
import { filterByCategoryAndSource, uniqueSourceNames, countByCategory, groupByCategory } from './filters'
import type { InformationItem } from '../types'

function makeItem(overrides: Partial<InformationItem> = {}): InformationItem {
  return {
    id: 'test',
    category: 'pharmacy',
    itemType: '供給',
    title: 'test',
    summary: 'test',
    aiImportance: 'critical',
    confirmedImportance: null,
    importanceConfirmedBy: null,
    importanceConfirmedAt: null,
    reviewStatus: 'unreviewed',
    publishedAt: '2026-09-11',
    fetchedAt: '2026-09-11T08:00:00+09:00',
    sourceName: 'test-source',
    documentNumber: null,
    pharmacyImpact: 'test',
    requiredAction: null,
    actionDeadline: null,
    homeDisplayConfirmed: false,
    homeDisplayConfirmedBy: null,
    homeDisplayConfirmedAt: null,
    links: [],
    ...overrides,
  }
}

describe('filterByCategoryAndSource', () => {
  const items = [
    makeItem({ id: 'a', category: 'pharmacy', sourceName: 'PMDA' }),
    makeItem({ id: 'b', category: 'clinical', sourceName: 'Minds' }),
    makeItem({ id: 'c', category: 'pharmacy', sourceName: 'Minds' }),
  ]

  it('両方allなら絞り込まない', () => {
    expect(filterByCategoryAndSource(items, 'all', 'all')).toHaveLength(3)
  })

  it('カテゴリだけ絞り込める', () => {
    const result = filterByCategoryAndSource(items, 'pharmacy', 'all')
    expect(result.map((i) => i.id)).toEqual(['a', 'c'])
  })

  it('情報源だけ絞り込める', () => {
    const result = filterByCategoryAndSource(items, 'all', 'Minds')
    expect(result.map((i) => i.id)).toEqual(['b', 'c'])
  })

  it('カテゴリと情報源をAND条件で絞り込める', () => {
    const result = filterByCategoryAndSource(items, 'pharmacy', 'Minds')
    expect(result.map((i) => i.id)).toEqual(['c'])
  })
})

describe('uniqueSourceNames', () => {
  it('重複を除き初出順で返す', () => {
    const items = [
      makeItem({ sourceName: 'B' }),
      makeItem({ sourceName: 'A' }),
      makeItem({ sourceName: 'B' }),
      makeItem({ sourceName: 'C' }),
    ]
    expect(uniqueSourceNames(items)).toEqual(['B', 'A', 'C'])
  })

  it('空配列なら空配列を返す', () => {
    expect(uniqueSourceNames([])).toEqual([])
  })
})

describe('countByCategory', () => {
  it('カテゴリごとに件数を数える（0件のカテゴリも0で含む）', () => {
    const items = [
      makeItem({ category: 'pharmacy' }),
      makeItem({ category: 'pharmacy' }),
      makeItem({ category: 'system' }),
    ]
    expect(countByCategory(items)).toEqual({ pharmacy: 2, clinic: 0, clinical: 0, system: 1 })
  })
})

describe('groupByCategory', () => {
  it('categoryOrder順にグループ化し、0件のカテゴリは含めない', () => {
    const items = [
      makeItem({ id: 'a', category: 'system' }),
      makeItem({ id: 'b', category: 'pharmacy' }),
      makeItem({ id: 'c', category: 'pharmacy' }),
    ]
    const groups = groupByCategory(items)
    expect(groups.map((g) => g.category)).toEqual(['pharmacy', 'system'])
    expect(groups[0].items.map((i) => i.id)).toEqual(['b', 'c'])
    expect(groups[1].items.map((i) => i.id)).toEqual(['a'])
  })

  it('全カテゴリが空なら空配列を返す', () => {
    expect(groupByCategory([])).toEqual([])
  })
})
