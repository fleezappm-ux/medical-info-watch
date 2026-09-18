// gas/pmda-recall-fetcher.gs（実際にGASへ貼り付けるファイルそのもの）の中から、
// GAS API（SpreadsheetApp等）に依存しない純粋関数だけを、Node.jsのvmモジュールで
// サンドボックス実行して検証する。ロジックを別ファイルに複製していないため、
// ここで通れば「実際に貼り付けるコード」がテストされたことになる。
import { describe, expect, it, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { createContext, Script } from 'node:vm'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const gasSource = readFileSync(path.join(__dirname, '..', 'gas', 'pmda-recall-fetcher.gs'), 'utf8')

function loadGas() {
  const sandbox = {}
  createContext(sandbox)
  // GAS専用グローバル（SpreadsheetApp等）は関数の中でしか使われていないため、
  // ここでスクリプトを読み込むだけなら未定義のままで問題ない。
  new Script(gasSource, { filename: 'pmda-recall-fetcher.gs' }).runInContext(sandbox)
  return sandbox
}

let gas

beforeAll(() => {
  gas = loadGas()
})

describe('computeContentHash_', () => {
  it('同じ内容なら同じハッシュ、違う内容なら違うハッシュになる', () => {
    const a = gas.computeContentHash_(['x', 'y', '1'])
    const b = gas.computeContentHash_(['x', 'y', '1'])
    const c = gas.computeContentHash_(['x', 'y', '2'])
    expect(a).toBe(b)
    expect(a).not.toBe(c)
  })

  it('前後の空白・連続する空白の差だけでは別ハッシュにならない', () => {
    const a = gas.computeContentHash_(['  高血圧   の薬  '])
    const b = gas.computeContentHash_(['高血圧 の薬'])
    expect(a).toBe(b)
  })

  it('null/undefinedは空文字として扱う', () => {
    const a = gas.computeContentHash_(['x', null, 'y'])
    const b = gas.computeContentHash_(['x', undefined, 'y'])
    expect(a).toBe(b)
  })
})

describe('currentJapaneseFiscalYear2Digit_ / pmdaFiscalYearCandidatesForClass_', () => {
  it('4月以降はその年の年度になる', () => {
    expect(gas.currentJapaneseFiscalYear2Digit_(new Date('2026-04-01T00:00:00+09:00'))).toBe('26')
    expect(gas.currentJapaneseFiscalYear2Digit_(new Date('2027-03-31T00:00:00+09:00'))).toBe('26')
  })

  it('3月以前は前年の年度になる', () => {
    expect(gas.currentJapaneseFiscalYear2Digit_(new Date('2027-01-15T00:00:00+09:00'))).toBe('26')
  })

  it('候補は現在年度→前年度の順（クラスIを指定した場合）', () => {
    const candidates = gas.pmdaFiscalYearCandidatesForClass_(new Date('2026-09-14T00:00:00+09:00'), 1)
    expect(candidates).toEqual([
      { fiscalYear2Digit: '26', recallClass: 1 },
      { fiscalYear2Digit: '25', recallClass: 1 },
    ])
  })

  it('クラスII・IIIを指定した場合も同じ年度候補で、recallClassだけ切り替わる', () => {
    const date = new Date('2026-09-14T00:00:00+09:00')
    expect(gas.pmdaFiscalYearCandidatesForClass_(date, 2)).toEqual([
      { fiscalYear2Digit: '26', recallClass: 2 },
      { fiscalYear2Digit: '25', recallClass: 2 },
    ])
    expect(gas.pmdaFiscalYearCandidatesForClass_(date, 3)).toEqual([
      { fiscalYear2Digit: '26', recallClass: 3 },
      { fiscalYear2Digit: '25', recallClass: 3 },
    ])
  })

  it('PMDA_RECALL_CLASSES_にクラスI・II・IIIが独立したsourceIdで定義されている', () => {
    expect(gas.PMDA_RECALL_CLASSES_).toEqual([
      { recallClass: 1, sourceId: 'pmda_recall_class1' },
      { recallClass: 2, sourceId: 'pmda_recall_class2' },
      { recallClass: 3, sourceId: 'pmda_recall_class3' },
    ])
  })
})

describe('extractRecallClassLabel_（表示用クラス名の抽出）', () => {
  it('クラスIII・II・Iを正しく判定する（部分文字列の誤判定に注意した順序）', () => {
    expect(gas.extractRecallClassLabel_('（クラスIII）')).toBe('クラスIII')
    expect(gas.extractRecallClassLabel_('（クラスII）')).toBe('クラスII')
    expect(gas.extractRecallClassLabel_('（クラスI）')).toBe('クラスI')
  })

  it('判定不能な文字列は「クラス不明」を返す', () => {
    expect(gas.extractRecallClassLabel_('')).toBe('クラス不明')
    expect(gas.extractRecallClassLabel_(undefined)).toBe('クラス不明')
  })
})

describe('buildPmdaRecallItem_ のid生成（v3.2.1で修正）', () => {
  it('idは常に「pmda_recall_ + 回収番号」になり、sourceIdは含めない（回収番号自体がクラスをまたいで一意なため）', () => {
    const row = [
      '1-9999', // 回収番号
      "'2026/06/26", // 掲載年月日
      '医薬品', // 種類
      '', // 回収概要作成日及び訂正日
      '（クラスII）', // クラス分類
      '販売名：テスト薬', // 一般的名称及び販売名
      '', '', '理由テスト', '', '', '', '', '', '', // 残りの列
    ]
    const item = gas.buildPmdaRecallItem_(row, 'https://example.com/list.html', '2026-09-14T00:00:00.000Z')
    expect(item.id).toBe('pmda_recall_1-9999')
    expect(item.sourceRecordId).toBe('1-9999')
    expect(item.aiImportance).toBe('caution')
    expect(item.sourceName).toContain('クラスII')

    // v3.1以前からの既存データ（クラスIのみの時代のid）とも完全に互換性がある
    // ＝同じ回収番号なら、クラス表記が違っても同じidになる
    const rowClass1 = row.slice()
    rowClass1[4] = '（クラスI）'
    const itemClass1 = gas.buildPmdaRecallItem_(rowClass1, 'https://example.com/list.html', '2026-09-14T00:00:00.000Z')
    expect(itemClass1.id).toBe(item.id)
  })
})

describe('classifySupplyTransition_ 相当（mergeSourceItems_経由）と mergeSourceItems_', () => {
  function pmdaItem(overrides = {}) {
    return {
      id: 'pmda_recall_1-1',
      sourceRecordId: '1-1',
      category: 'pharmacy',
      itemType: '回収',
      title: 'サンプル薬（自主回収）',
      summary: '理由A',
      aiImportance: 'critical',
      publishedAt: '2026-09-01',
      sourceName: 'PMDA（医薬品）',
      documentNumber: '回収番号：1-1',
      pharmacyImpact: '影響A',
      requiredAction: null,
      primaryUrl: 'https://example.com/a.html',
      remarks: '',
      contentHash: gas.computeContentHash_(['1-1', '2026-09-01', '（クラスI）', 'サンプル薬', '', '理由A', '', '', '']),
      fetchedAtIso: '2026-09-14T00:00:00.000Z',
      isResolvedCandidate: false,
      ...overrides,
    }
  }

  it('新規idは changeStatus=new、初期状態（未確認・未確定）になる', () => {
    const result = gas.mergeSourceItems_('pmda_recall', [pmdaItem()], {}, '2026-09-14T00:00:00.000Z')
    const item = result.updatedById['pmda_recall_1-1']
    expect(item.changeStatus).toBe('new')
    expect(item.reviewStatus).toBe('unreviewed')
    expect(item.confirmedImportance).toBeNull()
    expect(result.stats.addedCount).toBe(1)
  })

  it('既存idでハッシュが同じなら unchanged、確認状態を維持する', () => {
    const incoming = pmdaItem()
    const existing = {
      'pmda_recall_1-1': {
        id: 'pmda_recall_1-1',
        sourceId: 'pmda_recall',
        contentHash: incoming.contentHash,
        summary: '理由A',
        firstFetchedAt: '2026-09-11T00:00:00.000Z',
        lastChangedAt: null,
        reviewStatus: 'reviewed',
        confirmedImportance: 'critical',
        importanceConfirmedBy: 'フリちゃん',
        importanceConfirmedAt: '2026-09-11T01:00:00.000Z',
        homeDisplayConfirmed: true,
        homeDisplayConfirmedBy: 'フリちゃん',
        homeDisplayConfirmedAt: '2026-09-11T01:00:00.000Z',
        homeDisplayNeedsReview: false,
      },
    }
    const result = gas.mergeSourceItems_('pmda_recall', [incoming], existing, '2026-09-14T00:00:00.000Z')
    const item = result.updatedById['pmda_recall_1-1']
    expect(item.changeStatus).toBe('unchanged')
    expect(item.reviewStatus).toBe('reviewed')
    expect(item.confirmedImportance).toBe('critical')
    expect(item.homeDisplayConfirmed).toBe(true)
    expect(item.firstFetchedAt).toBe('2026-09-11T00:00:00.000Z')
    expect(result.stats.unchangedCount).toBe(1)
    expect(result.historyEntries).toHaveLength(0)
  })

  it('既存idでハッシュが違えば updated になり、reviewStatusはunreviewedへ戻る（HOME表示は維持しつつ再確認フラグが立つ）', () => {
    const incoming = pmdaItem({ summary: '理由B（訂正後）' })
    const existing = {
      'pmda_recall_1-1': {
        id: 'pmda_recall_1-1',
        sourceId: 'pmda_recall',
        contentHash: 'まったく別のハッシュ',
        summary: '理由A',
        firstFetchedAt: '2026-09-11T00:00:00.000Z',
        lastChangedAt: null,
        reviewStatus: 'reviewed',
        confirmedImportance: 'critical',
        importanceConfirmedBy: 'フリちゃん',
        importanceConfirmedAt: '2026-09-11T01:00:00.000Z',
        homeDisplayConfirmed: true,
        homeDisplayConfirmedBy: 'フリちゃん',
        homeDisplayConfirmedAt: '2026-09-11T01:00:00.000Z',
        homeDisplayNeedsReview: false,
      },
    }
    const result = gas.mergeSourceItems_('pmda_recall', [incoming], existing, '2026-09-14T00:00:00.000Z')
    const item = result.updatedById['pmda_recall_1-1']
    expect(item.changeStatus).toBe('updated')
    expect(item.reviewStatus).toBe('unreviewed')
    expect(item.confirmedImportance).toBeNull()
    expect(item.homeDisplayConfirmed).toBe(true) // HOME表示自体は維持
    expect(item.homeDisplayNeedsReview).toBe(true) // ただし再確認が必要と分かるようにする
    expect(result.stats.updatedCount).toBe(1)
    expect(result.historyEntries).toHaveLength(1)
    expect(result.historyEntries[0].diffNote).toBe('内容変更を検知')
  })

  it('対象外(excluded)の情報は内容が変わっても対象外のまま維持する', () => {
    const incoming = pmdaItem({ summary: '理由C（変更）' })
    const existing = {
      'pmda_recall_1-1': {
        id: 'pmda_recall_1-1',
        sourceId: 'pmda_recall',
        contentHash: '別ハッシュ',
        summary: '理由A',
        firstFetchedAt: '2026-09-11T00:00:00.000Z',
        lastChangedAt: null,
        reviewStatus: 'excluded',
        confirmedImportance: null,
        importanceConfirmedBy: null,
        importanceConfirmedAt: null,
        homeDisplayConfirmed: false,
        homeDisplayConfirmedBy: null,
        homeDisplayConfirmedAt: null,
        homeDisplayNeedsReview: false,
      },
    }
    const result = gas.mergeSourceItems_('pmda_recall', [incoming], existing, '2026-09-14T00:00:00.000Z')
    expect(result.updatedById['pmda_recall_1-1'].reviewStatus).toBe('excluded')
  })

  it('既存データのcontentHashがnull（移行直後）なら unchanged 扱いになり、確認状態を失わない', () => {
    const incoming = pmdaItem({ summary: '理由（移行後の初回取得）' })
    const existing = {
      'pmda_recall_1-1': {
        id: 'pmda_recall_1-1',
        sourceId: 'pmda_recall',
        contentHash: null,
        summary: '理由A（移行時点）',
        firstFetchedAt: '2026-09-01T00:00:00.000Z',
        lastChangedAt: null,
        reviewStatus: 'reviewed',
        confirmedImportance: 'caution',
        importanceConfirmedBy: 'フリちゃん',
        importanceConfirmedAt: '2026-09-01T01:00:00.000Z',
        homeDisplayConfirmed: false,
        homeDisplayConfirmedBy: null,
        homeDisplayConfirmedAt: null,
        homeDisplayNeedsReview: false,
      },
    }
    const result = gas.mergeSourceItems_('pmda_recall', [incoming], existing, '2026-09-14T00:00:00.000Z')
    const item = result.updatedById['pmda_recall_1-1']
    expect(item.changeStatus).toBe('unchanged')
    expect(item.reviewStatus).toBe('reviewed')
    expect(item.confirmedImportance).toBe('caution')
    expect(item.contentHash).toBe(incoming.contentHash) // 今回のハッシュで補完される
  })
})

describe('buildMhlwSupplyIncomingItems_（供給再開の検知・消失時の誤判定防止）', () => {
  function trackedState(overrides = {}) {
    return {
      id: 'mhlw_supply_YJ001',
      sourceId: 'mhlw_supply',
      sourceRecordId: 'YJ001',
      category: 'pharmacy',
      itemType: '供給',
      title: 'サンプル錠（限定出荷）',
      contentHash: 'before-hash',
      summary: '原薬不足',
      sourceName: '厚労省（医療用医薬品供給状況報告）',
      documentNumber: 'YJコード：YJ001',
      pharmacyImpact: '影響',
      aiImportance: 'caution',
      publishedAt: '2026-09-10',
      remarks: '',
      firstFetchedAt: '2026-09-10T00:00:00.000Z',
      lastChangedAt: null,
      reviewStatus: 'reviewed',
      confirmedImportance: 'caution',
      importanceConfirmedBy: 'フリちゃん',
      importanceConfirmedAt: '2026-09-10T01:00:00.000Z',
      homeDisplayConfirmed: true,
      homeDisplayConfirmedBy: 'フリちゃん',
      homeDisplayConfirmedAt: '2026-09-10T01:00:00.000Z',
      homeDisplayNeedsReview: false,
      missingStreak: 0,
      ...overrides,
    }
  }

  it('限定出荷から供給停止への悪化を検知できる', () => {
    const before = gas.buildMhlwSupplyItem_(
      'YJ001',
      { productName: 'サンプル錠', manufacturer: 'A社', volume: '80%', reason: '原薬不足', startDate: '2026-09-01', resolution: '' },
      '限定出荷',
      'https://example.com/before.xlsx',
      '2026-09-13T00:00:00.000Z',
    )
    const after = gas.buildMhlwSupplyItem_(
      'YJ001',
      { productName: 'サンプル錠', manufacturer: 'A社', volume: '0%', reason: '原薬不足の深刻化', startDate: '2026-09-01', resolution: '' },
      '供給停止',
      'https://example.com/after.xlsx',
      '2026-09-14T00:00:00.000Z',
    )
    expect(before.contentHash).not.toBe(after.contentHash)

    const existing = { mhlw_supply_YJ001: trackedState({ contentHash: before.contentHash }) }
    const result = gas.mergeSourceItems_('mhlw_supply', [after], existing, '2026-09-14T00:00:00.000Z')
    const item = result.updatedById.mhlw_supply_YJ001
    expect(item.changeStatus).toBe('updated')
    expect(item.reviewStatus).toBe('unreviewed')
    expect(item.homeDisplayConfirmed).toBe(true)
    expect(item.homeDisplayNeedsReview).toBe(true)
  })

  it('Excelで明示的に「通常出荷」と確認できた場合だけ resolved になる', () => {
    const currentByYjCode = {
      YJ001: {
        status: '通常出荷',
        fields: { productName: 'サンプル錠', manufacturer: 'A社', volume: '100%', reason: '', startDate: '2026-09-14', resolution: '' },
      },
    }
    const existingStates = { YJ001: trackedState() }
    const items = gas.buildMhlwSupplyIncomingItems_(currentByYjCode, existingStates, 'https://example.com/x.xlsx', '2026-09-14T00:00:00.000Z')
    expect(items).toHaveLength(1)
    expect(items[0].forcedChangeStatus).toBe('resolved')

    const existing = { mhlw_supply_YJ001: trackedState() }
    const result = gas.mergeSourceItems_('mhlw_supply', items, existing, '2026-09-14T00:00:00.000Z')
    const item = result.updatedById.mhlw_supply_YJ001
    expect(item.changeStatus).toBe('resolved')
    expect(result.stats.resolvedCount).toBe(1)
    expect(item.reviewStatus).toBe('unreviewed') // 再確認は必要
  })

  it('Excelから単に消えただけでは resolved にならず missing（要手動確認）になる。内容・HOME表示は前回のまま維持する', () => {
    const currentByYjCode = {} // YJ001が今回のExcelに一切登場しない
    const existingStates = { YJ001: trackedState() }
    const items = gas.buildMhlwSupplyIncomingItems_(currentByYjCode, existingStates, 'https://example.com/x.xlsx', '2026-09-14T00:00:00.000Z')
    expect(items).toHaveLength(1)
    expect(items[0].forcedChangeStatus).toBe('missing')
    expect(items[0].title).toBe('サンプル錠（限定出荷）') // 前回のタイトルをそのまま維持（不確かな新内容を作らない）
    expect(items[0].contentHash).toBe('before-hash') // 内容不明のためハッシュも維持

    const existing = { mhlw_supply_YJ001: trackedState() }
    const result = gas.mergeSourceItems_('mhlw_supply', items, existing, '2026-09-14T00:00:00.000Z')
    const item = result.updatedById.mhlw_supply_YJ001
    expect(item.changeStatus).toBe('missing')
    expect(item.reviewStatus).toBe('unreviewed') // 初回検知なので要再確認
    expect(item.homeDisplayConfirmed).toBe(true) // HOME表示は消さない
    expect(item.homeDisplayNeedsReview).toBe(true)
    expect(item.missingStreak).toBe(1)
    expect(result.stats.missingCount).toBe(1)
    expect(result.stats.resolvedCount).toBe(0)
  })

  it('2回連続でmissingになっても、2回目は確認状態を再度リセットしない（毎回アラートが再燃しない）', () => {
    const currentByYjCode = {}
    const existingStates = { YJ001: trackedState({ changeStatus: 'missing', missingStreak: 1, reviewStatus: 'reviewed', homeDisplayNeedsReview: true }) }
    const items = gas.buildMhlwSupplyIncomingItems_(currentByYjCode, existingStates, 'https://example.com/x.xlsx', '2026-09-15T00:00:00.000Z')

    const existing = {
      mhlw_supply_YJ001: trackedState({ changeStatus: 'missing', missingStreak: 1, reviewStatus: 'reviewed', homeDisplayNeedsReview: true }),
    }
    const result = gas.mergeSourceItems_('mhlw_supply', items, existing, '2026-09-15T00:00:00.000Z')
    const item = result.updatedById.mhlw_supply_YJ001
    expect(item.changeStatus).toBe('missing')
    expect(item.missingStreak).toBe(2)
    expect(item.reviewStatus).toBe('reviewed') // 前回すでに確認済みにしていたら、そのまま維持
    expect(item.homeDisplayNeedsReview).toBe(true) // 前回立てたフラグもそのまま（再度は立て直さない）
    expect(result.historyEntries).toHaveLength(0) // 2回目は履歴に追記しない（初回だけ記録）
  })

  it('再びExcelに掲載が確認できれば missingStreak は0に戻る', () => {
    const currentByYjCode = {
      YJ001: {
        status: '限定出荷',
        fields: { productName: 'サンプル錠', manufacturer: 'A社', volume: '50%', reason: '原薬不足', startDate: '2026-09-10', resolution: '' },
      },
    }
    const existingStates = { YJ001: trackedState({ changeStatus: 'missing', missingStreak: 2 }) }
    const items = gas.buildMhlwSupplyIncomingItems_(currentByYjCode, existingStates, 'https://example.com/x.xlsx', '2026-09-16T00:00:00.000Z')
    const existing = { mhlw_supply_YJ001: trackedState({ changeStatus: 'missing', missingStreak: 2 }) }
    const result = gas.mergeSourceItems_('mhlw_supply', items, existing, '2026-09-16T00:00:00.000Z')
    expect(result.updatedById.mhlw_supply_YJ001.missingStreak).toBe(0)
  })

  it('未追跡の通常出荷は一覧に出さない（通常出荷が大量に流れ込まない）', () => {
    const currentByYjCode = {
      YJ999: {
        status: '通常出荷',
        fields: { productName: '普段どおりの薬', manufacturer: 'B社', volume: '100%', reason: '', startDate: '', resolution: '' },
      },
    }
    const items = gas.buildMhlwSupplyIncomingItems_(currentByYjCode, {}, 'https://example.com/x.xlsx', '2026-09-14T00:00:00.000Z')
    expect(items).toHaveLength(0)
  })
})

describe('applyFetchResultsToState_（情報源が片方失敗しても、もう片方・失敗側の既存情報を消さない）', () => {
  function existingState(id, sourceId) {
    return {
      id,
      sourceId,
      sourceRecordId: id,
      contentHash: 'hash-' + id,
      summary: 'summary-' + id,
      firstFetchedAt: '2026-09-01T00:00:00.000Z',
      lastFetchedAt: '2026-09-13T00:00:00.000Z',
      lastChangedAt: null,
      reviewStatus: 'reviewed',
      confirmedImportance: 'caution',
      importanceConfirmedBy: 'フリちゃん',
      importanceConfirmedAt: '2026-09-01T01:00:00.000Z',
      homeDisplayConfirmed: true,
      homeDisplayConfirmedBy: 'フリちゃん',
      homeDisplayConfirmedAt: '2026-09-01T01:00:00.000Z',
      homeDisplayNeedsReview: false,
    }
  }

  it('PMDA失敗・厚労省成功でも、PMDAの既存情報はそのまま残る', () => {
    const existingById = { pmda_recall_1: existingState('pmda_recall_1', 'pmda_recall') }
    const mhlwIncoming = {
      id: 'mhlw_supply_YJ001',
      sourceRecordId: 'YJ001',
      category: 'pharmacy',
      itemType: '供給',
      title: 'サンプル錠（限定出荷）',
      summary: '原薬不足',
      aiImportance: 'caution',
      publishedAt: '2026-09-14',
      sourceName: '厚労省（医療用医薬品供給状況報告）',
      documentNumber: 'YJコード：YJ001',
      pharmacyImpact: '影響',
      requiredAction: null,
      primaryUrl: 'https://example.com/x.xlsx',
      remarks: '',
      contentHash: 'new-hash',
      fetchedAtIso: '2026-09-14T00:00:00.000Z',
      isResolvedCandidate: false,
    }
    const results = [
      { sourceId: 'pmda_recall', success: false, items: [], fetchedAt: '2026-09-14T00:00:00.000Z', error: 'HTTP 500' },
      { sourceId: 'mhlw_supply', success: true, items: [mhlwIncoming], fetchedAt: '2026-09-14T00:00:00.000Z', error: null },
    ]
    const applied = gas.applyFetchResultsToState_(existingById, results, '2026-09-14T00:00:00.000Z')
    expect(applied.updatedById.pmda_recall_1).toEqual(existingById.pmda_recall_1) // 一切変更されない
    expect(applied.updatedById.mhlw_supply_YJ001).toBeDefined()
    const pmdaLog = applied.runLogs.find((l) => l.sourceId === 'pmda_recall')
    expect(pmdaLog.success).toBe(false)
    expect(pmdaLog.errorMessage).toBe('HTTP 500')
  })

  it('厚労省失敗・PMDA成功でも、厚労省の既存情報はそのまま残る', () => {
    const existingById = { mhlw_supply_YJ001: existingState('mhlw_supply_YJ001', 'mhlw_supply') }
    const results = [
      { sourceId: 'pmda_recall', success: true, items: [], fetchedAt: '2026-09-14T00:00:00.000Z', error: null },
      { sourceId: 'mhlw_supply', success: false, items: [], fetchedAt: '2026-09-14T00:00:00.000Z', error: 'Excel取得失敗' },
    ]
    const applied = gas.applyFetchResultsToState_(existingById, results, '2026-09-14T00:00:00.000Z')
    expect(applied.updatedById.mhlw_supply_YJ001).toEqual(existingById.mhlw_supply_YJ001)
  })

  it('両方失敗したら既存情報がそのまま残る', () => {
    const existingById = {
      pmda_recall_1: existingState('pmda_recall_1', 'pmda_recall'),
      mhlw_supply_YJ001: existingState('mhlw_supply_YJ001', 'mhlw_supply'),
    }
    const results = [
      { sourceId: 'pmda_recall', success: false, items: [], fetchedAt: '2026-09-14T00:00:00.000Z', error: 'timeout' },
      { sourceId: 'mhlw_supply', success: false, items: [], fetchedAt: '2026-09-14T00:00:00.000Z', error: 'timeout' },
    ]
    const applied = gas.applyFetchResultsToState_(existingById, results, '2026-09-14T00:00:00.000Z')
    expect(applied.updatedById).toEqual(existingById)
    expect(applied.runLogs.every((l) => !l.success)).toBe(true)
  })

  it('マージは既存の全idを常に保持する（成功した情報源の対象にならないidも消えない）', () => {
    const existingById = {
      pmda_recall_1: existingState('pmda_recall_1', 'pmda_recall'),
      mhlw_supply_YJ001: existingState('mhlw_supply_YJ001', 'mhlw_supply'),
    }
    // pmda_recallは成功だが、今回のincomingにpmda_recall_1が含まれない
    // （例：PMDAのCSVからその回収番号の行が理由もなく消えた場合）
    const results = [
      { sourceId: 'pmda_recall', success: true, items: [], fetchedAt: '2026-09-14T00:00:00.000Z', error: null },
      { sourceId: 'mhlw_supply', success: false, items: [], fetchedAt: '2026-09-14T00:00:00.000Z', error: 'timeout' },
    ]
    const applied = gas.applyFetchResultsToState_(existingById, results, '2026-09-14T00:00:00.000Z')
    expect(Object.keys(applied.updatedById).sort()).toEqual(['mhlw_supply_YJ001', 'pmda_recall_1'])
  })
})

describe('入力値検証（doPostのホワイトリスト方式チェック）', () => {
  it('reviewStatusは許可された値のみ受け付ける', () => {
    expect(gas.validateUpdateItemStatusInput_({ id: 'pmda_recall_1', reviewStatus: 'reviewed' }).valid).toBe(true)
    expect(gas.validateUpdateItemStatusInput_({ id: 'pmda_recall_1', reviewStatus: 'hacked' }).valid).toBe(false)
  })

  it('confirmedImportanceは許可された値のみ受け付ける', () => {
    expect(gas.validateUpdateItemStatusInput_({ id: 'pmda_recall_1', confirmedImportance: 'critical' }).valid).toBe(true)
    expect(gas.validateUpdateItemStatusInput_({ id: 'pmda_recall_1', confirmedImportance: 'super-critical' }).valid).toBe(false)
  })

  it('idの形式が不正なら拒否する', () => {
    expect(gas.validateUpdateItemStatusInput_({ id: '../etc/passwd' }).valid).toBe(false)
    expect(gas.validateUpdateItemStatusInput_({ id: '' }).valid).toBe(false)
    expect(gas.validateUpdateItemStatusInput_({ id: 'a'.repeat(300) }).valid).toBe(false)
  })

  it('homeDisplayConfirmedはboolean以外を拒否する', () => {
    expect(gas.validateUpdateItemStatusInput_({ id: 'pmda_recall_1', homeDisplayConfirmed: 'true' }).valid).toBe(false)
    expect(gas.validateUpdateItemStatusInput_({ id: 'pmda_recall_1', homeDisplayConfirmed: true }).valid).toBe(true)
  })

  it('重要度未確定でHOME表示ONは拒否する', () => {
    const check = gas.businessRuleAllowsUpdate_({ reviewStatus: 'reviewed', confirmedImportance: null }, { homeDisplayConfirmed: true })
    expect(check.allowed).toBe(false)
  })

  it('同時にconfirmedImportanceを指定していればHOME表示ONを許可する', () => {
    const check = gas.businessRuleAllowsUpdate_(
      { reviewStatus: 'reviewed', confirmedImportance: null },
      { confirmedImportance: 'critical', homeDisplayConfirmed: true },
    )
    expect(check.allowed).toBe(true)
  })

  it('excluded(対象外)の情報への変更はすべて拒否する', () => {
    const check = gas.businessRuleAllowsUpdate_({ reviewStatus: 'excluded', confirmedImportance: null }, { reviewStatus: 'reviewed' })
    expect(check.allowed).toBe(false)
  })

  it('再確認必要(homeDisplayNeedsReview)な情報は、先に確認済みにしない限り重要度・HOME表示の変更を拒否する', () => {
    const existingState = { reviewStatus: 'unreviewed', confirmedImportance: null, homeDisplayNeedsReview: true }
    const rejectedImportance = gas.businessRuleAllowsUpdate_(existingState, { confirmedImportance: 'caution' })
    expect(rejectedImportance.allowed).toBe(false)
    const rejectedHome = gas.businessRuleAllowsUpdate_(
      { reviewStatus: 'unreviewed', confirmedImportance: 'caution', homeDisplayNeedsReview: true },
      { homeDisplayConfirmed: true },
    )
    expect(rejectedHome.allowed).toBe(false)
  })

  it('再確認必要でも、同じリクエストでreviewStatus:reviewedを含めれば重要度確定を許可する', () => {
    const check = gas.businessRuleAllowsUpdate_(
      { reviewStatus: 'unreviewed', confirmedImportance: null, homeDisplayNeedsReview: true },
      { reviewStatus: 'reviewed', confirmedImportance: 'caution' },
    )
    expect(check.allowed).toBe(true)
  })

  it('既にreviewedな情報なら、homeDisplayNeedsReviewがtrueでも通常通り重要度・HOME表示を操作できる', () => {
    const check = gas.businessRuleAllowsUpdate_(
      { reviewStatus: 'reviewed', confirmedImportance: 'caution', homeDisplayNeedsReview: true },
      { homeDisplayConfirmed: true },
    )
    expect(check.allowed).toBe(true)
  })

  it('ウォッチ設定は既知のID・許可レベル以外を拒否する', () => {
    const knownIds = ['watch_pharmacy', 'watch_clinic']
    expect(gas.validateWatchSettingsInput_([{ id: 'watch_pharmacy', level: 'home' }], knownIds).valid).toBe(true)
    expect(gas.validateWatchSettingsInput_([{ id: 'watch_unknown', level: 'home' }], knownIds).valid).toBe(false)
    expect(gas.validateWatchSettingsInput_([{ id: 'watch_pharmacy', level: 'super' }], knownIds).valid).toBe(false)
  })

  it('固定の許可ID一覧(ALLOWED_WATCH_IDS_)には4種類が含まれ、未知のIDは拒否される', () => {
    expect(gas.ALLOWED_WATCH_IDS_).toEqual(['watch_pharmacy', 'watch_clinic', 'watch_clinical', 'watch_system'])
    expect(gas.validateWatchSettingsInput_([{ id: 'watch_clinical', level: 'watch' }], gas.ALLOWED_WATCH_IDS_).valid).toBe(true)
    expect(gas.validateWatchSettingsInput_([{ id: 'watch_evil', level: 'home' }], gas.ALLOWED_WATCH_IDS_).valid).toBe(false)
  })
})

describe('pickStatesBySourceId_', () => {
  it('指定したsourceIdの行だけをsourceRecordIdをキーにして取り出す', () => {
    const existingById = {
      pmda_recall_1: { sourceId: 'pmda_recall', sourceRecordId: '1' },
      mhlw_supply_YJ001: { sourceId: 'mhlw_supply', sourceRecordId: 'YJ001' },
      mhlw_supply_YJ002: { sourceId: 'mhlw_supply', sourceRecordId: 'YJ002' },
    }
    const result = gas.pickStatesBySourceId_(existingById, 'mhlw_supply')
    expect(Object.keys(result).sort()).toEqual(['YJ001', 'YJ002'])
    expect(result.YJ001.sourceId).toBe('mhlw_supply')
  })
})

describe('sanitizeCellValue_（数式インジェクション対策）', () => {
  it('=, +, -, @ で始まる文字列の先頭にシングルクォートを付ける', () => {
    expect(gas.sanitizeCellValue_('=SUM(A1:A10)')).toBe("'=SUM(A1:A10)")
    expect(gas.sanitizeCellValue_('+81-90-1234-5678')).toBe("'+81-90-1234-5678")
    expect(gas.sanitizeCellValue_('-100mg')).toBe("'-100mg")
    expect(gas.sanitizeCellValue_('@マーク')).toBe("'@マーク")
  })

  it('通常の文字列・日付・数値はそのまま', () => {
    expect(gas.sanitizeCellValue_('通常の薬品名')).toBe('通常の薬品名')
    expect(gas.sanitizeCellValue_(123)).toBe(123)
    expect(gas.sanitizeCellValue_(true)).toBe(true)
  })
})

describe('mapRecallClassToImportance_ / mapShippingStatusToImportance_ （既存ロジックの回帰確認）', () => {
  it('クラスIはcritical、クラスIIはcaution、それ以外はinfo', () => {
    expect(gas.mapRecallClassToImportance_('（クラスI）')).toBe('critical')
    expect(gas.mapRecallClassToImportance_('（クラスII）')).toBe('caution')
    expect(gas.mapRecallClassToImportance_('（クラスIII）')).toBe('info')
  })

  it('供給停止はcritical、限定出荷はcaution、それ以外はinfo', () => {
    expect(gas.mapShippingStatusToImportance_('供給停止')).toBe('critical')
    expect(gas.mapShippingStatusToImportance_('限定出荷')).toBe('caution')
    expect(gas.mapShippingStatusToImportance_('通常出荷')).toBe('info')
  })
})

describe('filterAndFormatHistoryRows_（変更履歴の抽出・整形）', () => {
  // HISTORY_HEADER_の並び：itemId, sourceId, detectedAt, previousHash, newHash, previousSummary, newSummary, diffNote
  const rows = [
    ['item_a', 'pmda_recall_class1', '2026-09-01T00:00:00.000Z', 'h0', 'h1', '旧summary1', '新summary1', null],
    ['item_b', 'mhlw_supply', '2026-09-02T00:00:00.000Z', 'h0', 'h1', '旧summaryB', '新summaryB', null],
    ['item_a', 'pmda_recall_class1', '2026-09-10T00:00:00.000Z', 'h1', 'h2', '新summary1', '新summary2', null],
  ]

  it('指定したitemIdの行だけを抽出する', () => {
    const result = gas.filterAndFormatHistoryRows_(rows, 'item_a')
    expect(result).toHaveLength(2)
  })

  it('新しい順（detectedAt降順）に並ぶ', () => {
    const result = gas.filterAndFormatHistoryRows_(rows, 'item_a')
    expect(result[0].newSummary).toBe('新summary2')
    expect(result[1].newSummary).toBe('新summary1')
  })

  it('previousHash/newHashは画面に返す必要がないため含まない', () => {
    const result = gas.filterAndFormatHistoryRows_(rows, 'item_a')
    expect(result[0]).toEqual({
      detectedAt: '2026-09-10T00:00:00.000Z',
      previousSummary: '新summary1',
      newSummary: '新summary2',
      diffNote: null,
    })
  })

  it('該当するitemIdが無ければ空配列を返す', () => {
    expect(gas.filterAndFormatHistoryRows_(rows, 'item_not_exist')).toEqual([])
  })
})

describe('stripHtmlTags_', () => {
  it('タグを除去し、代表的なHTML実体参照を戻す', () => {
    const html = '<a href="x">2026年9月8日&nbsp;Minds関連&nbsp;<span>「大型血管炎」の診療ガイドラインを公開しました</span></a>'
    expect(gas.stripHtmlTags_(html)).toBe(
      ' 2026年9月8日 Minds関連  「大型血管炎」の診療ガイドラインを公開しました  ',
    )
  })

  it('null/undefinedは空文字として扱う', () => {
    expect(gas.stripHtmlTags_(null)).toBe('')
    expect(gas.stripHtmlTags_(undefined)).toBe('')
  })
})

describe('parseMindsNewsEntryText_', () => {
  it('日付・カテゴリを取り除いてタイトルだけを取り出す', () => {
    const result = gas.parseMindsNewsEntryText_(
      '2026年9月8日 Minds関連 「大型血管炎」の診療ガイドラインを公開しました',
    )
    expect(result).toEqual({
      publishedAt: '2026-09-08',
      title: '「大型血管炎」の診療ガイドラインを公開しました',
    })
  })

  it('1桁月日でも0埋めして正規化する', () => {
    const result = gas.parseMindsNewsEntryText_('2026年9月1日 Minds関連 「急性腹症」の診療ガイドラインを公開しました')
    expect(result.publishedAt).toBe('2026-09-01')
  })

  it('日付が見つからない場合はpublishedAtが空文字になる', () => {
    const result = gas.parseMindsNewsEntryText_('Minds関連 お知らせ本文のみ')
    expect(result.publishedAt).toBe('')
  })

  it('未知のカテゴリ表記が残ってもタイトルの「ガイドライン」判定には影響しない（先頭に余分な単語が残るだけ）', () => {
    const result = gas.parseMindsNewsEntryText_('2026年9月8日 未知カテゴリ 「熱中症」の診療ガイドラインを公開しました')
    expect(result.title).toContain('ガイドライン')
  })
})

describe('isGuidelineNewsTitle_', () => {
  it('タイトルに「ガイドライン」を含めばtrue', () => {
    expect(gas.isGuidelineNewsTitle_('「熱中症」の診療ガイドラインを公開しました')).toBe(true)
  })

  it('含まなければfalse（事務連絡ノイズの除外）', () => {
    expect(gas.isGuidelineNewsTitle_('「組織」ページを更新しました')).toBe(false)
  })

  it('文字列以外はfalse', () => {
    expect(gas.isGuidelineNewsTitle_(null)).toBe(false)
    expect(gas.isGuidelineNewsTitle_(undefined)).toBe(false)
  })
})

describe('extractMindsNewsEntries_', () => {
  const sampleHtml = `
    <ul>
      <li><a href="https://minds.jcqhc.or.jp/news-16138/">2026年9月8日 Minds関連 「大型血管炎」の診療ガイドラインを公開しました</a></li>
      <li><a href="https://minds.jcqhc.or.jp/news-16133/">2026年9月1日 Minds関連 「急性腹症」の診療ガイドラインを公開しました</a></li>
      <li><a href="https://minds.jcqhc.or.jp/news-16120/">2026年8月21日 Minds関連 「書誌情報」新規公開のお知らせ</a></li>
      <li><a href="/news-16065/">2026年7月28日 Minds関連 「組織」ページを更新しました</a></li>
    </ul>
  `

  it('お知らせごとに{newsId, url, publishedAt, title}を抽出する', () => {
    const entries = gas.extractMindsNewsEntries_(sampleHtml)
    expect(entries).toHaveLength(4)
    expect(entries[0]).toEqual({
      newsId: '16138',
      url: 'https://minds.jcqhc.or.jp/news-16138/',
      publishedAt: '2026-09-08',
      title: '「大型血管炎」の診療ガイドラインを公開しました',
    })
  })

  it('ドメイン省略の相対リンク（/news-xxxx/）も拾う', () => {
    const entries = gas.extractMindsNewsEntries_(sampleHtml)
    const found = entries.find((e) => e.newsId === '16065')
    expect(found).toBeTruthy()
    expect(found.url).toBe('https://minds.jcqhc.or.jp/news-16065/')
  })

  it('同じnewsIdへの重複リンクは1件だけ採用する', () => {
    const htmlWithDuplicate = `
      <a href="https://minds.jcqhc.or.jp/news-16138/"><img src="thumb.jpg" /></a>
      <a href="https://minds.jcqhc.or.jp/news-16138/">2026年9月8日 Minds関連 「大型血管炎」の診療ガイドラインを公開しました</a>
    `
    const entries = gas.extractMindsNewsEntries_(htmlWithDuplicate)
    expect(entries).toHaveLength(1)
    expect(entries[0].title).toBe('「大型血管炎」の診療ガイドラインを公開しました')
  })

  it('お知らせリンクが1件も無ければ空配列を返す', () => {
    expect(gas.extractMindsNewsEntries_('<html><body>no news here</body></html>')).toEqual([])
  })
})

describe('buildMindsIncomingItems_ / buildMindsGuidelineItem_', () => {
  const entries = [
    { newsId: '16138', url: 'https://minds.jcqhc.or.jp/news-16138/', publishedAt: '2026-09-08', title: '「大型血管炎」の診療ガイドラインを公開しました' },
    { newsId: '16120', url: 'https://minds.jcqhc.or.jp/news-16120/', publishedAt: '2026-08-21', title: '「書誌情報」新規公開のお知らせ' },
  ]

  it('タイトルに「ガイドライン」を含むものだけをアイテムに変換する', () => {
    const items = gas.buildMindsIncomingItems_(entries, 'https://minds.jcqhc.or.jp/news/', '2026-09-14T00:00:00.000Z')
    expect(items).toHaveLength(1)
    expect(items[0].id).toBe('minds_guideline_16138')
  })

  it('カテゴリはclinical、重要度は一律info、sourceRecordIdはnewsIdになる', () => {
    const item = gas.buildMindsGuidelineItem_(entries[0], 'https://minds.jcqhc.or.jp/news/', '2026-09-14T00:00:00.000Z')
    expect(item.category).toBe('clinical')
    expect(item.itemType).toBe('ガイドライン')
    expect(item.aiImportance).toBe('info')
    expect(item.sourceRecordId).toBe('16138')
    expect(item.primaryUrl).toBe('https://minds.jcqhc.or.jp/news-16138/')
    expect(item.title).toBe('「大型血管炎」の診療ガイドラインを公開しました')
  })

  it('同じ内容なら同じcontentHash、タイトルが変われば別ハッシュになる', () => {
    const a = gas.buildMindsGuidelineItem_(entries[0], 'x', 't')
    const b = gas.buildMindsGuidelineItem_(entries[0], 'x', 't')
    const c = gas.buildMindsGuidelineItem_({ ...entries[0], title: entries[0].title + '（訂正）' }, 'x', 't')
    expect(a.contentHash).toBe(b.contentHash)
    expect(a.contentHash).not.toBe(c.contentHash)
  })
})

describe('linkLabelForItemType_（ガイドライン追加分）', () => {
  it("itemType 'ガイドライン' はMindsのラベルを返す", () => {
    expect(gas.linkLabelForItemType_('ガイドライン')).toBe('Minds お知らせページ（原文）')
  })
})

describe('findJapaneseDateAsIso_', () => {
  it('日本語の日付をISO形式に変換する', () => {
    expect(gas.findJapaneseDateAsIso_('2026年9月7日')).toBe('2026-09-07')
  })

  it('前後にテキストがあっても最初の日付を拾う', () => {
    expect(gas.findJapaneseDateAsIso_('お知らせ 2026年1月5日 掲載')).toBe('2026-01-05')
  })

  it('日付が無ければ空文字を返す', () => {
    expect(gas.findJapaneseDateAsIso_('日付なしのテキスト')).toBe('')
    expect(gas.findJapaneseDateAsIso_(null)).toBe('')
  })
})

describe('isTreatmentRelatedAnnouncementTitle_', () => {
  it('合意済みキーワードのいずれかを含めばtrue', () => {
    expect(gas.isTreatmentRelatedAnnouncementTitle_('「2型糖尿病の薬物療法のアルゴリズム（第2版）」を発表しました')).toBe(true)
    expect(gas.isTreatmentRelatedAnnouncementTitle_('自動インスリン注入デバイス適正使用指針について')).toBe(true)
    expect(gas.isTreatmentRelatedAnnouncementTitle_('「女性のヘルスケアに関するガイダンス（中高年編）」を策定しました')).toBe(true)
    expect(gas.isTreatmentRelatedAnnouncementTitle_('糖尿病性腎症病期分類2023の策定')).toBe(true)
  })

  it('事務連絡ノイズはfalse', () => {
    expect(gas.isTreatmentRelatedAnnouncementTitle_('第37回（2026年度）糖尿病専門医受験予定の皆さまへ')).toBe(false)
    expect(gas.isTreatmentRelatedAnnouncementTitle_('事務局の年末年始休業について')).toBe(false)
    expect(gas.isTreatmentRelatedAnnouncementTitle_('「第12回若手研究助成金」：受賞者10名が決まりました')).toBe(false)
  })

  it('文字列以外はfalse', () => {
    expect(gas.isTreatmentRelatedAnnouncementTitle_(null)).toBe(false)
    expect(gas.isTreatmentRelatedAnnouncementTitle_(undefined)).toBe(false)
  })
})

describe('extractDatedAnnouncementEntries_ / buildNaikaAnnouncementLinkRegex_', () => {
  const naikaSampleHtml = `
    <li>
      2026年09月01日
      <a href="https://www.naika.or.jp/info-cat/announcement/">日本内科学会</a>
      <a href="https://www.naika.or.jp/info/20260901/"><strong>内科医リカレント教育 オンラインカンファレンス開催のお知らせ</strong></a>
    </li>
    <li>
      2026年07月23日
      <a href="https://www.naika.or.jp/info-cat/related/">関連学会・団体等</a>
      <a href="https://www.naika.or.jp/info/20260723/">「女性のヘルスケアに関するガイダンス（中高年編）」を策定しました</a>
    </li>
  `

  it('日付が別要素でもリンク直前の日付を対応付けて抽出する', () => {
    const entries = gas.extractDatedAnnouncementEntries_(naikaSampleHtml, gas.buildNaikaAnnouncementLinkRegex_())
    expect(entries).toHaveLength(2)
    expect(entries[0]).toEqual({
      id: '20260901',
      url: 'https://www.naika.or.jp/info/20260901/',
      title: '内科医リカレント教育 オンラインカンファレンス開催のお知らせ',
      publishedAt: '2026-09-01',
    })
    expect(entries[1].title).toBe('「女性のヘルスケアに関するガイダンス（中高年編）」を策定しました')
    expect(entries[1].publishedAt).toBe('2026-07-23')
  })

  it('info-cat/へのカテゴリリンクは詳細リンクとして拾わない', () => {
    const entries = gas.extractDatedAnnouncementEntries_(naikaSampleHtml, gas.buildNaikaAnnouncementLinkRegex_())
    expect(entries.some((e) => e.url.indexOf('info-cat') !== -1)).toBe(false)
  })

  it('同じidへの重複リンクは1件だけ採用する', () => {
    const dup = naikaSampleHtml + '<a href="https://www.naika.or.jp/info/20260901/">重複</a>'
    const entries = gas.extractDatedAnnouncementEntries_(dup, gas.buildNaikaAnnouncementLinkRegex_())
    expect(entries.filter((e) => e.id === '20260901')).toHaveLength(1)
  })
})

describe('extractDatedAnnouncementEntries_ / buildJdsAnnouncementLinkRegex_', () => {
  const jdsSampleHtml = `
    <li>2026年09月07日
      <a href="https://www.jds.or.jp/modules/important/index.php?content_id=546">先進糖尿病テクノロジーに関する研修（eラーニング2コース）を公開しました NEW!</a>
    </li>
    <li>2026年08月26日
      <a href="https://www.jds.or.jp/modules/important/index.php?content_id=541">制吐薬適正使用ガイドライン速報発信のお知らせ</a>
    </li>
  `

  it('末尾の"NEW!"を取り除いてタイトルを抽出する', () => {
    const entries = gas.extractDatedAnnouncementEntries_(jdsSampleHtml, gas.buildJdsAnnouncementLinkRegex_())
    const first = entries.find((e) => e.id === '546')
    expect(first.title).toBe('先進糖尿病テクノロジーに関する研修（eラーニング2コース）を公開しました')
    expect(first.publishedAt).toBe('2026-09-07')
  })

  it('ガイドライン系のタイトルもそのまま拾える', () => {
    const entries = gas.extractDatedAnnouncementEntries_(jdsSampleHtml, gas.buildJdsAnnouncementLinkRegex_())
    const second = entries.find((e) => e.id === '541')
    expect(second.title).toBe('制吐薬適正使用ガイドライン速報発信のお知らせ')
  })
})

describe('buildGakkaiIncomingItems_ / buildGakkaiAnnouncementItem_', () => {
  const entries = [
    { id: '541', url: 'https://www.jds.or.jp/modules/important/index.php?content_id=541', title: '制吐薬適正使用ガイドライン速報発信のお知らせ', publishedAt: '2026-08-26' },
    { id: '540', url: 'https://www.jds.or.jp/modules/important/index.php?content_id=540', title: '「若手グループコミュニティプロジェクト」の活動報告を掲載しました', publishedAt: '2026-08-21' },
  ]

  it('キーワードを含むものだけをアイテムに変換する', () => {
    const items = gas.buildGakkaiIncomingItems_('jds_announcement', '日本糖尿病学会', entries, '2026-09-14T00:00:00.000Z')
    expect(items).toHaveLength(1)
    expect(items[0].id).toBe('jds_announcement_541')
  })

  it('category=clinical、itemType=治療情報、重要度は一律info', () => {
    const item = gas.buildGakkaiAnnouncementItem_('jds_announcement', '日本糖尿病学会', entries[0], '2026-09-14T00:00:00.000Z')
    expect(item.category).toBe('clinical')
    expect(item.itemType).toBe('治療情報')
    expect(item.aiImportance).toBe('info')
    expect(item.sourceRecordId).toBe('541')
    expect(item.primaryUrl).toBe(entries[0].url)
    expect(item.sourceName).toBe('日本糖尿病学会（お知らせ）')
  })

  it('sourceIdが異なれば同じ元idでもitem idは衝突しない', () => {
    const jdsItem = gas.buildGakkaiAnnouncementItem_('jds_announcement', '日本糖尿病学会', entries[0], 't')
    const naikaItem = gas.buildGakkaiAnnouncementItem_('naika_announcement', '日本内科学会', entries[0], 't')
    expect(jdsItem.id).not.toBe(naikaItem.id)
  })
})

describe('linkLabelForItemType_（治療情報追加分）', () => {
  it("itemType '治療情報' は学会お知らせのラベルを返す", () => {
    expect(gas.linkLabelForItemType_('治療情報')).toBe('学会お知らせページ（原文）')
  })
})

describe('formatYearMonth_', () => {
  it('1桁月を0埋めしてYYYYMM形式にする', () => {
    expect(gas.formatYearMonth_(2026, 9)).toBe('202609')
    expect(gas.formatYearMonth_(2026, 1)).toBe('202601')
  })

  it('2桁月はそのまま', () => {
    expect(gas.formatYearMonth_(2026, 12)).toBe('202612')
  })
})

describe('mhlwHoudouYearMonthCandidates_', () => {
  it('当月→前月の順で2件返す', () => {
    const candidates = gas.mhlwHoudouYearMonthCandidates_(new Date('2026-09-14T12:00:00+09:00'))
    expect(candidates).toEqual(['202609', '202608'])
  })

  it('1月の場合、前月は前年12月になる', () => {
    const candidates = gas.mhlwHoudouYearMonthCandidates_(new Date('2026-01-05T12:00:00+09:00'))
    expect(candidates).toEqual(['202601', '202512'])
  })
})

describe('isLegalRelatedAnnouncementTitle_', () => {
  it('合意済みキーワードのいずれかを含めばtrue', () => {
    expect(gas.isLegalRelatedAnnouncementTitle_('医薬品、医療機器等の品質、有効性及び安全性の確保等に関する法律施行規則の一部改正について')).toBe(true)
    expect(gas.isLegalRelatedAnnouncementTitle_('薬局における調剤業務のあり方について')).toBe(true)
    expect(gas.isLegalRelatedAnnouncementTitle_('医薬品医療機器等法に基づく行政処分を行いました')).toBe(true)
  })

  it('薬事と関係ない発表はfalse', () => {
    expect(gas.isLegalRelatedAnnouncementTitle_('一般職業紹介状況(令和4年6月分)について')).toBe(false)
    expect(gas.isLegalRelatedAnnouncementTitle_('新型コロナウイルス感染症の患者等の発生について(検疫)')).toBe(false)
  })

  it('文字列以外はfalse', () => {
    expect(gas.isLegalRelatedAnnouncementTitle_(null)).toBe(false)
    expect(gas.isLegalRelatedAnnouncementTitle_(undefined)).toBe(false)
  })
})

describe('extractMhlwHoudouEntries_', () => {
  const mhlwSampleHtml = `
    <h3>2026年9月14日(月)掲載</h3>
    <ul>
      <li><a href="https://www.mhlw.go.jp/stf/newpage_65724.html">医薬品医療機器等法に基づく行政処分を行いました</a></li>
      <li><a href="https://www.mhlw.go.jp/stf/newpage_43964.html">産業競争力強化法に基づく「事業再編計画」の認定について</a></li>
    </ul>
    <h3>2026年9月13日(日)掲載</h3>
    <ul>
      <li><a href="https://www.mhlw.go.jp/stf/newpage_63961.html">一般職業紹介状況(令和8年8月分)について</a></li>
    </ul>
  `

  // v3.5では固定パターンのbuildMhlwHoudouLinkRegex_ + extractDatedAnnouncementEntries_だったが、
  // URLパターンが混在していて大半を拾い落とす不具合があったため、v3.5→v3.6でextractMhlwHoudouEntries_
  // （/stf/・/toukei/配下を広く拾い、直前3000文字以内に日付があるものだけ採用）に置き換えられた。
  // idは「回収番号」のような単純な数字ではなく、パス自体を'_'区切りにしたもの
  // （例：/stf/newpage_65724.html → stf_newpage_65724）になっている点に注意。
  it('日付・タイトル・URLを対応付けて抽出する（idはパスベース）', () => {
    const entries = gas.extractMhlwHoudouEntries_(mhlwSampleHtml)
    expect(entries).toHaveLength(3)
    expect(entries[0]).toEqual({
      id: 'stf_newpage_65724',
      url: 'https://www.mhlw.go.jp/stf/newpage_65724.html',
      title: '医薬品医療機器等法に基づく行政処分を行いました',
      publishedAt: '2026-09-14',
    })
    expect(entries[2].publishedAt).toBe('2026-09-13')
  })

  it('直前に日付が無いリンク（メニュー等）は除外する', () => {
    const html = '<a href="https://www.mhlw.go.jp/stf/menu.html">メニュー</a>'
    expect(gas.extractMhlwHoudouEntries_(html)).toHaveLength(0)
  })

  it('/toukei/配下のリンクも対象にする', () => {
    const html = `
      <h3>2026年9月14日(月)掲載</h3>
      <a href="/toukei/list/20-21.html">毎月勤労統計調査</a>
    `
    const entries = gas.extractMhlwHoudouEntries_(html)
    expect(entries).toHaveLength(1)
    expect(entries[0].url).toBe('https://www.mhlw.go.jp/toukei/list/20-21.html')
  })
})

describe('buildMhlwHoudouIncomingItems_ / buildMhlwHoudouItem_', () => {
  const entries = [
    { id: '65724', url: 'https://www.mhlw.go.jp/stf/newpage_65724.html', title: '医薬品医療機器等法に基づく行政処分を行いました', publishedAt: '2026-09-14' },
    { id: '43964', url: 'https://www.mhlw.go.jp/stf/newpage_43964.html', title: '産業競争力強化法に基づく「事業再編計画」の認定について', publishedAt: '2026-09-14' },
  ]

  it('キーワードを含むものだけをアイテムに変換する', () => {
    const items = gas.buildMhlwHoudouIncomingItems_(entries, '2026-09-14T00:00:00.000Z')
    expect(items).toHaveLength(1)
    expect(items[0].id).toBe('mhlw_houdou_65724')
  })

  it('category=pharmacy、itemType=行政通知、重要度は一律info', () => {
    const item = gas.buildMhlwHoudouItem_(entries[0], '2026-09-14T00:00:00.000Z')
    expect(item.category).toBe('pharmacy')
    expect(item.itemType).toBe('行政通知')
    expect(item.aiImportance).toBe('info')
    expect(item.sourceRecordId).toBe('65724')
    expect(item.primaryUrl).toBe(entries[0].url)
    expect(item.sourceName).toBe('厚生労働省（報道発表資料）')
  })
})

describe('linkLabelForItemType_（行政通知追加分）', () => {
  it("itemType '行政通知' は厚労省報道発表のラベルを返す", () => {
    expect(gas.linkLabelForItemType_('行政通知')).toBe('厚労省 報道発表資料（原文）')
  })
})

// ---- 沢井製薬お知らせ（v3.6で追加、ZIPが未追従だった部分） ----

describe('parseSawaiAnnouncementText_', () => {
  it('供給関連：日付・カテゴリ・タイトルを分離し、PDFNEW等の装飾語を除去する', () => {
    const parsed = gas.parseSawaiAnnouncementText_(
      '2026/09/14供給関連PDFNEW アレンドロン酸錠35mg「サワイ」の供給に関するお詫びとお願いPDFNEW',
    )
    expect(parsed).toEqual({
      publishedAt: '2026-09-14',
      category: '供給関連',
      title: 'アレンドロン酸錠35mg「サワイ」の供給に関するお詫びとお願い',
    })
  })

  it('回収情報セクション（カテゴリラベル無し）はcategoryが空文字になる', () => {
    const parsed = gas.parseSawaiAnnouncementText_('2026/09/10 ベタメタゾン錠0.5mg「サワイ」自主回収（クラスII）に関するお知らせ')
    expect(parsed.category).toBe('')
    expect(parsed.title).toContain('自主回収')
  })
})

describe('isSawaiSupplyOrRecallAnnouncement_', () => {
  it('カテゴリが供給関連ならtrue', () => {
    expect(gas.isSawaiSupplyOrRecallAnnouncement_({ category: '供給関連', title: 'x' })).toBe(true)
  })

  it('カテゴリが空でタイトルに回収を含むならtrue（回収情報セクション）', () => {
    expect(gas.isSawaiSupplyOrRecallAnnouncement_({ category: '', title: '自主回収のお知らせ' })).toBe(true)
  })

  it('それ以外のカテゴリ（安全性・適正使用関連等）はfalse', () => {
    expect(gas.isSawaiSupplyOrRecallAnnouncement_({ category: '安全性・適正使用関連', title: 'x' })).toBe(false)
  })
})

describe('extractSawaiAnnouncementEntries_ / buildSawaiAnnouncementItem_ / buildSawaiIncomingItems_', () => {
  const html =
    '<a href="/file/announce/2026091401.pdf">2026/09/14供給関連 アレンドロン酸錠35mg「サワイ」の供給に関するお詫びとお願いPDF</a>' +
    '<a href="/file/recall/2026091001.pdf">2026/09/10 ベタメタゾン錠0.5mg「サワイ」自主回収（クラスII）に関するお知らせPDF</a>' +
    '<a href="/product/foo.html">製品情報メニュー</a>'

  it('/file/配下のリンクだけを対象にし、パスの/を_に置き換えたidにする', () => {
    const entries = gas.extractSawaiAnnouncementEntries_(html)
    expect(entries).toHaveLength(2)
    expect(entries[0].id).toBe('file_announce_2026091401')
    expect(entries[1].category).toBe('')
  })

  it('供給関連はitemType「供給」、回収情報セクションはitemType「回収」になる', () => {
    const entries = gas.extractSawaiAnnouncementEntries_(html)
    const supplyItem = gas.buildSawaiAnnouncementItem_(entries[0], '2026-09-14T00:00:00.000Z')
    const recallItem = gas.buildSawaiAnnouncementItem_(entries[1], '2026-09-14T00:00:00.000Z')
    expect(supplyItem.itemType).toBe('供給')
    expect(supplyItem.sourceName).toBe('沢井製薬（供給関連）')
    expect(recallItem.itemType).toBe('回収')
    expect(recallItem.sourceName).toBe('沢井製薬（回収情報）')
  })

  it('供給関連・回収情報以外（安全性・適正使用関連等）はincoming変換時に除外される', () => {
    const htmlWithOther =
      html + '<a href="/file/other/2026090801.pdf">2026/09/08安全性・適正使用関連 添付文書改訂のお知らせPDF</a>'
    const entries = gas.extractSawaiAnnouncementEntries_(htmlWithOther)
    const items = gas.buildSawaiIncomingItems_(entries, '2026-09-14T00:00:00.000Z')
    expect(items).toHaveLength(2)
  })
})

// ---- 日医工お知らせ（v3.7で追加、ZIPが未追従だった部分） ----

describe('isNichiikoSupplyOrRecallTitle_', () => {
  it('合意済みキーワードを含めばtrue', () => {
    expect(gas.isNichiikoSupplyOrRecallTitle_('アトルバスタチン錠10mg「日医工」限定出荷のお知らせ')).toBe(true)
    expect(gas.isNichiikoSupplyOrRecallTitle_('○○錠 自主回収のお知らせ')).toBe(true)
  })

  it('新発売・添文改訂等の対象外お知らせはfalse', () => {
    expect(gas.isNichiikoSupplyOrRecallTitle_('新発売のお知らせ')).toBe(false)
    expect(gas.isNichiikoSupplyOrRecallTitle_('使用上の注意改訂のお知らせ')).toBe(false)
  })
})

describe('nichiikoWhatsNewYearCandidates_', () => {
  it('当年→前年の順で2件返す（日本時間基準）', () => {
    expect(gas.nichiikoWhatsNewYearCandidates_(new Date('2026-01-05T12:00:00+09:00'))).toEqual(['2026', '2025'])
    expect(gas.nichiikoWhatsNewYearCandidates_(new Date('2026-09-14T12:00:00+09:00'))).toEqual(['2026', '2025'])
  })
})

describe('extractDatedAnnouncementEntries_ / buildNichiikoAnnouncementLinkRegex_ / buildNichiikoAnnouncementItem_', () => {
  // 日付は個別記事へのリンクの外側（同じ行の別セル等）にある想定。学会お知らせ・厚労省報道発表と
  // 同じ汎用抽出関数（extractDatedAnnouncementEntries_）を使い回しているため、idはURLパスそのもの
  // （'/'を含む）になる点に注意（沢井製薬側の専用抽出関数のようなid整形はされていない）。
  const html =
    '<tr><td>2026/9/12</td><td><a href="/medicine/files/2026/09/notice001.pdf">アトルバスタチン錠10mg「日医工」自主回収のお知らせ</a></td></tr>' +
    '<a href="/medicine/expiration/index.php">使用期限一覧メニュー</a>'

  it('/medicine/files/配下のリンクだけを対象にする', () => {
    const entries = gas.extractDatedAnnouncementEntries_(html, gas.buildNichiikoAnnouncementLinkRegex_())
    expect(entries).toHaveLength(1)
    expect(entries[0].publishedAt).toBe('2026-09-12')
  })

  it('タイトルに「回収」を含むものはitemType「回収」、それ以外は「供給」になる', () => {
    const entries = gas.extractDatedAnnouncementEntries_(html, gas.buildNichiikoAnnouncementLinkRegex_())
    const item = gas.buildNichiikoAnnouncementItem_(entries[0], '2026-09-14T00:00:00.000Z')
    expect(item.itemType).toBe('回収')
    expect(item.sourceName).toBe('日医工（お知らせ）')

    const supplyEntry = { ...entries[0], id: 'x2', title: '限定出荷のお知らせ' }
    const supplyItem = gas.buildNichiikoAnnouncementItem_(supplyEntry, '2026-09-14T00:00:00.000Z')
    expect(supplyItem.itemType).toBe('供給')
  })
})

describe('linkLabelForItemType_（沢井製薬・日医工追加分）', () => {
  it('sourceIdが沢井製薬・日医工の場合はそれぞれ専用ラベルを返す', () => {
    expect(gas.linkLabelForItemType_('供給', 'sawai_announcement')).toBe('沢井製薬 お知らせ（原文）')
    expect(gas.linkLabelForItemType_('回収', 'nichiiko_announcement')).toBe('日医工 お知らせ（原文）')
  })
})
