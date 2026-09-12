/**
 * PMDA 回収情報（医薬品）取得 PoC ― CSV版（v2）
 * ------------------------------------------------------------
 * v1（HTML一覧をEUC-JPでスクレイピング）は実際に動作したが、
 * 調査の結果、PMDAは年度・クラスごとに詳細情報を含んだCSVファイルを
 * そのまま公開していることが判明したため、そちらに切り替える。
 *
 * 対象CSV：
 *   https://www.info.pmda.go.jp/kaisyuu/rcidx{年度2桁}-{クラス}{区分}.csv
 *   区分：m=医薬品等／k=医療機器
 *   例）2026年度クラスI（医薬品等）: rcidx26-1m.csv
 *
 * このCSVには一覧情報に加えて、個別の「回収の概要」ページに相当する
 * 詳細項目（回収理由、健康被害の有無、回収開始日など）が
 * すべて含まれている。つまり詳細ページを別途取得する必要がない。
 *
 * 文字コードはUTF-8（BOM付き）。GASのUtilities.parseCsvが
 * 引用符・改行を含むセルも正しく解釈してくれるため、v1のような
 * 正規表現によるHTML解析は不要になった。
 *
 * 使い方（Apps Script エディタで）：
 *   1. このファイルをスクリプトに追加（v1のコードは全部消して置き換える）
 *   2. runPmdaRecallCsvPoc を実行（初回は権限承認）
 *   3. 実行後、「PMDA_回収情報_PoC」シートに実データが入る
 *      （v1で作った同名シートがあれば、列構成が変わるため
 *       いったんシートを削除してから実行するのがおすすめ）
 */

var PMDA_RECALL_SHEET_NAME = 'PMDA_回収情報_PoC';

// CSVの列見出し（この順番で並んでいる）
var CSV_COLUMNS = [
  '回収番号',
  '掲載年月日',
  '種類',
  '回収概要作成日及び訂正日',
  'クラス分類',
  '一般的名称及び販売名',
  '対象ロット、数量及び出荷時期',
  '製造販売業者等名称',
  '回収理由',
  '危惧される具体的な健康被害',
  '回収開始日',
  '効能・効果又は用途等',
  'その他',
  '担当者及び連絡先',
  '備考',
];

/**
 * 実行用エントリーポイント。2026年度クラスI（医薬品等）を1回だけ取得してシートへ書く。
 */
function runPmdaRecallCsvPoc() {
  var fiscalYear2Digit = '26'; // 2026年度
  var recallClass = 1; // クラスI
  var url =
    'https://www.info.pmda.go.jp/kaisyuu/rcidx' +
    fiscalYear2Digit +
    '-' +
    recallClass +
    'm.csv';

  Logger.log('取得先: ' + url);

  var rows = fetchAndParseCsv_(url);
  if (!rows) {
    Logger.log('取得または解析に失敗しました。');
    return;
  }
  Logger.log('データ行数（見出しを除く）: ' + rows.length);

  if (rows.length === 0) {
    Logger.log('1件もデータがありませんでした。URLやCSVの形式を確認してください。');
    return;
  }

  writeRowsToSheet_(rows, url);
}

/**
 * CSVを取得し、UTF-8として解釈したうえでGAS標準のCSVパーサで配列に変換する。
 * 先頭のBOM（文字化けの原因になりがちな不可視文字）も取り除く。
 */
function fetchAndParseCsv_(url) {
  try {
    var response = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      followRedirects: true,
    });
    var code = response.getResponseCode();
    if (code !== 200) {
      Logger.log('HTTPステータスが200以外: ' + code);
      return null;
    }

    var text = response.getContentText('UTF-8');
    // 先頭のBOM（\uFEFF）を除去
    if (text.charCodeAt(0) === 0xfeff) {
      text = text.substring(1);
    }

    var table = Utilities.parseCsv(text);
    if (!table || table.length < 2) {
      Logger.log('CSVの行数が想定より少ない');
      return [];
    }

    // 1行目は見出し。想定した列数と合っているか軽く確認しておく。
    var header = table[0];
    if (header.length !== CSV_COLUMNS.length) {
      Logger.log(
        '警告：見出しの列数が想定(' +
          CSV_COLUMNS.length +
          ')と異なる(' +
          header.length +
          ')。PMDA側でCSVの形式が変わった可能性がある。',
      );
    }

    return table.slice(1); // 見出しを除いたデータ行
  } catch (e) {
    Logger.log('取得・解析中にエラー: ' + e);
    return null;
  }
}

/**
 * 取得結果をスプレッドシートへ書き出す。
 * 重複判定：回収番号（例："1-2489"）はPMDA側が発行する一意な番号なので、
 * これだけで重複チェックができる（v1で使っていた複合キーより確実）。
 */
