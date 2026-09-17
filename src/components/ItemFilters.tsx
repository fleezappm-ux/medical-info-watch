import type { WatchCategory } from '../types'
import { categoryLabel } from '../lib/importance'
import { categoryOrder, type CategoryFilter, type SourceFilter } from '../lib/filters'

interface Props {
  category: CategoryFilter
  onCategoryChange: (category: CategoryFilter) => void
  categoryCounts: Record<WatchCategory, number>
  totalCount: number
  source: SourceFilter
  onSourceChange: (source: SourceFilter) => void
  sourceOptions: string[]
}

export function ItemFilters({
  category,
  onCategoryChange,
  categoryCounts,
  totalCount,
  source,
  onSourceChange,
  sourceOptions,
}: Props) {
  return (
    <div className="item-filters">
      <div className="item-filters-categories" role="group" aria-label="カテゴリで絞り込み">
        <button
          className={`category-chip${category === 'all' ? ' is-selected' : ''}`}
          onClick={() => onCategoryChange('all')}
        >
          すべて
          <span className="category-chip-count">{totalCount}</span>
        </button>
        {categoryOrder.map((key) => (
          <button
            key={key}
            className={`category-chip${category === key ? ' is-selected' : ''}`}
            onClick={() => onCategoryChange(key)}
          >
            {categoryLabel[key]}
            <span className="category-chip-count">{categoryCounts[key]}</span>
          </button>
        ))}
      </div>

      <label className="item-filters-source">
        情報源
        <select value={source} onChange={(e) => onSourceChange(e.target.value)}>
          <option value="all">すべて</option>
          {sourceOptions.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}
