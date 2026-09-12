import type { ImportanceLevel } from '../types'
import { importanceLabel } from '../lib/importance'

export function ImportanceBadge({ level }: { level: ImportanceLevel }) {
  return <span className={`badge badge-${level}`}>{importanceLabel[level]}</span>
}