function writeRowsToSheet_(rows, sourceUrl) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(PMDA_RECALL_SHEET_NAME);
  var isNewSheet = false;
  if (!sheet) {
    sheet = ss.insertSheet(PMDA_RECALL_SHEET_NAME);
    isNewSheet = true;
  }

  var header = ['取得日時'].concat(CSV_COLUMNS).concat(['取得元URL']);

  if (isNewSheet) {
    sheet.appendRow(header);
    sheet.setFrozenRows(1);
  }

  var existingRecallNumbers = loadExistingRecallNumbers_(sheet);
  var fetchedAt = new Date();
  var appended = 0;
  var skippedDuplicate = 0;

  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var recallNumber = row[0]; // 回収番号は1列目

    if (existingRecallNumbers[recallNumber]) {
      skippedDuplicate++;
      continue;
    }

    var outRow = [fetchedAt].concat(row).concat([sourceUrl]);
    sheet.appendRow(outRow);
    existingRecallNumbers[recallNumber] = true;
    appended++;
  }

  Logger.log(
    '書き込み完了：新規 ' + appended + ' 件、重複スキップ ' + skippedDuplicate + ' 件',
  );
}

function loadExistingRecallNumbers_(sheet) {
  var keys = {};
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return keys;

  // 回収番号は「取得日時」の次、つまりB列
  var values = sheet.getRange(2, 2, lastRow - 1, 1).getValues();
  for (var i = 0; i < values.length; i++) {
    keys[values[i][0]] = true;
  }
  return keys;
}

/* ============================================================
 * ここから：CSV行 → medical-info-watch の information_items 形式への変換
 * ============================================================ */

var INFO_ITEMS_SHEET_NAME = '情報アイテム変換結果';

// CSVの「クラス分類」列（例："（クラスI）"）→ アプリの重要度候補
function mapRecallClassToImportance_(recallClassLabel) {
  if (recallClassLabel.indexOf('クラスI') !== -1 && recallClassLabel.indexOf('クラスII') === -1 && recallClassLabel.indexOf('クラスIII') === -1) {
    return 'critical'; // クラスI（重篤な健康被害・死亡の恐れ）
  }
  if (recallClassLabel.indexOf('クラスII') !== -1) {
    return 'caution'; // クラスII
  }
  return 'info'; // クラスIII、または判定不能
}

