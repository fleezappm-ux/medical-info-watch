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

/** GAS側で情報源ごとに検知した変更区分。新規／内容変更／変更なし／解消（供給再開等）／掲載未確認。 */
export type ChangeStatus = 'new' | 'updated' | 'unchanged' | 'resolved' | 'missing'

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
  /** どの情報源から取得したか（例：pmda_recall / mhlw_supply）。モックデータには無い場合がある。 */
  sourceId?: string
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
  /** 直近の取得日時（毎回の自動取得ごとに更新される）。 */
  lastFetchedAt?: string
  /** 内容が最後に変わったと検知された日時。変更がなければnull。 */
  lastChangedAt?: string | null
  /** 今回の取得で検知された変更区分。モックデータや旧形式のAPIには無い場合がある。 */
  changeStatus?: ChangeStatus
  /** changeStatusが'missing'の場合の連続欠落回数。1回だけでは解消と判定しないための参考情報。 */
  missingStreak?: number
  sourceName: string
  documentNumber: string | null
  pharmacyImpact: string
  requiredAction: string | null
  actionDeadline: string | null
  /** HOME表示は重要度確定後にのみ人間が確定できる、独立した操作 */
  homeDisplayConfirmed: boolean
  homeDisplayConfirmedBy: string | null
  homeDisplayConfirmedAt: string | null
  /** HOME表示確定済みの情報の内容が変わり、再確認が必要になっている状態。 */
  homeDisplayNeedsReview?: boolean
  links: SourceLink[]
  fetchError?: string
}

/** GAS側の情報源（PMDA回収情報・厚労省供給情報など）ごとの、直近の取得状況。 */
export interface SourceStatus {
  sourceId: string
  label: string
  lastRunAt: string | null
  lastSuccessAt: string | null
  success: boolean
  fetchedCount: number
  errorMessage: string | null
}

/** information_item_historyシートに記録された、1件の変更イベント（新しい順で表示する）。 */
export interface HistoryEntry {
  detectedAt: string
  previousSummary: string | null
  newSummary: string
  diffNote: string | null
}

export type WatchLevel = 'off' | 'watch' | 'home'

export interface WatchSetting {
  id: string
  category: WatchCategory
  label: string
  description: string
  level: WatchLevel
}
