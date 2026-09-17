import type { InformationItem } from '../types'
import { isSameLocalDay, needsReview, hasFetchError } from '../lib/review'

// このアプリ自体の公開URL（GitHub Pages）。
// Pharmacy OS（Notion）等に埋め込んで見ている場合、埋め込み枠の中では
// ブラウザの「ホーム画面に追加」機能が使えないため、このボタンで一度
// 本当のブラウザタブとして開き直せるようにしている。
const APP_PUBLIC_URL = 'https://fleezappm-ux.github.io/medical-info-watch/'
const COLLECTA_ICON_SRC = `${import.meta.env.BASE_URL}icons/collecta-mark-64.png`

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

      <a
        className="collecta-launch-button"
        href={APP_PUBLIC_URL}
        target="_blank"
        rel="noopener noreferrer"
        title="ブラウザでCOLLECTAを開く（ここから「ホーム画面に追加」できます）"
      >
        <img src={COLLECTA_ICON_SRC} alt="" className="collecta-launch-icon" />
        <span className="collecta-launch-label">
          <strong>COLLECTA</strong>
          <small>ブラウザで開く／デスクトップに追加</small>
        </span>
      </a>

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