// CSVの「掲載年月日」列（例："'2026/06/26"）→ "2026-06-26" 形式
function normalizePublishedAt_(rawDate) {
  var cleaned = rawDate.replace(/^'/, '').trim();
  var match = cleaned.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (!match) return cleaned; // 形式が想定と違う場合はそのまま返す
  var y = match[1];
  var m = ('0' + match[2]).slice(-2);
  var d = ('0' + match[3]).slice(-2);
  return y + '-' + m + '-' + d;
}

/**
 * CSVの1行（配列）を、アプリのInformationItem型と同じ形のオブジェクトへ変換する。
 * 列の並びはCSV_COLUMNSの順番と一致している前提。
 */
function mapCsvRowToInformationItem_(row, listPageUrl) {
  var recallNumber = row[0];
  var publishedAtRaw = row[1];
  var itemKind = row[2]; // 医薬品／医療機器／化粧品／医薬部外品
  var recallClassLabel = row[4]; // （クラスI）等
  var nameAndProduct = row[5]; // 一般的名称及び販売名（改行区切りの文章）
  var lotInfo = row[6];
  var manufacturer = row[7];
  var reason = row[8];
  var healthRisk = row[9];
  var startDate = row[10];
  var remarks = row[14];

  var importance = mapRecallClassToImportance_(recallClassLabel);

  // 「一般的名称及び販売名」の中から販売名らしき行をタイトルに使う
  var titleLine = nameAndProduct.split('\n').filter(function (line) {
    return line.indexOf('販売名') !== -1;
  })[0] || nameAndProduct.split('\n')[0] || '(タイトル不明)';
  var title = titleLine.replace(/^.*[：:]\s*/, '').trim() + '（自主回収）';

  return {
    id: 'pmda_recall_' + recallNumber,
    category: 'pharmacy',
    itemType: '回収',
    title: title,
    summary: reason.trim(),
    aiImportance: importance,
    confirmedImportance: null,
    importanceConfirmedBy: null,
    importanceConfirmedAt: null,
    reviewStatus: 'unreviewed',
    publishedAt: normalizePublishedAt_(publishedAtRaw),
    fetchedAt: new Date().toISOString(),
    sourceName: 'PMDA（' + itemKind + '）',
    documentNumber: '回収番号：' + recallNumber,
    pharmacyImpact: healthRisk.trim() + (manufacturer ? '\n\n【製造販売業者】\n' + manufacturer.trim() : ''),
    requiredAction: lotInfo ? '対象ロットの確認：\n' + lotInfo.trim() : null,
    actionDeadline: null,
    homeDisplayConfirmed: false,
    homeDisplayConfirmedBy: null,
    homeDisplayConfirmedAt: null,
    links: [
      { label: 'PMDA 回収情報一覧（原文・該当年度/クラス）', url: listPageUrl, kind: 'primary' },
    ],
    fetchError: null,
    _remarks: remarks, // 参考：備考欄（回収終了かどうか等）はアプリの型にまだ無いので別枠で保持
  };
}

/**
 * 2026年度クラスI（存在しなければ2025年度）を取得し、information_items形式の配列にして返す。
 * シートへの書き込みは行わない（runConvertPmdaRecallToInformationItems / runConvertAllToInformationItems から呼ばれる）。
 */
function fetchPmdaRecallItems_() {
  var candidates = [
    { fiscalYear2Digit: '26', recallClass: 1 },
    { fiscalYear2Digit: '25', recallClass: 1 },
  ];

  var rows = null;
  var usedUrl = null;

  for (var i = 0; i < candidates.length; i++) {
    var c = candidates[i];
    var url =
      'https://www.info.pmda.go.jp/kaisyuu/rcidx' + c.fiscalYear2Digit + '-' + c.recallClass + 'm.csv';
    Logger.log('試行: ' + url);
    var result = fetchAndParseCsv_(url);
    if (result && result.length > 0) {
      rows = result;
      usedUrl = url;
      Logger.log('成功: ' + url + '（' + result.length + '件）');
      break;
    }
  }

  if (!rows) {
    Logger.log('PMDA回収情報：どの候補URLからも取得できませんでした。');
    return [];
  }

  var listPageUrl = usedUrl.replace('.csv', '.html');
  return rows.map(function (row) {
    return mapCsvRowToInformationItem_(row, listPageUrl);
  });
}

/**
 * PMDA回収情報だけを取得してシートに書き出す（従来どおりの単体実行用に残してある）。
 * 両方まとめて取得したい場合は runConvertAllToInformationItems を使うこと。
 */
function runConvertPmdaRecallToInformationItems() {
  var items = fetchPmdaRecallItems_();
  if (items.length === 0) {
    Logger.log('書き込むデータがありませんでした。');
    return;
  }
  writeInformationItemsToSheet_(items);
}

/* ============================================================
 * ここから：厚労省「医療用医薬品供給状況報告」（限定出荷・供給停止）取得
 * ============================================================
 * 出典ページ（従来のExcel公開）：
 *   https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/kenkou_iryou/iryou/kouhatu-iyaku/04_00003.html
 * 新システム（iyakuhin-kyokyu.mhlw.go.jp）はbot対策で単純取得ができないが、
 * このExcel公開ページは新システム稼働後も継続更新される旨、厚労省の事務連絡に
 * 明記されているため、こちらから取得する。
 *
 * ページ内に、その時点の最新Excelファイルへのリンクが
 *   https://www.mhlw.go.jp/content/10800000/{日付6桁}iyakuhinkyoukyu.xlsx
 * という形で埋め込まれている（ファイル名の日付部分は毎回変わるため、
 * 固定URLを直接指定せず、毎回ページから探し直す）。
 *
 * 事前準備（Apps Scriptエディタで1回だけ）：
 *   左側メニューの「サービス」（+アイコン）→「Drive API」を追加しておくこと。
 *   xlsxファイルをGoogleスプレッドシートに変換して中身を読むために必要。
 */

var MHLW_SUPPLY_PAGE_URL =
  'https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/kenkou_iryou/iryou/kouhatu-iyaku/04_00003.html';

/** 供給状況ページを開いて、その時点の最新Excelファイルへのリンクを探す。 */
function findLatestMhlwSupplyXlsxUrl_() {
  var response = UrlFetchApp.fetch(MHLW_SUPPLY_PAGE_URL, { muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) {
    Logger.log('供給状況ページの取得に失敗: HTTP ' + response.getResponseCode());
    return null;
  }
  var html = response.getContentText('UTF-8');
  // hrefが絶対URL（https://www.mhlw.go.jp/content/...）の場合と、
  // ドメインを省略した相対パス（/content/...）だけの場合の両方に対応する。
  var match = html.match(/(?:https:\/\/www\.mhlw\.go\.jp)?\/content\/10800000\/\d{6}iyakuhinkyoukyu\.xlsx/);
  if (!match) {
    Logger.log('供給状況ページ内にExcelファイルへのリンクが見つかりませんでした（ページ構成が変わった可能性）。');
    var hintIndex = html.indexOf('iyakuhinkyoukyu');
    if (hintIndex !== -1) {
      Logger.log('参考：該当箇所付近のHTML → ' + html.substring(Math.max(0, hintIndex - 80), hintIndex + 40));
    } else {
      Logger.log('参考："iyakuhinkyoukyu"という文字列自体がページ内に見つかりませんでした。');
    }
    return null;
  }
  var found = match[0];
  return found.indexOf('http') === 0 ? found : 'https://www.mhlw.go.jp' + found;
}

/**
 * 供給状況Excelを取得し、Googleスプレッドシートに変換してから中身を配列で返す。
 * 変換用に作った一時ファイルは読み終わったら削除する。
 * 戻り値は { values: 2次元配列, sourceUrl: string } または null（失敗時）。
 */
function fetchMhlwSupplyRawTable_() {
  var xlsxUrl = findLatestMhlwSupplyXlsxUrl_();
  if (!xlsxUrl) return null;

  Logger.log('供給状況Excel取得先: ' + xlsxUrl);
  var xlsxResponse = UrlFetchApp.fetch(xlsxUrl, { muteHttpExceptions: true });
  if (xlsxResponse.getResponseCode() !== 200) {
    Logger.log('Excelファイルの取得に失敗: HTTP ' + xlsxResponse.getResponseCode());
    return null;
  }

  var blob = xlsxResponse.getBlob();
  var tempFileId = null;
  try {
    // xlsx→Googleスプレッドシートへの変換。Drive APIの高度なサービスが必要。
    var tempFile = Drive.Files.create(
      { name: '_一時_供給状況変換用_' + new Date().getTime(), mimeType: MimeType.GOOGLE_SHEETS },
      blob,
    );
    tempFileId = tempFile.id;

    var tempSpreadsheet = SpreadsheetApp.openById(tempFileId);
    var sheet = tempSpreadsheet.getSheets()[0];
    var values = sheet.getDataRange().getValues();
    return { values: values, sourceUrl: xlsxUrl };
  } catch (e) {
    Logger.log(
      'Excel変換・読み込み中にエラー: ' + e +
        '（「サービス」にDrive APIを追加し忘れていないか確認してください）',
    );
    return null;
  } finally {
    if (tempFileId) {
      try {
        Drive.Files.remove(tempFileId); // 変換用の一時ファイルはDriveに残さず削除
      } catch (e2) {
        Logger.log('一時ファイルの削除に失敗（Driveに残っている可能性、手動で削除してください）: ' + e2);
      }
    }
  }
}

/**
 * 先頭付近の行から、見出し（「出荷対応」という文字を含む行）を探す。
 * 政府系Excelはタイトル行が上に何行か入っていることが多いため、決め打ちにしない。
 */
function findMhlwSupplyHeaderRowIndex_(values) {
  var searchLimit = Math.min(values.length, 15);
  for (var r = 0; r < searchLimit; r++) {
    var rowText = values[r].join(' ');
    if (rowText.indexOf('出荷対応') !== -1) {
      return r;
    }
  }
  return -1;
}

/** 見出し行のテキストから、必要な列の位置を名前で探す（列の並びが変わっても対応できるように）。 */
function findMhlwSupplyColumnIndices_(headerRow) {
  var idx = {};
  for (var i = 0; i < headerRow.length; i++) {
    var label = String(headerRow[i] || '').trim();
    if (!label) continue;
    if (idx.yjCode === undefined && label.indexOf('YJコード') !== -1) idx.yjCode = i;
    if (idx.genericName === undefined && label.indexOf('一般名') !== -1) idx.genericName = i;
    if (
      idx.productName === undefined &&
      (label.indexOf('販売名') !== -1 || label.indexOf('品名') !== -1) &&
      label.indexOf('一般') === -1
    ) idx.productName = i;
    if (
      idx.manufacturer === undefined &&
      (label.indexOf('製造販売業者') !== -1 || label.indexOf('会社名') !== -1)
    ) idx.manufacturer = i;
    if (idx.shippingStatus === undefined && label.indexOf('出荷対応') !== -1) idx.shippingStatus = i;
    if (idx.shippingVolume === undefined && label.indexOf('出荷量') !== -1) idx.shippingVolume = i;
    if (idx.reason === undefined && label.indexOf('理由') !== -1) idx.reason = i;
    if (idx.startDate === undefined && label.indexOf('対応開始') !== -1) idx.startDate = i;
    if (idx.resolution === undefined && label.indexOf('解消') !== -1) idx.resolution = i;
  }
  return idx;
}

/** 「出荷対応」列の文言→アプリの重要度候補。通常出荷はそもそも一覧に含めない想定。 */
function mapShippingStatusToImportance_(status) {
  if (status.indexOf('供給停止') !== -1) return 'critical';
  if (status.indexOf('限定出荷') !== -1) return 'caution';
  return 'info';
}

/** セルの値（Date型 or 文字列）を "YYYY-MM-DD" 相当の文字列に揃える。分からない形式ならそのまま返す。 */
function formatMhlwDateCell_(value) {
  if (!value) return '';
  if (value instanceof Date) {
    return Utilities.formatDate(value, 'Asia/Tokyo', 'yyyy-MM-dd');
  }
  return String(value).trim();
}

function mapSupplyRowToInformationItem_(row, idx, xlsxUrl) {
  var yjCode = idx.yjCode !== undefined ? String(row[idx.yjCode] || '').trim() : '';
  var productName = idx.productName !== undefined ? String(row[idx.productName] || '').trim() : '';
  var genericName = idx.genericName !== undefined ? String(row[idx.genericName] || '').trim() : '';
  var manufacturer = idx.manufacturer !== undefined ? String(row[idx.manufacturer] || '').trim() : '';
  var status = idx.shippingStatus !== undefined ? String(row[idx.shippingStatus] || '').trim() : '';
  var volume = idx.shippingVolume !== undefined ? String(row[idx.shippingVolume] || '').trim() : '';
  var reason = idx.reason !== undefined ? String(row[idx.reason] || '').trim() : '';
  var startDate = idx.startDate !== undefined ? formatMhlwDateCell_(row[idx.startDate]) : '';
  var resolution = idx.resolution !== undefined ? formatMhlwDateCell_(row[idx.resolution]) : '';

  var displayName = productName || genericName || '(品名不明)';
  var title = displayName + '（' + (status || '供給状況') + '）';

  return {
    id: 'mhlw_supply_' + (yjCode || displayName),
    category: 'pharmacy',
    itemType: '供給',
    title: title,
    summary: reason || status,
    aiImportance: mapShippingStatusToImportance_(status),
    confirmedImportance: null,
    importanceConfirmedBy: null,
    importanceConfirmedAt: null,
    reviewStatus: 'unreviewed',
    publishedAt: startDate,
    fetchedAt: new Date().toISOString(),
    sourceName: '厚労省（医療用医薬品供給状況報告）',
    documentNumber: yjCode ? 'YJコード：' + yjCode : null,
    pharmacyImpact:
      '出荷量：' + (volume || '不明') + (manufacturer ? '\n\n【製造販売業者】\n' + manufacturer : ''),
    requiredAction: resolution ? '解消見込み：' + resolution : null,
    actionDeadline: null,
    homeDisplayConfirmed: false,
    homeDisplayConfirmedBy: null,
    homeDisplayConfirmedAt: null,
    links: [
      { label: '厚労省 医療用医薬品供給状況（Excel原本）', url: xlsxUrl, kind: 'primary' },
    ],
    fetchError: null,
    _remarks: '',
  };
}

/**
 * 供給状況Excelを取得し、「限定出荷」「供給停止」の品目だけをinformation_items形式の配列にして返す。
 * 「通常出荷」の品目（大半を占める）はそもそも一覧に含めない。
 */
function fetchMhlwSupplyItems_() {
  var table = fetchMhlwSupplyRawTable_();
  if (!table) return [];

  var values = table.values;
  var headerRowIndex = findMhlwSupplyHeaderRowIndex_(values);
  if (headerRowIndex === -1) {
    Logger.log('供給状況Excel：見出し行（「出荷対応」を含む行）が見つかりませんでした。');
    return [];
  }

  var idx = findMhlwSupplyColumnIndices_(values[headerRowIndex]);
  if (idx.shippingStatus === undefined) {
    Logger.log('供給状況Excel：「出荷対応」列の位置が特定できませんでした。');
    return [];
  }

  var items = [];
  for (var r = headerRowIndex + 1; r < values.length; r++) {
    var row = values[r];
    var status = String(row[idx.shippingStatus] || '').trim();
    if (!status) continue;
    if (status.indexOf('限定出荷') === -1 && status.indexOf('供給停止') === -1) continue; // 通常出荷は除外

    items.push(mapSupplyRowToInformationItem_(row, idx, table.sourceUrl));
  }

  Logger.log('供給状況：限定出荷・供給停止 ' + items.length + ' 件（見出し行: ' + (headerRowIndex + 1) + '行目）');
  return items;
}

/** 供給状況だけを取得してシートに書き出す（動作確認用の単体実行）。 */
function runConvertMhlwSupplyToInformationItems() {
  var items = fetchMhlwSupplyItems_();
  if (items.length === 0) {
    Logger.log('書き込むデータがありませんでした。');
    return;
  }
  writeInformationItemsToSheet_(items);
}

/**
 * PMDA回収情報 と 厚労省供給状況（限定出荷・供給停止） の両方を取得し、
 * まとめて「情報アイテム変換結果」シートに書き出す。今後はこれを実行すればよい。
 */
function runConvertAllToInformationItems() {
  var recallItems = fetchPmdaRecallItems_();
  var supplyItems = fetchMhlwSupplyItems_();
  var allItems = recallItems.concat(supplyItems);

  if (allItems.length === 0) {
    Logger.log('取得できたデータがありませんでした（回収情報・供給状況とも0件）。');
    return;
  }

  Logger.log('回収情報 ' + recallItems.length + ' 件 + 供給状況 ' + supplyItems.length + ' 件 = 合計 ' + allItems.length + ' 件');
  writeInformationItemsToSheet_(allItems);
}

/**
 * シートから読んだ「取得日時」の値をISO文字列に揃える。
 * Google Sheetsは日時っぽい文字列を自動でDate型に変換してしまうことがあるため、
 * Date型・文字列どちらで来ても同じ形式に正規化する。
 */
function normalizeFetchedAtValue_(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

/**
 * 「情報アイテム変換結果」シートの列数（id〜homeDisplayConfirmedAtまで）。
 * doGet・doPost・writeInformationItemsToSheet_ で共通して使う。
 */
var INFO_ITEMS_COLUMN_COUNT = 21;

function writeInformationItemsToSheet_(items) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(INFO_ITEMS_SHEET_NAME);

  // 既存シートがあれば、idごとの「これまでの取得日時」と「人間が入力した確認状態」を
  // 先に読み取っておく。CSV/Excelを再取得するたびに毎回シートを作り直す関係で、
  // これをしないと「本日の取得」バグの再発だけでなく、せっかく確認・確定した内容や
  // HOME表示設定まで再取得のたびに消えてしまう。
  var previousStateById = {};
  if (sheet) {
    var existingLastRow = sheet.getLastRow();
    if (existingLastRow >= 2) {
      var existingValues = sheet.getRange(2, 1, existingLastRow - 1, INFO_ITEMS_COLUMN_COUNT).getValues();
      for (var i = 0; i < existingValues.length; i++) {
        var row = existingValues[i];
        var existingId = row[0];
        if (!existingId) continue;
        previousStateById[existingId] = {
          fetchedAt: normalizeFetchedAtValue_(row[14]),
          reviewStatus: row[6] || null,
          confirmedImportance: row[15] || null,
          importanceConfirmedBy: row[16] || null,
          importanceConfirmedAt: normalizeFetchedAtValue_(row[17]),
          homeDisplayConfirmed: row[18] === true || row[18] === 'TRUE',
          homeDisplayConfirmedBy: row[19] || null,
          homeDisplayConfirmedAt: normalizeFetchedAtValue_(row[20]),
        };
      }
    }
    ss.deleteSheet(sheet); // 変換結果は毎回作り直す（列の並びやCSVの内容が変わっても対応しやすいように）
  }
  sheet = ss.insertSheet(INFO_ITEMS_SHEET_NAME);

  var header = [
    'id', 'category', 'itemType', 'title', 'summary', 'aiImportance',
    'reviewStatus', 'publishedAt', 'sourceName', 'documentNumber',
    'pharmacyImpact', 'requiredAction', '原資料URL', '備考(_remarks)', '取得日時',
    'confirmedImportance', 'importanceConfirmedBy', 'importanceConfirmedAt',
    'homeDisplayConfirmed', 'homeDisplayConfirmedBy', 'homeDisplayConfirmedAt',
  ];

  // 1行ずつappendRowするとAPI呼び出しが件数分発生し、数百〜数千件になると
  // 実行時間の上限（6分）を超えてタイムアウトする。まとめて配列を作ってから
  // 1回のsetValuesで書き込む（数千件でも数秒で終わる）。
  var rows = items.map(function (item) {
    var prev = previousStateById[item.id];
    var fetchedAt = (prev && prev.fetchedAt) || item.fetchedAt;
    // 確認状態・重要度確定・HOME表示は、既に見たことのあるidなら前回の値をそのまま引き継ぐ。
    // 新規のidだけ、変換直後の初期値（未確認・未確定）を使う。
    var reviewStatus = prev ? prev.reviewStatus : item.reviewStatus;
    var confirmedImportance = prev ? prev.confirmedImportance : null;
    var importanceConfirmedBy = prev ? prev.importanceConfirmedBy : null;
    var importanceConfirmedAt = prev ? prev.importanceConfirmedAt : null;
    var homeDisplayConfirmed = prev ? prev.homeDisplayConfirmed : false;
    var homeDisplayConfirmedBy = prev ? prev.homeDisplayConfirmedBy : null;
    var homeDisplayConfirmedAt = prev ? prev.homeDisplayConfirmedAt : null;

    return [
      item.id,
      item.category,
      item.itemType,
      item.title,
      item.summary,
      item.aiImportance,
      reviewStatus,
      item.publishedAt,
      item.sourceName,
      item.documentNumber,
      item.pharmacyImpact,
      item.requiredAction,
      item.links[0].url,
      item._remarks,
      fetchedAt,
      confirmedImportance,
      importanceConfirmedBy,
      importanceConfirmedAt,
      homeDisplayConfirmed,
      homeDisplayConfirmedBy,
      homeDisplayConfirmedAt,
    ];
  });

  sheet.getRange(1, 1, 1, header.length).setValues([header]);
  sheet.setFrozenRows(1);
  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, header.length).setValues(rows);
  }

  Logger.log(INFO_ITEMS_SHEET_NAME + ' シートに ' + items.length + ' 件書き込みました。');
}

