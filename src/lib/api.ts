import type { InformationItem, SourceStatus, WatchSetting } from '../types'

interface ApiResponse {
  items?: InformationItem[]
  error?: string
  generatedAt?: string
  watchSettings?: WatchSetting[] | null
  sourceStatuses?: SourceStatus[] | null
}

export interface FetchedData {
  items: InformationItem[]
  watchSettings: WatchSetting[] | null
  sourceStatuses: SourceStatus[] | null
}

export async function fetchInformationItemsFromApi(apiUrl: string): Promise<FetchedData> {
  const res = await fetch(apiUrl)
  if (!res.ok) {
    throw new Error(`APIの応答が異常です（HTTP ${res.status}）`)
  }
  const data: ApiResponse = await res.json()
  if (data.error) {
    throw new Error(data.error)
  }
  if (!data.items) {
    throw new Error('APIの応答にitemsが含まれていません')
  }
  return {
    items: data.items,
    watchSettings: data.watchSettings ?? null,
    sourceStatuses: data.sourceStatuses ?? null,
  }
}

/**
 * GASのWeb Appへ更新内容をPOSTで送る（確認状態・重要度確定・HOME表示・ウォッチ設定の保存に使う）。
 * Content-Typeをtext/plainにしているのは、application/jsonにするとブラウザが送る
 * プリフライト（OPTIONS）確認にGASのWeb Appが対応しておらず失敗するため。
 * 中身はGAS側でJSON.parseする。
 */
export async function postUpdateToApi(
  apiUrl: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    throw new Error(`更新の送信に失敗しました（HTTP ${res.status}）`)
  }
  const data = (await res.json()) as { ok?: boolean; error?: string }
  if (data.ok === false) {
    throw new Error(data.error ?? '更新の保存に失敗しました')
  }
}
