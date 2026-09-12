import { useState } from 'react'
import type { WatchLevel, WatchSetting } from '../types'

interface Props {
  settings: WatchSetting[]
  onChange: (id: string, level: WatchLevel) => void
  onLoadRealData: () => Promise<void>
  apiUrl: string
  onApiUrlChange: (url: string) => void
}

const levels: { key: WatchLevel; label: string }[] = [
  { key: 'off', label: 'OFF' },
  { key: 'watch', label: '監視ON' },
  { key: 'home', label: 'HOME表示ON' },
]

export function WatchSettings({ settings, onChange, onLoadRealData, apiUrl, onApiUrlChange }: Props) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState('')

  async function handleLoad() {
    if (!apiUrl.trim()) return
    setStatus('loading')
    setErrorMessage('')
    try {
      await onLoadRealData()
      setStatus('ok')
    } catch (err) {
      setStatus('error')
      setErrorMessage(err instanceof Error ? err.message : '不明なエラーが発生しました')
    }
  }

  return (
    <div className="watch-settings">
      <section className="data-source-panel">
        <h3>実データ連携（PoC）</h3>
        <p className="watch-settings-note">
          GASで公開したWeb AppのURLを貼り付けると、モックデータの代わりに実際のPMDAデータを表示します。
          このURLはブラウザに保存されるので、次回以降は貼り直さなくても大丈夫です。
        </p>
        <div className="data-source-controls">
          <input
            type="text"
            className="data-source-input"
            placeholder="https://script.google.com/macros/s/.../exec"
            value={apiUrl}
            onChange={(e) => onApiUrlChange(e.target.value)}
          />
          <button
            className="action-button"
            onClick={handleLoad}
            disabled={status === 'loading' || !apiUrl.trim()}
          >
            {status === 'loading' ? '読み込み中…' : '実データを読み込む'}
          </button>
        </div>
        {status === 'ok' && <p className="data-source-status-ok">読み込みました。情報一覧タブで確認できます。</p>}
        {status === 'error' && <p className="data-source-status-error">読み込み失敗：{errorMessage}</p>}
      </section>

      <p className="watch-settings-note">
        施設単位の初期設定です。診療科・疾患・ガイドライン単位の詳細設定は今後追加予定です。
      </p>
      <ul className="watch-settings-list">
        {settings.map((setting) => (
          <li key={setting.id} className="watch-settings-row">
            <div className="watch-settings-row-text">
              <p className="watch-settings-label">{setting.label}</p>
              <p className="watch-settings-desc">{setting.description}</p>
            </div>
            <div className="watch-settings-toggle" role="group" aria-label={`${setting.label}の設定`}>
              {levels.map((level) => (
                <button
                  key={level.key}
                  className={`toggle-option${setting.level === level.key ? ' is-selected' : ''}`}
                  onClick={() => onChange(setting.id, level.key)}
                  aria-pressed={setting.level === level.key}
                >
                  {level.label}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