/* ============================================================
 * Web App化：外部（medical-info-watchアプリ）からJSONで読めるようにする
 * ============================================================
 * デプロイ手順：
 *   1. 右上「デプロイ」→「新しいデプロイ」
 *   2. 種類の選択（歯車アイコン）→「ウェブアプリ」
 *   3. 「次のユーザーとして実行」→ 自分
 *      「アクセスできるユーザー」→ 全員
 *   4. 「デプロイ」→ 権限の承認 → 発行されたURLをコピー
 *   5. そのURLをブラウザで直接開くと、JSONがそのまま表示されれば成功
 *
 * 注意：このURLは「情報アイテム変換結果」シートの中身をそのまま返す。
 * 新しいデータにしたい場合は、先に runConvertAllToInformationItems
 *（PMDA回収情報＋厚労省供給状況の両方をまとめて取得）を実行してシートを更新してから、
 * このURLを開き直す（自動更新ではない）。
 */
function doGet(e) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(INFO_ITEMS_SHEET_NAME);

  if (!sheet) {
    return jsonResponse_({
      error: '「情報アイテム変換結果」シートがありません。先に runConvertPmdaRecallToInformationItems を実行してください。',
    });
  }

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return jsonResponse_({ items: [], watchSettings: getWatchSettings_() });
  }

  var values = sheet.getRange(2, 1, lastRow - 1, INFO_ITEMS_COLUMN_COUNT).getValues();
  var now = new Date().toISOString();

  var items = values.map(function (row) {
    // row[14]（取得日時）は、このidを最初に発見した時点の日時
    // （writeInformationItemsToSheet_が過去の値を引き継いでいる）。
    // このカラムが無かった古いシートの名残でnull/空になっている場合だけ、
    // フォールバックとして今の時刻を使う。
    var fetchedAtIso = normalizeFetchedAtValue_(row[14]) || now;

    return {
      id: row[0],
      category: row[1],
      itemType: row[2],
      title: row[3],
      summary: row[4],
      aiImportance: row[5],
      confirmedImportance: row[15] || null,
      importanceConfirmedBy: row[16] || null,
      importanceConfirmedAt: normalizeFetchedAtValue_(row[17]),
      reviewStatus: row[6] || 'unreviewed',
      publishedAt: row[7],
      fetchedAt: fetchedAtIso,
      sourceName: row[8],
      documentNumber: row[9],
      pharmacyImpact: row[10],
      requiredAction: row[11] || null,
      actionDeadline: null,
      homeDisplayConfirmed: row[18] === true || row[18] === 'TRUE',
      homeDisplayConfirmedBy: row[19] || null,
      homeDisplayConfirmedAt: normalizeFetchedAtValue_(row[20]),
      links: row[12]
        ? [{ label: linkLabelForItemType_(row[2]), url: row[12], kind: 'primary' }]
        : [],
    };
  });

  return jsonResponse_({ items: items, generatedAt: now, watchSettings: getWatchSettings_() });
}

