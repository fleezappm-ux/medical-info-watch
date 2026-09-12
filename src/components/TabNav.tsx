export type ListTab = 'all' | 'unreviewed' | 'important' | 'error'

interface Props {
  active: ListTab
  onChange: (tab: ListTab) => void
  counts: Record<ListTab, number>
}

const tabs: { key: ListTab; label: string }[] = [
  { key: 'all', label: '全件一覧' },
  { key: 'unreviewed', label: '要確認' },
  { key: 'important', label: '重要情報（確定）' },
  { key: 'error', label: '取得エラー' },
]

export function TabNav({ active, onChange, counts }: Props) {
  return (
    <nav className="tab-nav" aria-label="情報一覧の絞り込み">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          className={`tab-nav-item${active === tab.key ? ' is-active' : ''}`}
          onClick={() => onChange(tab.key)}
          aria-current={active === tab.key ? 'page' : undefined}
        >
          {tab.label}
          <span className="tab-nav-count">{counts[tab.key]}</span>
        </button>
      ))}
    </nav>
  )
}
