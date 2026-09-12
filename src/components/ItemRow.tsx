import type { InformationItem } from '../types'
import { ImportanceBadge } from './ImportanceBadge'
import { categoryLabel, formatDate } from '../lib/importance'

interface Props {
  item: InformationItem
  onSelect: (id: string) => void
}

export function ItemRow({ item, onSelect }: Props) {
  const level = item.confirmedImportance ?? item.aiImportance
  const isProvisional = item.confirmedImportance === null

  return (
    <li className={`item-row item-row-${level}`}>
      <button className="item-row-button" onClick={() => onSelect(item.id)}>
        <div className="item-row-meta">
          <span className="item-row-category">{categoryLabel[item.category]}</span>
          <span className="item-row-type">{item.itemType}</span>
          <span className="item-row-date">{formatDate(item.publishedAt)}</span>
        </div>
        <p className="item-row-title">{item.title}</p>
        <div className="item-row-footer">
          <ImportanceBadge level={level} />
          {isProvisional && <span className="item-row-provisional">AI判定・未確定</span>}
          <span className="item-row-source">{item.sourceName}</span>
          {item.fetchError && <span className="item-row-error-flag">取得エラー</span>}
        </div>
      </button>
    </li>
  )
}