/** itemType（'回収' / '供給' 等）から、リンクの見出しに使うラベルを決める。 */
function linkLabelForItemType_(itemType) {
  if (itemType === '供給') return '厚労省 医療用医薬品供給状況（Excel原本）';
  return 'PMDA 回収情報一覧（原文）';
}

/* ============================================================
 * ここから：ウォッチ設定・確認状態の永続化
 * ============================================================
 * ウォッチ設定（薬局業務ウォッチのON/OFF・HOME表示等）は施設単位の設定なので、
 * スクリプトのプロパティ（PropertiesService）にJSONとして保存する。
 * 個々の情報の確認状態・重要度確定・HOME表示確定は、
 * 「情報アイテム変換結果」シートの該当行を直接更新する（doPost経由）。
 */

var WATCH_SETTINGS_PROPERTY_KEY = 'WATCH_SETTINGS_JSON';

/** 保存されているウォッチ設定を返す。未設定ならnull（アプリ側の初期値を使う）。 */
function getWatchSettings_() {
  var stored = PropertiesService.getScriptProperties().getProperty(WATCH_SETTINGS_PROPERTY_KEY);
  if (!stored) return null;
  try {
    return JSON.parse(stored);
  } catch (e) {
    Logger.log('ウォッチ設定の読み込みに失敗（保存されている内容が壊れている可能性）: ' + e);
    return null;
  }
}

