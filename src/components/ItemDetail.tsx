import { useEffect, useState } from 'react'
import type { HistoryEntry, ImportanceLevel, InformationItem } from '../types'
import { ImportanceBadge } from './ImportanceBadge'
import { categoryLabel, formatDate, importanceLabel } from '../lib/importance'
import { canMarkReviewed, canConfirmHomeDisplay, changeStatusLabel, needsHomeDisplayReview } from '../lib/review'

interface Props {
  item: InformationItem
  onBack: () => void
  onMarkReviewed: (id: string) => void
  onConfirmImportance: (id: string, level: ImportanceLevel) => void
  onSetHomeDisplay: (id: string, enabled: boolean) => void
  /** 実データ連携中のみ渡される。nullの場合（モック表示中）は変更履歴セクション自体を出さない。 */
  onLoadHistory: ((itemId: string) => Promise<HistoryEntry[]>) | null
}

const reviewStatusLabel: Record<InformationItem['reviewStatus'], string> = {
  unreviewed: '未確認',
  reviewing: '確認中',
  reviewed: '確認済み',
  excluded: '対象外',
}

const importanceOptions: ImportanceLevel[] = ['critical', 'caution', 'info']

export function ItemDetail({
  item,
  onBack,
  onMarkReviewed,
  onConfirmImportance,
  onSetHomeDisplay,
  onLoadHistory,
}: Props) {
  const primaryLinks = item.links.filter((l) => l.kind === 'primary')
  const relatedLinks = item.links.filter((l) => l.kind === 'related')
  const displayLevel = item.confirmedImportance ?? item.aiImportance
  const isExcluded = item.reviewStatus === 'excluded'
  const changeLabel = changeStatusLabel(item)
  const homeReviewNeeded = needsHomeDisplayReview(item)

  const [historyStatus, setHistoryStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle')
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([])
  const [historyError, setHistoryError] = useState('')

  // アイテムを切り替えるたびに履歴を読み直す。onLoadHistoryが無い（モック表示中）場合は何もしない
  // （履歴セクション自体をJSX側で出さないため、状態をリセットする必要もない）。
  useEffect(() => {
    if (!onLoadHistory) return
    let cancelled = false

    async function load() {
      setHistoryStatus('loading')
      setHistoryError('')
      try {
        const entries = await onLoadHistory!(item.id)
        if (cancelled) return
        setHistoryEntries(entries)
        setHistoryStatus('ok')
      } catch (err) {
        if (cancelled) return
        setHistoryError(err instanceof Error ? err.message : '不明なエラーが発生しました')
        setHistoryStatus('error')
      }
    }

    load()
    return () => {
      cancelled = true
    }
    // itemが変わった時・onLoadHistoryの有無が変わった時にだけ読み直せばよい
    // eslint-disable-next-line
  }, [item.id, onLoadHistory])

  return (
    <article className="item-detail">
      <button className="back-link" onClick={onBack}>
        ← 一覧へ戻る
      </button>

      <header className="item-detail-header">
        <div className="item-detail-tags">
          <span className="item-row-category">{categoryLabel[item.category]}</span>
          <span className="item-row-type">{item.itemType}</span>
          <ImportanceBadge level={displayLevel} />
          {item.confirmedImportance === null && (
            <span className="item-row-provisional">AI判定・未確定</span>
          )}
          <span className={`status-pill status-${item.reviewStatus}`}>
            {reviewStatusLabel[item.reviewStatus]}
          </span>
          {changeLabel && <span className={`item-row-change item-row-change-${item.changeStatus}`}>{changeLabel}</span>}
        </div>
        <h2>{item.title}</h2>
        <dl className="item-detail-meta">
          <div>
            <dt>公開日</dt>
            <dd>{formatDate(item.publishedAt)}</dd>
          </div>
          <div>
            <dt>情報源</dt>
            <dd>{item.sourceName}</dd>
          </div>
          <div>
            <dt>発出番号</dt>
            <dd>{item.documentNumber ?? '—'}</dd>
          </div>
          {item.lastChangedAt && (
            <div>
              <dt>最終変更日時</dt>
              <dd>{formatDate(item.lastChangedAt.slice(0, 10))}</dd>
            </div>
          )}
          {item.actionDeadline && (
            <div>
              <dt>対応期限</dt>
              <dd>{formatDate(item.actionDeadline)}</dd>
            </div>
          )}
        </dl>
      </header>

      {item.fetchError && (
        <p className="fetch-error-notice">取得・解析エラー：{item.fetchError}</p>
      )}

      {homeReviewNeeded && (
        <p className="home-review-notice">
          この情報はHOME表示確定後に内容が変わりました。HOME表示は維持されていますが、内容を再確認してください。
        </p>
      )}

      <div className="item-detail-columns">
        <section className="item-detail-panel">
          <h3>AIによる整理</h3>
          <div className="item-detail-field">
            <h4>内容</h4>
            <p>{item.summary}</p>
          </div>
          <div className="item-detail-field">
            <h4>薬局への影響</h4>
            <p>{item.pharmacyImpact}</p>
          </div>
          <div className="item-detail-field">
            <h4>必要な対応</h4>
            <p>{item.requiredAction ?? '特になし'}</p>
          </div>
          <p className="ai-disclaimer">
            この内容はAIによる要約です。確認・対応判断は必ず原資料でご確認ください。
          </p>
        </section>

        <section className="item-detail-panel">
          <h3>原資料・関連資料</h3>
          {primaryLinks.length === 0 && relatedLinks.length === 0 ? (
            <p className="empty-state">取得エラーのため原資料リンクがありません。</p>
          ) : (
            <>
              {primaryLinks.map((link) => (
                <a
                  key={link.url}
                  className="source-link source-link-primary"
                  href={link.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {link.label}
                </a>
              ))}
              {relatedLinks.map((link) => (
                <a
                  key={link.url}
                  className="source-link"
                  href={link.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {link.label}
                </a>
              ))}
            </>
          )}
        </section>
      </div>

      {onLoadHistory && (
        <section className="item-detail-panel item-detail-history">
          <h3>変更履歴</h3>
          {historyStatus === 'loading' && <p className="empty-state">読み込み中…</p>}
          {historyStatus === 'error' && <p className="fetch-error-notice">履歴の取得に失敗しました：{historyError}</p>}
          {historyStatus === 'ok' && historyEntries.length === 0 && (
            <p className="empty-state">この情報はまだ内容変更が検知されていません。</p>
          )}
          {historyStatus === 'ok' && historyEntries.length > 0 && (
            <ul className="history-list">
              {historyEntries.map((h, idx) => (
                <li key={`${h.detectedAt}-${idx}`} className="history-entry">
                  <p className="history-entry-date">{formatDate(h.detectedAt.slice(0, 10))}</p>
                  <p className="history-entry-summary">
                    <span className="history-entry-label">変更後：</span>
                    {h.newSummary}
                  </p>
                  {h.previousSummary && (
                    <p className="history-entry-summary history-entry-previous">
                      <span className="history-entry-label">変更前：</span>
                      {h.previousSummary}
                    </p>
                  )}
                  {h.diffNote && <p className="history-entry-note">{h.diffNote}</p>}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {isExcluded ? (
        <p className="item-detail-actions-note item-detail-excluded-note">
          この情報は対象外に設定されています。確認・重要度確定・HOME表示の操作はできません。
        </p>
      ) : (
        <div className="item-detail-actions">
          {/* 1. 内容確認：AI判定とは無関係に、原資料を人間が読んだという事実だけを記録する */}
          <div className="action-block">
            <h4>1. 内容確認</h4>
            {canMarkReviewed(item.reviewStatus) ? (
              <button className="action-button" onClick={() => onMarkReviewed(item.id)}>
                内容を確認済みにする
              </button>
            ) : (
              <p className="action-done">内容確認済み</p>
            )}
          </div>

          {/* 2. 重要度確定：AI候補をそのまま採用しない。人間が選び直す操作として独立させる */}
          <div className="action-block">
            <h4>2. 重要度の確定</h4>
            {item.confirmedImportance === null ? (
              <>
                <p className="action-hint">
                  AI判定候補は「{importanceLabel[item.aiImportance]}」です。参考にしつつ、必ず人間が確定してください。
                </p>
                <div className="importance-picker">
                  {importanceOptions.map((level) => (
                    <button
                      key={level}
                      className="importance-picker-button"
                      onClick={() => onConfirmImportance(item.id, level)}
                    >
                      {importanceLabel[level]}に確定
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <p className="action-done">
                「{importanceLabel[item.confirmedImportance]}」で確定済み
                （{item.importanceConfirmedBy} ・ {item.importanceConfirmedAt && formatDate(item.importanceConfirmedAt.slice(0, 10))}）
              </p>
            )}
          </div>

          {/* 3. HOME表示確定：重要度確定後にのみ許可する独立操作 */}
          <div className="action-block">
            <h4>3. HOME表示の確定</h4>
            {canConfirmHomeDisplay(item) ? (
              <>
                <button
                  className="action-button"
                  onClick={() => onSetHomeDisplay(item.id, !item.homeDisplayConfirmed)}
                >
                  {item.homeDisplayConfirmed ? 'HOME表示をやめる' : 'HOMEへ表示する'}
                </button>
                {item.homeDisplayConfirmed && item.homeDisplayConfirmedBy && (
                  <p className="action-hint">
                    {item.homeDisplayConfirmedBy} が確定
                    （{item.homeDisplayConfirmedAt && formatDate(item.homeDisplayConfirmedAt.slice(0, 10))}）
                  </p>
                )}
              </>
            ) : (
              <p className="action-hint">重要度確定後に操作できます。</p>
            )}
          </div>
        </div>
      )}
    </article>
  )
}
