import type { InformationItem } from '../types'
import type { ListTab } from './TabNav'
import { ItemRow } from './ItemRow'
import { isConfirmedImportant, needsReview, hasContentChanged, hasFetchError } from '../lib/review'
import { groupByCategory } from '../lib/filters'
import { categoryLabel } from '../lib/importance'

interface Props {
  items: InformationItem[]
  tab: ListTab
  onSelect: (id: string) => void
  /** trueのとき、カテゴリ（項目）別に見出しを付けてグループ表示する（カテゴリ絞り込みが「すべて」のときのみ使う）。 */
  groupByCategory?: boolean
}

function filterByTab(items: InformationItem[], tab: ListTab): InformationItem[] {
  if (tab === 'unreviewed') return items.filter(needsReview)
  if (tab === 'changed') return items.filter(hasContentChanged)
  if (tab === 'important') return items.filter(isConfirmedImportant)
  if (tab === 'error') return items.filter(hasFetchError)
  return items
}

/**
 * 一覧は「直近で動きがあったもの」が上に来るよう並べる（新しい順）。
 * 大量件数の中から目的の情報を探す手間を減らすための並び替えで、絞り込み自体はfilterByTabが担う。
 * 基準はlastChangedAt（変更検知日時）優先、無ければpublishedAt（原資料の公開日）。
 */
function sortByRecency(items: InformationItem[]): InformationItem[] {
  return [...items].sort((a, b) => {
    const aKey = a.lastChangedAt || a.publishedAt || ''
    const bKey = b.lastChangedAt || b.publishedAt || ''
    return bKey.localeCompare(aKey)
  })
}

const emptyMessage: Record<ListTab, string> = {
  all: '該当する情報はありません。ウォッチ設定を確認してください。',
  unreviewed: '要確認の情報はありません。',
  changed: '内容変更・供給再開・掲載未確認が検知された情報はありません。',
  important: '人間が重要度を確定した情報はまだありません。AI判定のみの情報は各タブのバッジで確認できます。',
  error: '取得・解析エラーはありません。',
}

export function ItemList({ items, tab, onSelect, groupByCategory: shouldGroup = false }: Props) {
  const filtered = sortByRecency(filterByTab(items, tab))

  if (filtered.length === 0) {
    return <p className="empty-state">{emptyMessage[tab]}</p>
  }

  if (shouldGroup) {
    const groups = groupByCategory(filtered)
    return (
      <div className="item-list-groups">
        {groups.map((group) => (
          <section key={group.category} className="item-list-group">
            <h2 className="item-list-group-heading">
              {categoryLabel[group.category]}
              <span className="item-list-group-count">{group.items.length}件</span>
            </h2>
            <ul className="item-list">
              {group.items.map((item) => (
                <ItemRow key={item.id} item={item} onSelect={onSelect} />
              ))}
            </ul>
          </section>
        ))}
      </div>
    )
  }

  return (
    <ul className="item-list">
      {filtered.map((item) => (
        <ItemRow key={item.id} item={item} onSelect={onSelect} />
      ))}
    </ul>
  )
}