function saveWatchSettings_(settings) {
  PropertiesService.getScriptProperties().setProperty(WATCH_SETTINGS_PROPERTY_KEY, JSON.stringify(settings));
}

/**
 * アプリからの更新（内容確認・重要度確定・HOME表示確定・ウォッチ設定変更）を受け取る。
 * リクエストはContent-Type: text/plain で送られてくる想定（JSONにするとブラウザが
 * 送るプリフライト確認にGAS側のWeb Appが対応していないため失敗する）。中身はJSON文字列。
 */
function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);

    if (body.action === 'updateItemStatus') {
      updateItemStatusInSheet_(body);
      return jsonResponse_({ ok: true });
    }

    if (body.action === 'updateWatchSettings') {
      saveWatchSettings_(body.settings);
      return jsonResponse_({ ok: true });
    }

    return jsonResponse_({ ok: false, error: '不明なaction: ' + body.action });
  } catch (err) {
    Logger.log('doPost処理中にエラー: ' + err);
    return jsonResponse_({ ok: false, error: String(err) });
  }
}

/**
 * 「情報アイテム変換結果」シートの、指定idの行を1件だけ更新する。
 * body には更新したいフィールドだけを入れて送ればよい（未指定のフィールドは変更しない）：
 *   { id, reviewStatus?, confirmedImportance?, homeDisplayConfirmed?, confirmedBy? }
 * confirmedImportance または homeDisplayConfirmed を指定した場合は、
 * 対応する「確定した人」「確定日時」も自動で一緒に書き込む。
 */
