import type { WatchSetting } from '../types'

// あおい薬局の初期値案（申し送りメモ 5番）に基づくモック設定
export const mockWatchSettings: WatchSetting[] = [
  {
    id: 'watch_pharmacy',
    category: 'pharmacy',
    label: '薬局業務ウォッチ',
    description: '回収・安全性情報・供給状況・経過措置・調剤報酬など',
    level: 'home',
  },
  {
    id: 'watch_clinic',
    category: 'clinic',
    label: 'クリニック業務ウォッチ',
    description: '診療報酬・施設基準・電子処方箋など（初期版は設定のみ）',
    level: 'off',
  },
  {
    id: 'watch_clinical',
    category: 'clinical',
    label: '治療・臨床ウォッチ',
    description: 'ガイドライン・最新治療薬・治療方針の変更など',
    level: 'watch',
  },
  {
    id: 'watch_system',
    category: 'system',
    label: '医療システムウォッチ',
    description: '電子処方箋・医療DX・調剤監査システムなど',
    level: 'watch',
  },
]
