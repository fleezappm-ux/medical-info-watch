import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { Header } from './components/Header'
import { TabNav, type ListTab } from './components/TabNav'
import { ItemList } from './components/ItemList'
import { ItemDetail } from './components/ItemDetail'
import { WatchSettings } from './components/WatchSettings'
import { mockItems } from './data/mockItems'
import { mockWatchSettings } from './data/mockWatchSettings'
import type { ImportanceLevel, WatchLevel } from './types'
import { fetchInformationItemsFromApi, postUpdateToApi } from './lib/api'
import { canMarkReviewed, canConfirmImportance, canConfirmHomeDisplay, isConfirmedImportant, needsReview, hasFetchError } from './lib/review'

type View = 'list' | 'settings'

const FACILITY_NAME = 'あおい薬局'
// 初期版は認証未実装のため固定値。将来は user_id に置き換える。
const CURRENT_REVIEWER = 'フリちゃん（管理薬剤師）'
// GASのWeb App URLをブラウザに保存しておくためのキー（毎回貼り直さずに済むように）
const API_URL_STORAGE_KEY = 'medical-info-watch:apiUrl'

function App() {
  const [items, setItems] = useState(mockItems)
  const [isRealData, setIsRealData] = useState(false)
  const [watchSettings, setWatchSettings] = useState(mockWatchSettings)
  const [apiUrl, setApiUrl] = useState(() => {
    try {
      return localStorage.getItem(API_URL_STORAGE_KEY) ?? ''
    } catch {
      return ''
    }
  })
  const [syncError, setSyncError] = useState<string | null>(null)
  const [view, setView] = useState<View>('list')
  const [tab, setTab] = useState<ListTab>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // 確認状態・ウォッチ設定の保存（POST）は、送った順番どおりにサーバーへ届くとは限らない
  // （通信のタイミングで前後することがある）。1件ずつ順番に送るための待ち行列。
  // これが無いと、例えば設定を連続で切り替えた直後に「実データを読み込む」を押すと、
  // まだ保存し切れていない古い状態を読み込んでしまうことがある。
  const syncQueueRef = useRef<Promise<void>>(Promise.resolve())

  const counts = useMemo(
    () => ({
      all: items.length,
      unreviewed: items.filter(needsReview).length,
      important: items.filter(isConfirmedImportant).length,
      error: items.filter(hasFetchError).length,
    }),
    [items],
  )

  const selectedItem = items.find((i) => i.id === selectedId) ?? null

  function handleApiUrlChange(url: string) {
    setApiUrl(url)
    try {
      localStorage.setItem(API_URL_STORAGE_KEY, url)
    } catch {
      // プライベートブラウジング等でlocalStorageが使えない場合は無視する（次回また貼り直せばよい）
    }
  }

  // 実データを読み込む（初回自動読み込み・手動の「実データを読み込む」ボタン共通）。
  // 保留中の保存（syncQueueRef）が終わるのを待ってから読み込むことで、
  // 直前に変更した内容がまだサーバーに届く前に古い状態で上書きされるのを防ぐ。
  async function loadRealData(url: string) {
    await syncQueueRef.current
    const data = await fetchInformationItemsFromApi(url)
    setItems(data.items)
    setIsRealData(true)
    if (data.watchSettings) {
      setWatchSettings(data.watchSettings)
    }
  }

  // ページを開いた時点で保存済みのURLがあれば、自動で実データを読み込む。
  // これが無いと、リロードするたびに一旦モックデータの初期状態に戻って見えてしまう
  // （URL自体はブラウザに保存されるが、それだけでは自動で読み込みまではしない）。
  useEffect(() => {
    if (!apiUrl.trim()) return
    let cancelled = false

    async function autoLoad() {
      try {
        await loadRealData(apiUrl.trim())
      } catch (err) {
        if (cancelled) return
        setSyncError(
          `前回のURLからの自動読み込みに失敗しました：${err instanceof Error ? err.message : '不明なエラー'}`,
        )
      }
    }

    autoLoad()
    return () => {
      cancelled = true
    }
    // 初回マウント時にのみ実行する（apiUrlをその場で書き換えた時は手動ボタン側で対応する）
    // eslint-disable-next-line
  }, [])

  // 実データ連携中のみ、GAS側（Googleスプレッドシート）にも反映しにいく。
  // モックデータ表示中は保存先が無いので何もしない。
  // 呼び出された順番どおりにサーバーへ届くよう、待ち行列に積んで1件ずつ送る。
  function syncToApi(payload: Record<string, unknown>) {
    if (!isRealData || !apiUrl.trim()) return
    const url = apiUrl.trim()
    syncQueueRef.current = syncQueueRef.current
      .catch(() => {}) // 前の送信が失敗していても、後続の送信をブロックしない
      .then(() => postUpdateToApi(url, payload))
      .catch((err) => {
        setSyncError(
          `保存に失敗しました：${err instanceof Error ? err.message : '不明なエラー'}（画面上の表示は変わっていますが、Googleスプレッドシート側には反映されていません）`,
        )
      })
  }

  function handleWatchChange(id: string, level: WatchLevel) {
    setWatchSettings((prev) => {
      const next = prev.map((s) => (s.id === id ? { ...s, level } : s))
      syncToApi({ action: 'updateWatchSettings', settings: next })
      return next
    })
  }

  // 1. 内容確認：AI判定や重要度とは無関係に、確認した事実だけを記録する
  function handleMarkReviewed(id: string) {
    setItems((prev) =>
      prev.map((i) => (i.id === id && canMarkReviewed(i.reviewStatus) ? { ...i, reviewStatus: 'reviewed' } : i)),
    )
    syncToApi({ action: 'updateItemStatus', id, reviewStatus: 'reviewed' })
  }

  // 2. 重要度確定：AI候補からの自動コピーを行わず、人間が選んだ値のみを保存する
  function handleConfirmImportance(id: string, level: ImportanceLevel) {
    const now = new Date().toISOString()
    setItems((prev) =>
      prev.map((i) =>
        i.id === id && canConfirmImportance(i)
          ? {
              ...i,
              confirmedImportance: level,
              importanceConfirmedBy: CURRENT_REVIEWER,
              importanceConfirmedAt: now,
            }
          : i,
      ),
    )
    syncToApi({
      action: 'updateItemStatus',
      id,
      confirmedImportance: level,
      confirmedBy: CURRENT_REVIEWER,
    })
  }

  // 3. HOME表示確定：重要度確定済みの情報にのみ許可する独立操作
  function handleSetHomeDisplay(id: string, enabled: boolean) {
    const now = new Date().toISOString()
    setItems((prev) =>
      prev.map((i) =>
        i.id === id && canConfirmHomeDisplay(i)
          ? {
              ...i,
              homeDisplayConfirmed: enabled,
              homeDisplayConfirmedBy: CURRENT_REVIEWER,
              homeDisplayConfirmedAt: now,
            }
          : i,
      ),
    )
    syncToApi({
      action: 'updateItemStatus',
      id,
      homeDisplayConfirmed: enabled,
      confirmedBy: CURRENT_REVIEWER,
    })
  }

  return (
    <div className="app-shell">
      <Header facilityName={FACILITY_NAME} items={items} />

      <div className="mock-banner">
        {isRealData
          ? 'PMDA実データ表示中（Google Apps Script経由）'
          : 'モックデータ表示中：実データ取得はまだ接続されていません'}
      </div>

      {syncError && (
        <div className="sync-error-banner">
          {syncError}
          <button className="sync-error-dismiss" onClick={() => setSyncError(null)}>
            閉じる
          </button>
        </div>
      )}

      <nav className="primary-nav" aria-label="メイン画面切り替え">
        <button
          className={`primary-nav-item${view === 'list' ? ' is-active' : ''}`}
          onClick={() => {
            setView('list')
            setSelectedId(null)
          }}
        >
          情報一覧
        </button>
        <button
          className={`primary-nav-item${view === 'settings' ? ' is-active' : ''}`}
          onClick={() => setView('settings')}
        >
          ウォッチ設定
        </button>
      </nav>

      <main className="app-main">
        {view === 'settings' && (
          <WatchSettings
            settings={watchSettings}
            onChange={handleWatchChange}
            apiUrl={apiUrl}
            onApiUrlChange={handleApiUrlChange}
            onLoadRealData={async () => {
              if (!apiUrl.trim()) return
              await loadRealData(apiUrl.trim())
            }}
          />
        )}

        {view === 'list' && !selectedItem && (
          <>
            <TabNav active={tab} onChange={setTab} counts={counts} />
            <ItemList items={items} tab={tab} onSelect={setSelectedId} />
          </>
        )}

        {view === 'list' && selectedItem && (
          <ItemDetail
            item={selectedItem}
            onBack={() => setSelectedId(null)}
            onMarkReviewed={handleMarkReviewed}
            onConfirmImportance={handleConfirmImportance}
            onSetHomeDisplay={handleSetHomeDisplay}
          />
        )}
      </main>
    </div>
  )
}

export default App