function updateItemStatusInSheet_(body) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(INFO_ITEMS_SHEET_NAME);
  if (!sheet) {
    throw new Error('「情報アイテム変換結果」シートがありません。先にrunConvertAllToInformationItemsを実行してください。');
  }

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    throw new Error('「情報アイテム変換結果」シートにデータがありません。');
  }

  var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  var targetRow = -1;
  for (var i = 0; i < ids.length; i++) {
    if (ids[i][0] === body.id) {
      targetRow = i + 2; // 1行目は見出し、配列は0始まりなので+2
      break;
    }
  }
  if (targetRow === -1) {
    throw new Error('指定されたidの行が見つかりません: ' + body.id);
  }

  var now = new Date().toISOString();

  if (body.reviewStatus !== undefined) {
    sheet.getRange(targetRow, 7).setValue(body.reviewStatus); // reviewStatus列
  }
  if (body.confirmedImportance !== undefined) {
    sheet.getRange(targetRow, 16).setValue(body.confirmedImportance); // confirmedImportance列
    sheet.getRange(targetRow, 17).setValue(body.confirmedBy || ''); // importanceConfirmedBy列
    sheet.getRange(targetRow, 18).setValue(now); // importanceConfirmedAt列
  }
  if (body.homeDisplayConfirmed !== undefined) {
    sheet.getRange(targetRow, 19).setValue(body.homeDisplayConfirmed); // homeDisplayConfirmed列
    sheet.getRange(targetRow, 20).setValue(body.confirmedBy || ''); // homeDisplayConfirmedBy列
    sheet.getRange(targetRow, 21).setValue(now); // homeDisplayConfirmedAt列
  }
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON,
  );
}

