// 医療情報ウォッチ 初期版・最小データ構造
// 将来 information_items フルセットへ拡張することを前提に、
// フィールド名は本番スキーマと矛盾しない形にしている。

export type WatchCategory =
  | 'pharmacy' // 薬局業務ウォッチ
  | 'clinic' // クリニック業務ウォッチ
  | 'clinical' // 治療・臨床ウォッチ
  | 'system' // 医療システムウォッチ

export type ImportanceLevel = 'critical' | 'caution' | 'info'

export type ReviewStatus = 'unreviewed' | 'reviewing' | 'reviewed' | 'excluded'

export type ItemType =
  | '回収'
  | '緊急安全性情報'
  | '添付文書改訂'
  | '供給'
  | '経過措置・薬価'
  | '調剤報酬・施設基準'
  | '行政通知'
  | '地域情報'
  | 'ガイドライン'
  | '治療情報'
  | '医療システム'

export interface SourceLink {
  label: string
  url: string
  kind: 'primary' | 'related' // 原資料 / 関連資料
}

export interface InformationItem {
  id: string
  category: WatchCategory
  itemType: ItemType
  title: string
  summary: string
  aiImportance: ImportanceLevel
  /** 人間が確定した重要度。AI判定からの自動コピーは禁止（必ず明示操作で設定する） */
  confirmedImportance: ImportanceLevel | null
  /** 重要度を確定した人（初期版はログイン未実装のため固定値。将来は user_id を保存） */
  importanceConfirmedBy: string | null
  importanceConfirmedAt: string | null
  reviewStatus: ReviewStatus
  publishedAt: string // YYYY-MM-DD
  fetchedAt: string
  sourceName: string
  documentNumber: string | null
  pharmacyImpact: string
  requiredAction: string | null
  actionDeadline: string | null
  /** HOME表示は重要度確定後にのみ人間が確定できる、独立した操作 */
  homeDisplayConfirmed: boolean
  homeDisplayConfirmedBy: string | null
  homeDisplayConfirmedAt: string | null
  links: SourceLink[]
  fetchError?: string
}

export type WatchLevel = 'off' | 'watch' | 'home'

export interface WatchSetting {
  id: string
  category: WatchCategory
  label: string
  description: string
  level: WatchLevel
}
