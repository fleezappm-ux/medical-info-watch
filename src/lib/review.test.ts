import { describe, expect, it } from 'vitest'
import {
  canMarkReviewed,
  canConfirmImportance,
  canConfirmHomeDisplay,
  isConfirmedImportant,
  isSameLocalDay,
  needsHomeDisplayReview,
  changeStatusLabel,
} from './review'
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
    sourceName: 'test',
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

describe('canMarkReviewed', () => {
  it('unreviewed / reviewing は確認できる', () => {
    expect(canMarkReviewed('unreviewed')).toBe(true)
    expect(canMarkReviewed('reviewing')).toBe(true)
  })

  it('excluded / reviewed は確認操作の対象外', () => {
    expect(canMarkReviewed('excluded')).toBe(false)
    expect(canMarkReviewed('reviewed')).toBe(false)
  })
})

describe('canConfirmImportance / canConfirmHomeDisplay', () => {
  it('excluded な情報は重要度もHOME表示も確定できない', () => {
    const item = makeItem({ reviewStatus: 'excluded' })
    expect(canConfirmImportance(item)).toBe(false)
    expect(canConfirmHomeDisplay(item)).toBe(false)
  })

  it('重要度が未確定のうちはHOME表示を確定できない', () => {
    const item = makeItem({ confirmedImportance: null })
    expect(canConfirmHomeDisplay(item)).toBe(false)
  })

  it('重要度確定後はHOME表示を確定できる', () => {
    const item = makeItem({ confirmedImportance: 'critical' })
    expect(canConfirmHomeDisplay(item)).toBe(true)
  })
})

describe('isConfirmedImportant', () => {
  it('AI判定だけでは「確定済み重要情報」に含めない', () => {
    const item = makeItem({ aiImportance: 'critical', confirmedImportance: null })
    expect(isConfirmedImportant(item)).toBe(false)
  })

  it('人間が critical/caution に確定したものは含める', () => {
    expect(isConfirmedImportant(makeItem({ confirmedImportance: 'critical' }))).toBe(true)
    expect(isConfirmedImportant(makeItem({ confirmedImportance: 'caution' }))).toBe(true)
  })

  it('人間が info に確定したものは含めない', () => {
    expect(isConfirmedImportant(makeItem({ confirmedImportance: 'info' }))).toBe(false)
  })
})

describe('isSameLocalDay', () => {
  it('同じ日付なら true', () => {
    const reference = new Date('2026-09-11T23:00:00+09:00')
    expect(isSameLocalDay('2026-09-11T08:00:00+09:00', reference)).toBe(true)
  })

  it('別の日付なら false', () => {
    const reference = new Date('2026-09-11T00:30:00+09:00')
    expect(isSameLocalDay('2026-09-10T23:59:00+09:00', reference)).toBe(false)
  })

  it('不正な日付文字列は false', () => {
    expect(isSameLocalDay('not-a-date', new Date())).toBe(false)
  })
})

describe('needsHomeDisplayReview', () => {
  it('homeDisplayNeedsReviewがtrueのときだけtrue', () => {
    expect(needsHomeDisplayReview(makeItem({ homeDisplayNeedsReview: true }))).toBe(true)
    expect(needsHomeDisplayReview(makeItem({ homeDisplayNeedsReview: false }))).toBe(false)
    expect(needsHomeDisplayReview(makeItem({}))).toBe(false)
  })
})

describe('changeStatusLabel', () => {
  it('changeStatusに応じたラベルを返す', () => {
    expect(changeStatusLabel(makeItem({ changeStatus: 'new' }))).toBe('新規')
    expect(changeStatusLabel(makeItem({ changeStatus: 'updated' }))).toBe('内容更新あり')
    expect(changeStatusLabel(makeItem({ changeStatus: 'resolved' }))).toBe('解消・供給再開')
    expect(changeStatusLabel(makeItem({ changeStatus: 'unchanged' }))).toBeNull()
    expect(changeStatusLabel(makeItem({}))).toBeNull()
  })

  it('missingは連続回数の有無でラベルが変わる', () => {
    expect(changeStatusLabel(makeItem({ changeStatus: 'missing' }))).toBe('掲載未確認・要手動確認')
    expect(changeStatusLabel(makeItem({ changeStatus: 'missing', missingStreak: 1 }))).toBe('掲載未確認・要手動確認')
    expect(changeStatusLabel(makeItem({ changeStatus: 'missing', missingStreak: 3 }))).toBe(
      '掲載未確認・要手動確認（3回連続）',
    )
  })
})
