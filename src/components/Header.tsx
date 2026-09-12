import type { InformationItem } from '../types'
import { isSameLocalDay, needsReview, hasFetchError } from '../lib/review'

interface Props {
  facilityName: string
  items: InformationItem[]
}

export function Header({ facilityName, items }: Props) {
  const todayItems = items.filter((i) => isSameLocalDay(i.fetchedAt))
  const reviewed = items.filter((i) => i.reviewStatus === 'reviewed').length
  const unreviewed = items.filter(needsReview).length
  const errors = items.filter(hasFetchError).length

  return (
    <header className="app-header">
      <div className="app-header-title">
        <p className="app-header-eyebrow">医療情報ウォッチ</p>
        <h1>{facilityName}</h1>
      </div>
      <dl className="app-header-counts">
        <div>
          <dt>本日の取得</dt>
          <dd>{todayItems.length}</dd>
        </div>
        <div>
          <dt>確認済み</dt>
          <dd>{reviewed}</dd>
        </div>
        <div>
          <dt>要確認</dt>
          <dd className={unreviewed > 0 ? 'is-attention' : undefined}>{unreviewed}</dd>
        </div>
        <div>
          <dt>取得エラー</dt>
          <dd className={errors > 0 ? 'is-error' : undefined}>{errors}</dd>
        </div>
      </dl>
    </header>
  )
}
