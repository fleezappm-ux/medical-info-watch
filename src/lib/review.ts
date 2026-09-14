import type { InformationItem, ReviewStatus } from '../types'

/** 「対象外」は確認済みへ戻せない。確認操作ができるのは未確認・確認中のみ。 */
export function canMarkReviewed(status: ReviewStatus): boolean {
  return status === 'unreviewed' || status === 'reviewing'
}

/**
 * 重要度確定は「対象外」以外であればいつでも可能（内容確認の前後を問わない）。
 * ただしAI判定からの自動コピーは禁止。必ず人間が値を選ぶ。
 */
export function canConfirmImportance(item: InformationItem): boolean {
  return item.reviewStatus !== 'excluded'
}

/**
 * HOME表示確定は、人間が重要度を確定した情報にのみ許可する。
 * AI候補のままの情報をHOMEへ出さないための制約。
 */
export function canConfirmHomeDisplay(item: InformationItem): boolean {
  return item.reviewStatus !== 'excluded' && item.confirmedImportance !== null
}

/**
 * 「確定済み重要情報」＝人間が重要度を確定し、かつ info（参考）ではないもの。
 * AIが重要・注意と判定しただけの未確定情報は含めない。
 */
export function isConfirmedImportant(item: InformationItem): boolean {
  return item.confirmedImportance !== null && item.confirmedImportance !== 'info'
}

export function hasFetchError(item: InformationItem): boolean {
  return Boolean(item.fetchError)
}

export function needsReview(item: InformationItem): boolean {
  return item.reviewStatus === 'unreviewed' || item.reviewStatus === 'reviewing'
}

/**
 * 「変更あり」タブ用：今回の取得で実際に内容変化・供給再開・掲載未確認が検知されたもの。
 * 'new'（初出）はここには含めない（変更ではなく初登場のため）。
 * これはinformation_item_historyに履歴が記録される条件（isFirstTimeEvent）と一致する。
 */
export function hasContentChanged(item: InformationItem): boolean {
  return item.changeStatus === 'updated' || item.changeStatus === 'resolved' || item.changeStatus === 'missing'
}

/** 内容変更・供給再開などが検知され、HOME表示中でも再確認が必要な状態かどうか。 */
export function needsHomeDisplayReview(item: InformationItem): boolean {
  return Boolean(item.homeDisplayNeedsReview)
}

/** 一覧・詳細画面でバッジ表示するための、変更区分の日本語ラベル。無ければ何も表示しない。 */
export function changeStatusLabel(item: InformationItem): string | null {
  switch (item.changeStatus) {
    case 'new':
      return '新規'
    case 'updated':
      return '内容更新あり'
    case 'resolved':
      return '解消・供給再開'
    case 'missing':
      return item.missingStreak && item.missingStreak > 1
        ? `掲載未確認・要手動確認（${item.missingStreak}回連続）`
        : '掲載未確認・要手動確認'
    default:
      return null
  }
}

const JST_TIME_ZONE = 'Asia/Tokyo'
const jstDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: JST_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

function toJstDateKey(date: Date): string {
  return jstDateFormatter.format(date)
}

/**
 * ISO文字列がreference（省略時は現在時刻）と同じ「日本時間の日付」かどうか。
 * ブラウザ・実行環境のシステムタイムゾーンに依存させず、常にJST基準で判定する
 * （利用者は日本国内の薬局・クリニックを想定しているため）。
 */
export function isSameLocalDay(isoString: string, reference: Date = new Date()): boolean {
  const target = new Date(isoString)
  if (Number.isNaN(target.getTime())) return false
  return toJstDateKey(target) === toJstDateKey(reference)
}
