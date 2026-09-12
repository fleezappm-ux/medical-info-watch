import type { InformationItem } from '../types'
import type { ListTab } from './TabNav'
import { ItemRow } from './ItemRow'
import { isConfirmedImportant, needsReview, hasFetchError } from '../lib/review'

interface Props {
  items: InformationItem[]
  tab: ListTab
  onSelect: (id: string) => void
}

function filterByTab(items: InformationItem[], tab: ListTab): InformationItem[] {
  if (tab === 'unreviewed') return items.filter(needsReview)
  if (tab === 'important') return items.filter(isConfirmedImportant)
  if (tab === 'error') return items.filter(hasFetchError)
  return items
}

const emptyMessage: Record<ListTab, string> = {
  all: '該当する情報はありません。ウォッチ設定を確認してください。',
  unreviewed: '要確認の情報はありません。',
  important: '人間が重要度を確定した情報はまだありません。AI判定のみの情報は各タブのバッジで確認できます。',
  error: '取得・解析エラーはありません。',
}

export function ItemList({ items, tab, onSelect }: Props) {
  const filtered = filterByTab(items, tab)

  if (filtered.length === 0) {
    return <p className="empty-state">{emptyMessage[tab]}</p>
  }

  return (
    <ul className="item-list">
      {filtered.map((item) => (
        <ItemRow key={item.id} item={item} onSelect={onSelect} />
      ))}
    </ul>
  )
}