/* ============================================================
 * ここから：定期自動実行（時間主導トリガー）の設定
 * ============================================================
 * これを設定すると、フリちゃんが手動で実行しなくても、毎日決まった時刻に
 * runConvertAllToInformationItems が自動で実行され、「情報アイテム変換結果」
 * シートが最新化される（＝アプリで「実データを読み込む」を押すたびに
 * 新しい内容が反映されるようになる）。
 *
 * 使い方：
 *   1. setupDailyTrigger を1回だけ実行する（初回は権限承認が出る）
 *   2. listTriggers を実行して、意図通り設定されたか確認する
 *   3. 設定をやめたい時は removeDailyTrigger を実行する
 *
 * もし自動実行中にエラーが起きた場合、Googleから
 * フリちゃんのGoogleアカウント宛に自動でエラー通知メールが届く
 * （GASの標準機能。特別な設定は不要）。
 */

var DAILY_TRIGGER_HANDLER_FUNCTION = 'runConvertAllToInformationItems';
var DAILY_TRIGGER_HOUR = 7; // 毎朝7時台に実行（実際の発火時刻はGASの仕様で±15分程度前後する）

/** 毎日決まった時間帯に runConvertAllToInformationItems を自動実行するトリガーを作る。 */
function setupDailyTrigger() {
  // 既に同じ関数を呼ぶトリガーがあれば、重複させないよう一旦削除してから作り直す
  var existingTriggers = ScriptApp.getProjectTriggers();
  existingTriggers.forEach(function (trigger) {
    if (trigger.getHandlerFunction() === DAILY_TRIGGER_HANDLER_FUNCTION) {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  ScriptApp.newTrigger(DAILY_TRIGGER_HANDLER_FUNCTION)
    .timeBased()
    .everyDays(1)
    .atHour(DAILY_TRIGGER_HOUR)
    .inTimezone('Asia/Tokyo')
    .create();

  Logger.log(
    '毎日' + DAILY_TRIGGER_HOUR + '時台に ' + DAILY_TRIGGER_HANDLER_FUNCTION +
      ' を自動実行するトリガーを設定しました。',
  );
}

/** 今、このプロジェクトにどんなトリガーが設定されているか一覧表示する（確認用）。 */
function listTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  if (triggers.length === 0) {
    Logger.log('現在、設定されているトリガーはありません。');
    return;
  }
  triggers.forEach(function (trigger) {
    Logger.log(
      '関数: ' + trigger.getHandlerFunction() +
        ' / 種類: ' + trigger.getEventType() +
        ' / トリガーID: ' + trigger.getUniqueId(),
    );
  });
}

/** runConvertAllToInformationItems の自動実行トリガーをすべて削除する（自動実行をやめたい時用）。 */
function removeDailyTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  var removed = 0;
  triggers.forEach(function (trigger) {
    if (trigger.getHandlerFunction() === DAILY_TRIGGER_HANDLER_FUNCTION) {
      ScriptApp.deleteTrigger(trigger);
      removed++;
    }
  });
  Logger.log(removed + '件のトリガーを削除しました。');
}
