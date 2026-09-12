import type { ImportanceLevel, InformationItem } from '../types'
import { ImportanceBadge } from './ImportanceBadge'
import { categoryLabel, formatDate, importanceLabel } from '../lib/importance'
import { canMarkReviewed, canConfirmHomeDisplay } from '../lib/review'

interface Props {
  item: InformationItem
  onBack: () => void
  onMarkReviewed: (id: string) => void
  onConfirmImportance: (id: string, level: ImportanceLevel) => void
  onSetHomeDisplay: (id: string, enabled: boolean) => void
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
}: Props) {
  const primaryLinks = item.links.filter((l) => l.kind === 'primary')
  const relatedLinks = item.links.filter((l) => l.kind === 'related')
  const displayLevel = item.confirmedImportance ?? item.aiImportance
  const isExcluded = item.reviewStatus === 'excluded'

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
