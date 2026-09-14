import type { SourceStatus } from '../types'
import { formatDate } from '../lib/importance'

interface Props {
  sourceStatuses: SourceStatus[]
}

function formatDateTime(value: string | null): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return `${formatDate(value.slice(0, 10))} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
}

/**
 * 情報源（PMDA回収情報・厚労省供給情報など）ごとの、直近の取得状況を表示する。
 * 取得失敗時に一覧が単に空になって「何も問題がない」ように見えることを防ぐための表示。
 */
export function SourceStatusPanel({ sourceStatuses }: Props) {
  if (sourceStatuses.length === 0) return null

  return (
    <section className="source-status-panel" aria-label="情報源ごとの取得状況">
      {sourceStatuses.map((s) => (
        <div key={s.sourceId} className={`source-status-row${s.success ? '' : ' is-error'}`}>
          <span className="source-status-label">{s.label}</span>
          {s.success ? (
            <span className="source-status-detail">
              最終成功：{formatDateTime(s.lastSuccessAt)} ／ 取得件数：{s.fetchedCount}件 ／ 状態：正常
            </span>
          ) : (
            <span className="source-status-detail">
              本日：取得失敗（{s.errorMessage ?? '不明なエラー'}）／ 前回データを維持しています
              {s.lastSuccessAt && <> ／ 前回成功：{formatDateTime(s.lastSuccessAt)}</>}
            </span>
          )}
        </div>
      ))}
    </section>
  )
}
