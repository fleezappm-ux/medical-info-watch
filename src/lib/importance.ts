import type { ImportanceLevel } from '../types'

export const importanceLabel: Record<ImportanceLevel, string> = {
  critical: '重要',
  caution: '注意',
  info: '参考',
}

export const importanceVar: Record<ImportanceLevel, string> = {
  critical: 'critical',
  caution: 'caution',
  info: 'info',
}

export const categoryLabel = {
  pharmacy: '薬局業務',
  clinic: 'クリニック業務',
  clinical: '治療・臨床',
  system: '医療システム',
} as const

export function formatDate(value: string): string {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}
