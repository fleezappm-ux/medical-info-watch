/**
 * 医療情報ウォッチ GAS本体（v3.3）
 * ------------------------------------------------------------
 * v3.2.1からの変更点（ガイドラインウォッチボットの追加）：
 *   ・Mindsガイドラインライブラリの「お知らせ」ページ（お知らせ一覧のHTML）を新しい情報源
 *     （minds_guideline）として追加。他の情報源と同様、独立したsourceIdで成功/失敗・
 *     変更検知を行うため、1情報源の取得失敗が他情報源に影響しない
 *   ・お知らせ一覧の1ページ目（最新10件程度）だけを取得し、タイトルに「ガイドライン」を
 *     含むものだけを対象にする（事務連絡ノイズの除外）。カテゴリはclinical
 *     （watch_clinical）、重要度は一律info（参考）からスタートし、人間が個別に確認・
 *     重要度確定する運用（Minds側にPMDAのクラス分けのような自動判定基準が無いため）
 *   ・お知らせのURL固有ID（news-{数字}）を回収番号と同様の一意キーとして使用
 *   詳細はgas/README.mdの「v3.2.1→v3.3の変更点」を参照。
 *
 * v3.2の不具合修正：
 *   ・PMDA回収情報のidを「sourceId + 回収番号」にしていたのを「pmda_recall_ + 回収番号」に戻した。
 *     回収番号はPMDAが発行するクラスをまたいでも重複しない一意な番号のため、
 *     sourceIdを混ぜる必要が無く、むしろv3.1以前からの既存データと不整合を起こしていた
 *     （クラスIの既存データが「別の新規データ」として二重登録されてしまう不具合）。
 *   ・上記不具合で二重登録された行を片付けるための一度きりの関数
 *     runCleanupBuggyClassPrefixedPmdaIds を追加（実行方法はgas/README.md参照）。
 *
 * v3.1からの変更点（PMDA回収情報のクラスII・III拡大、変更履歴のAPI公開）：
 *   ・クラスI・II・IIIをそれぞれ独立した情報源（pmda_recall_class1/2/3）として取得。
 *     1クラスのCSV取得失敗が他クラスの更新・既存データに影響しないよう分離した
 *   ・idの生成方式を sourceId + 回収番号 に変更し、クラスをまたいだid衝突を防止
 *   ・情報源名（sourceName）にクラス名を含めて画面上で区別できるようにした
 *   ・doGetに ?action=history&itemId=... を追加し、information_item_historyから
 *     指定アイテムの変更履歴（新しい順・最大50件）を返せるようにした
 *   詳細はgas/README.mdの「v3.1→v3.2の変更点」を参照。
 *
 * v2からの主な変更点（2026-09-14 監査対応）：
 *   1. 情報源ごとに成功/失敗を分けて扱い、失敗した情報源の既存データは一切触らない
 *   2. 「情報アイテム変換結果」シートの全削除→作り直しをやめ、`information_items`
 *      シートをID単位でマージして書き込む方式に変更
 *   3. 内容のハッシュ値（contentHash）で変更を検知し、変更があれば人間の確認状態を
 *      unreviewedへ戻す（ただしHOME表示確定は維持し、homeDisplayNeedsReviewを立てる）
 *   4. 厚労省供給状況は「限定出荷・供給停止」だけでなく全件を走査し、
 *      供給再開（通常出荷への復帰）も変更として検知・記録する
 *   5. GAS側でLockService.getScriptLock()による排他制御を追加
 *      （doPost・自動/手動の取得処理の両方）
 *   6. doPost内で入力値をホワイトリスト方式で検証し、業務ルール
 *      （対象外は変更不可・重要度未確定でHOME表示不可）もサーバー側で強制
 *   7. 外部取得文字列がスプレッドシートで数式として実行されないよう無害化
 *
 * ファイル構成（このファイル内で完結。複数ファイルに分けていない理由：
 * フリちゃんが「ファイル全体を丸ごと貼り替える」運用のため、単一ファイルの方が
 * 貼り間違いが起きにくい）：
 *   セクションA：GAS API に依存しない純粋関数（Node.jsのテストからも直接読み込んで検証している）
 *   セクションB：スプレッドシート・ネットワークアクセスを伴う実処理
 *   セクションC：Web App化（doGet / doPost）
 *   セクションD：定期自動実行トリガー
 *   セクションE：旧バージョン互換のPoC・デバッグ用関数
 */

/* ============================================================
 * セクションA：GAS API に依存しない純粋関数
 * ------------------------------------------------------------
 * この区画の関数は SpreadsheetApp / UrlFetchApp / PropertiesService / LockService /
 * Drive などのGAS専用オブジェクトを一切使っていない。そのため、
 * test/gas-pure-logic.test.mjs から Node.js の vm モジュールでこのファイルを
 * そのまま読み込んで、実際にGASへ貼り付けるコードをそのままテストできる。
 * ============================================================ */

// ---- 内容ハッシュ（変更検知用。SHA-256をGAS API非依存の純粋JSで実装） ----

/**
 * SHA-256（純粋なJavaScript実装、外部ライブラリ・GAS専用APIに依存しない）。
 * 入力はUTF-8バイト列を表す文字列（1文字=1バイト、utf8Bytes_で変換したもの）を渡すこと。
 * 実装はNode.jsの`crypto`モジュールが返す結果と一致することをテストで確認済み
 * （test/gas-pure-logic.test.mjs）。
 */
function sha256Hex_(ascii) {
  function rightRotate(value, amount) {
    return (value >>> amount) | (value << (32 - amount));
  }

  var mathPow = Math.pow;
  var maxWord = mathPow(2, 32);
  var lengthProperty = 'length';
  var i, j;
  var result = '';

  var words = [];
  var asciiBitLength = ascii[lengthProperty] * 8;

  var hash = sha256Hex_.h = sha256Hex_.h || [];
  var k = sha256Hex_.k = sha256Hex_.k || [];
  var primeCounter = k[lengthProperty];

  var isComposite = {};
  for (var candidate = 2; primeCounter < 64; candidate++) {
    if (!isComposite[candidate]) {
      for (i = 0; i < 313; i += candidate) {
        isComposite[i] = candidate;
      }
      hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
      k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
    }
  }

  ascii += '\x80';
  while (ascii[lengthProperty] % 64 - 56) ascii += '\x00';
  for (i = 0; i < ascii[lengthProperty]; i++) {
    j = ascii.charCodeAt(i);
    if (j >> 8) return ''; // ASCII（0-255）以外が混入した場合は呼び出し側のutf8Bytes_変換漏れ
    words[i >> 2] |= j << ((3 - (i % 4)) * 8);
  }
  words[words[lengthProperty]] = (asciiBitLength / maxWord) | 0;
  words[words[lengthProperty]] = asciiBitLength;

  for (j = 0; j < words[lengthProperty]; ) {
    var w = words.slice(j, (j += 16));
    var oldHash = hash;
    hash = hash.slice(0, 8);

    for (i = 0; i < 64; i++) {
      var w15 = w[i - 15];
      var w2 = w[i - 2];
      var a = hash[0];
      var e = hash[4];
      var temp1 =
        hash[7] +
        (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25)) +
        ((e & hash[5]) ^ (~e & hash[6])) +
        k[i] +
        (w[i] =
          i < 16
            ? w[i]
            : ((w[i - 16] +
                (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3)) +
                w[i - 7] +
                (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))) |
              0));
      var temp2 =
        (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22)) +
        ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));

      hash = [(temp1 + temp2) | 0].concat(hash);
      hash[4] = (hash[4] + temp1) | 0;
    }

    for (i = 0; i < 8; i++) {
      hash[i] = (hash[i] + oldHash[i]) | 0;
    }
  }

  for (i = 0; i < 8; i++) {
    for (j = 3; j + 1; j--) {
      var b = (hash[i] >> (j * 8)) & 255;
      result += (b < 16 ? '0' : '') + b.toString(16);
    }
  }
  return result;
}

/** 文字列をUTF-8のバイト列（1文字=1バイトの文字列）に変換する（sha256Hex_への入力用）。 */
function utf8Bytes_(str) {
  return unescape(encodeURIComponent(str));
}

/**
 * 複数フィールドを正規化して連結し、SHA-256のハッシュ値（16進文字列）を返す。
 * 前後の空白・連続する空白の差だけで「変更あり」と誤検知しないよう正規化する。
 */
function computeContentHash_(parts) {
  var normalized = parts
    .map(function (p) {
      if (p === null || p === undefined) return '';
      return String(p).trim().replace(/\s+/g, ' ');
    })
    .join('\u0001');
  return sha256Hex_(utf8Bytes_(normalized));
}

/** PMDA回収情報のうち、内容変更判定に使うフィールドを決まった順序の配列にする。 */
function pmdaRecallHashFields_(f) {
  return [
    f.recallNumber,
    f.publishedAt,
    f.recallClass,
    f.productName,
    f.lotInfo,
    f.reason,
    f.healthRisk,
    f.startDate,
    f.remarks,
  ];
}

/** 厚労省供給状況のうち、内容変更判定に使うフィールドを決まった順序の配列にする。 */
function mhlwSupplyHashFields_(f) {
  return [f.yjCode, f.productName, f.manufacturer, f.status, f.volume, f.reason, f.startDate, f.resolution];
}

// ---- 業務ルール・入力値検証（doPostから利用） ----

var ALLOWED_REVIEW_STATUSES_ = ['unreviewed', 'reviewing', 'reviewed', 'excluded'];
var ALLOWED_IMPORTANCE_LEVELS_ = ['critical', 'caution', 'info'];
var ALLOWED_WATCH_LEVELS_ = ['off', 'watch', 'home'];
/**
 * ウォッチ設定として保存を許可するIDの固定リスト。
 * ウォッチ設定がまだ一度も保存されていない場合（getWatchSettings_がnullを返す場合）でも
 * 任意のIDを保存できてしまわないよう、コード側に固定で持たせている
 * （カテゴリの追加はコード変更を伴うため、ここに追記する運用でよい）。
 */
var ALLOWED_WATCH_IDS_ = ['watch_pharmacy', 'watch_clinic', 'watch_clinical', 'watch_system'];
var MAX_ID_LENGTH_ = 200;
var MAX_CONFIRMED_BY_LENGTH_ = 100;
var MAX_WATCH_SETTINGS_COUNT_ = 50;
var ID_PATTERN_ = /^[a-zA-Z0-9_-]+$/;

function isValidIdFormat_(id) {
  return typeof id === 'string' && id.length > 0 && id.length <= MAX_ID_LENGTH_ && ID_PATTERN_.test(id);
}

/**
 * doPostの`action: 'updateItemStatus'`の入力値を検証する。
 * ここでは「値の形式・許可された値かどうか」だけを見る（対象idの存在確認や
 * 業務ルールのチェックはbusinessRuleAllowsUpdate_・呼び出し元で行う）。
 */
function validateUpdateItemStatusInput_(body) {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'リクエスト本文が不正です' };
  }
  if (!isValidIdFormat_(body.id)) {
    return { valid: false, error: 'idの形式が不正です' };
  }
  if (body.reviewStatus !== undefined && ALLOWED_REVIEW_STATUSES_.indexOf(body.reviewStatus) === -1) {
    return { valid: false, error: 'reviewStatusの値が不正です' };
  }
  if (
    body.confirmedImportance !== undefined &&
    body.confirmedImportance !== null &&
    ALLOWED_IMPORTANCE_LEVELS_.indexOf(body.confirmedImportance) === -1
  ) {
    return { valid: false, error: 'confirmedImportanceの値が不正です' };
  }
  if (body.homeDisplayConfirmed !== undefined && typeof body.homeDisplayConfirmed !== 'boolean') {
    return { valid: false, error: 'homeDisplayConfirmedはtrue/falseで指定してください' };
  }
  if (
    body.confirmedBy !== undefined &&
    (typeof body.confirmedBy !== 'string' || body.confirmedBy.length > MAX_CONFIRMED_BY_LENGTH_)
  ) {
    return { valid: false, error: 'confirmedByの形式が不正です' };
  }
  return { valid: true };
}

/**
 * doPostの`action: 'updateWatchSettings'`の入力値を検証する。
 * knownIdsを渡した場合、既知のウォッチ設定ID以外は拒否する（null/undefinedならID自体はチェックしない）。
 */
function validateWatchSettingsInput_(settings, knownIds) {
  if (!Array.isArray(settings)) {
    return { valid: false, error: 'settingsは配列で指定してください' };
  }
  if (settings.length > MAX_WATCH_SETTINGS_COUNT_) {
    return { valid: false, error: 'settingsの件数が多すぎます' };
  }
  for (var i = 0; i < settings.length; i++) {
    var s = settings[i];
    if (!s || typeof s !== 'object') {
      return { valid: false, error: '不正な設定項目が含まれています' };
    }
    if (knownIds && knownIds.indexOf(s.id) === -1) {
      return { valid: false, error: '不明な設定ID: ' + s.id };
    }
    if (ALLOWED_WATCH_LEVELS_.indexOf(s.level) === -1) {
      return { valid: false, error: 'levelの値が不正です: ' + s.level };
    }
  }
  return { valid: true };
}

/**
 * 業務ルールのチェック（クライアント側の表示制御だけに依存しない）。
 *   ・対象外(excluded)の情報は一切変更できない
 *   ・重要度が未確定のままHOME表示をONにはできない
 *   ・内容変更で「再確認必要」になっている情報は、先に「内容を確認済みにする」
 *     （reviewStatus: 'reviewed'）を行うまで、重要度確定・HOME表示の変更を受け付けない
 *     （原資料確認→内容確認済み→重要度再確定→HOME表示再確認、という順序をサーバー側でも強制する）
 */
function businessRuleAllowsUpdate_(existingState, update) {
  if (existingState.reviewStatus === 'excluded') {
    return { allowed: false, error: '対象外の情報は変更できません' };
  }
  var resultingImportance =
    update.confirmedImportance !== undefined ? update.confirmedImportance : existingState.confirmedImportance;
  if (update.homeDisplayConfirmed === true && !resultingImportance) {
    return { allowed: false, error: '重要度が未確定のためHOME表示できません' };
  }
  var isTouchingImportanceOrHome = update.confirmedImportance !== undefined || update.homeDisplayConfirmed !== undefined;
  var willBeReviewed = existingState.reviewStatus === 'reviewed' || update.reviewStatus === 'reviewed';
  if (existingState.homeDisplayNeedsReview && isTouchingImportanceOrHome && !willBeReviewed) {
    return {
      allowed: false,
      error: '内容が更新されているため、先に「内容を確認済みにする」を行ってから重要度・HOME表示を操作してください',
    };
  }
  return { allowed: true };
}

/**
 * 外部から取得した文字列をスプレッドシートのセルへ書き込んでも数式として
 * 実行されないようにする（先頭が = + - @ の場合、先頭にシングルクォートを付ける）。
 * 日付・数値・真偽値には使わないこと（文字列以外はそのまま返す）。
 */
function sanitizeCellValue_(value) {
  if (typeof value !== 'string') return value;
  if (/^[=+\-@]/.test(value)) {
    return "'" + value;
  }
  return value;
}

// ---- 日本の年度計算（PMDA CSVのURLに使う年度を、固定文字列ではなく日付から算出する） ----

/**
 * 日本の年度（4月始まり）を2桁文字列で返す。例：2026年5月→'26'、2027年2月→'26'。
 * 実行環境（GAS・Node.jsテスト等）のローカルタイムゾーン設定に結果が左右されないよう、
 * UTC時刻に+9時間して「日本時間としての年月」をUTCメソッドで取り出す。
 */
function currentJapaneseFiscalYear2Digit_(date) {
  var d = date || new Date();
  var jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  var year = jst.getUTCFullYear();
  var month = jst.getUTCMonth() + 1; // 1-12
  var fiscalYear = month >= 4 ? year : year - 1;
  var twoDigit = fiscalYear % 100;
  return twoDigit < 10 ? '0' + twoDigit : String(twoDigit);
}

/**
 * PMDA回収情報CSVの取得候補（年度）を、指定したクラス（1/2/3）について返す。
 * v3.2でクラスII・IIIにも対応（クラスごとに別の情報源として扱う。下のPMDA_RECALL_CLASSES_参照）。
 * 年度は日付から自動算出するため、年度が変わってもコード修正は不要。
 */
function pmdaFiscalYearCandidatesForClass_(date, recallClass) {
  var currentFy = currentJapaneseFiscalYear2Digit_(date);
  var currentFyNum = parseInt(currentFy, 10);
  var previousFyNum = currentFyNum - 1;
  var previousFy = previousFyNum < 0 ? '99' : previousFyNum < 10 ? '0' + previousFyNum : String(previousFyNum);
  return [
    { fiscalYear2Digit: currentFy, recallClass: recallClass },
    { fiscalYear2Digit: previousFy, recallClass: recallClass },
  ];
}

/**
 * PMDA回収情報として取り込むクラスの一覧。クラスごとに独立した情報源（sourceId）として扱い、
 * source_run_logsでも別々に成功/失敗を記録する。これにより、例えばクラスIIIのCSVが
 * 一時的に取得できなくても、クラスI・IIの取得・変更検知には影響しない。
 */
var PMDA_RECALL_CLASSES_ = [
  { recallClass: 1, sourceId: 'pmda_recall_class1' },
  { recallClass: 2, sourceId: 'pmda_recall_class2' },
  { recallClass: 3, sourceId: 'pmda_recall_class3' },
];

// ---- CSVの列見出し（この順番で並んでいる） ----

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
 * CSVの「クラス分類」列（例："（クラスI）"）→ アプリの重要度候補。
 * 注意：'クラスIII'という文字列は'クラスII'を部分文字列として含むため、
 * 判定順序を III → II → I にしないと、クラスIII（参考）をクラスII（注意）と
 * 誤判定してしまう（v1・v2で潜在していたバグ。テストで発見し、ここで修正）。
 */
function mapRecallClassToImportance_(recallClassLabel) {
  var label = recallClassLabel || '';
  if (label.indexOf('クラスIII') !== -1) {
    return 'info'; // クラスIII
  }
  if (label.indexOf('クラスII') !== -1) {
    return 'caution'; // クラスII
  }
  if (label.indexOf('クラスI') !== -1) {
    return 'critical'; // クラスI（重篤な健康被害・死亡の恐れ）
  }
  return 'info'; // 判定不能
}

/**
 * CSVの「クラス分類」列から、画面表示用の短いクラス名（'クラスI'/'クラスII'/'クラスIII'）を取り出す。
 * mapRecallClassToImportance_と同じ理由で、判定順序は III → II → I。
 */
function extractRecallClassLabel_(recallClassLabel) {
  var label = recallClassLabel || '';
  if (label.indexOf('クラスIII') !== -1) return 'クラスIII';
  if (label.indexOf('クラスII') !== -1) return 'クラスII';
  if (label.indexOf('クラスI') !== -1) return 'クラスI';
  return 'クラス不明';
}

// CSVの「掲載年月日」列（例："'2026/06/26"）→ "2026-06-26" 形式
function normalizePublishedAt_(rawDate) {
  var cleaned = String(rawDate || '').replace(/^'/, '').trim();
  var match = cleaned.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (!match) return cleaned; // 形式が想定と違う場合はそのまま返す
  var y = match[1];
  var m = ('0' + match[2]).slice(-2);
  var d = ('0' + match[3]).slice(-2);
  return y + '-' + m + '-' + d;
}

/**
 * CSVの1行（配列）を、information_items用の「今回取得した内容」オブジェクトへ変換する。
 * 人間の確認状態（reviewStatus等）はここでは持たせない。それは
 * mergeSourceItems_ が既存データとの比較結果から決める。
 *
 * idは回収番号のみから作る（sourceIdは含めない）。回収番号はPMDAが発行する
 * クラスをまたいでも重複しない一意な番号のため、これで既存データ（v3.1以前の
 * クラスIのみの時代のid）とも完全に互換性がある。sourceRecordIdにも
 * 同じ回収番号を保持しておき、情報源単位のマージ判定に使う。
 */
function buildPmdaRecallItem_(row, listPageUrl, fetchedAtIso) {
  var recallNumber = row[0];
  var publishedAtRaw = row[1];
  var itemKind = row[2];
  var recallClassLabel = row[4];
  var nameAndProduct = row[5] || '';
  var lotInfo = row[6] || '';
  var manufacturer = row[7] || '';
  var reason = row[8] || '';
  var healthRisk = row[9] || '';
  var startDate = row[10];
  var remarksRaw = row[14] || '';

  var importance = mapRecallClassToImportance_(recallClassLabel);

  var titleLine =
    nameAndProduct
      .split('\n')
      .filter(function (line) {
        return line.indexOf('販売名') !== -1;
      })[0] ||
    nameAndProduct.split('\n')[0] ||
    '(タイトル不明)';
  var productTitle = titleLine.replace(/^.*[：:]\s*/, '').trim();
  var publishedAt = normalizePublishedAt_(publishedAtRaw);

  var contentHash = computeContentHash_(
    pmdaRecallHashFields_({
      recallNumber: recallNumber,
      publishedAt: publishedAt,
      recallClass: recallClassLabel,
      productName: productTitle,
      lotInfo: lotInfo,
      reason: reason,
      healthRisk: healthRisk,
      startDate: startDate,
      remarks: remarksRaw,
    }),
  );

  return {
    id: 'pmda_recall_' + recallNumber,
    sourceRecordId: String(recallNumber),
    category: 'pharmacy',
    itemType: '回収',
    title: sanitizeCellValue_(productTitle + '（自主回収）'),
    summary: sanitizeCellValue_(reason.trim()),
    aiImportance: importance,
    publishedAt: publishedAt,
    sourceName: sanitizeCellValue_('PMDA（' + itemKind + '・' + extractRecallClassLabel_(recallClassLabel) + '）'),
    documentNumber: sanitizeCellValue_('回収番号：' + recallNumber),
    pharmacyImpact: sanitizeCellValue_(
      healthRisk.trim() + (manufacturer ? '\n\n【製造販売業者】\n' + manufacturer.trim() : ''),
    ),
    requiredAction: lotInfo ? sanitizeCellValue_('対象ロットの確認：\n' + lotInfo.trim()) : null,
    primaryUrl: listPageUrl,
    remarks: sanitizeCellValue_(remarksRaw.trim()),
    contentHash: contentHash,
    fetchedAtIso: fetchedAtIso,
    isResolvedCandidate: false,
  };
}

/** CSVの全行を、information_items用オブジェクトの配列に変換する（純粋関数）。 */
function buildPmdaIncomingItems_(rows, listPageUrl, fetchedAtIso) {
  return rows.map(function (row) {
    return buildPmdaRecallItem_(row, listPageUrl, fetchedAtIso);
  });
}

/** 「出荷対応」列の文言→アプリの重要度候補。通常出荷はinfo扱い（一覧には出さない運用）。 */
function mapShippingStatusToImportance_(status) {
  var s = status || '';
  if (s.indexOf('供給停止') !== -1) return 'critical';
  if (s.indexOf('限定出荷') !== -1) return 'caution';
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
    )
      idx.productName = i;
    if (idx.manufacturer === undefined && (label.indexOf('製造販売業者') !== -1 || label.indexOf('会社名') !== -1))
      idx.manufacturer = i;
    if (idx.shippingStatus === undefined && label.indexOf('出荷対応') !== -1) idx.shippingStatus = i;
    if (idx.shippingVolume === undefined && label.indexOf('出荷量') !== -1) idx.shippingVolume = i;
    if (idx.reason === undefined && label.indexOf('理由') !== -1) idx.reason = i;
    if (idx.startDate === undefined && label.indexOf('対応開始') !== -1) idx.startDate = i;
    if (idx.resolution === undefined && label.indexOf('解消') !== -1) idx.resolution = i;
  }
  return idx;
}

/**
 * 1つのYJコードについて、information_items用オブジェクトを作る（純粋関数）。
 * forcedChangeStatusを指定した場合、mergeSourceItems_はハッシュ比較を行わずその区分を採用する
 * （'resolved'＝Excel内で明示的に通常出荷を確認できた場合のみ、呼び出し側が設定する）。
 */
function buildMhlwSupplyItem_(yjCode, fields, status, sourceUrl, fetchedAtIso) {
  var f = fields || {};
  var productName = f.productName || '';
  var genericName = f.genericName || '';
  var manufacturer = f.manufacturer || '';
  var volume = f.volume || '';
  var reason = f.reason || '';
  var startDate = f.startDate || '';
  var resolution = f.resolution || '';

  var displayName = productName || genericName || '(品名不明)';

  var contentHash = computeContentHash_(
    mhlwSupplyHashFields_({
      yjCode: yjCode,
      productName: displayName,
      manufacturer: manufacturer,
      status: status,
      volume: volume,
      reason: reason,
      startDate: startDate,
      resolution: resolution,
    }),
  );

  return {
    id: 'mhlw_supply_' + yjCode,
    sourceRecordId: yjCode,
    category: 'pharmacy',
    itemType: '供給',
    title: sanitizeCellValue_(displayName + '（' + (status || '供給状況') + '）'),
    summary: sanitizeCellValue_(reason || status || ''),
    aiImportance: mapShippingStatusToImportance_(status),
    publishedAt: startDate,
    sourceName: '厚労省（医療用医薬品供給状況報告）',
    documentNumber: yjCode ? sanitizeCellValue_('YJコード：' + yjCode) : null,
    pharmacyImpact: sanitizeCellValue_(
      '出荷量：' + (volume || '不明') + (manufacturer ? '\n\n【製造販売業者】\n' + manufacturer : ''),
    ),
    requiredAction: resolution ? sanitizeCellValue_('解消見込み：' + resolution) : null,
    primaryUrl: sourceUrl,
    remarks: '',
    contentHash: contentHash,
    fetchedAtIso: fetchedAtIso,
  };
}

/**
 * 今回のExcelでYJコードが見つからなかった場合の「掲載未確認」アイテムを作る（純粋関数）。
 * 消えた理由（本当に通常出荷へ戻った／掲載対象の変更／一時的な欠落／Excel形式変更／解析漏れ）を
 * 区別できないため、内容はすべて前回値をそのまま維持し、「手動確認が必要」とだけ伝える。
 * forcedChangeStatus: 'missing' により、mergeSourceItems_は自動的に「解消」とは判定しない。
 */
function buildMissingMhlwSupplyItem_(yjCode, prev, sourceUrl, fetchedAtIso) {
  return {
    id: 'mhlw_supply_' + yjCode,
    sourceRecordId: yjCode,
    category: prev.category || 'pharmacy',
    itemType: prev.itemType || '供給',
    title: prev.title || 'YJコード：' + yjCode,
    summary:
      '今回の取得ではこの品目の掲載が確認できませんでした（前回確認時の内容を保持しています）。' +
      '掲載対象の変更・一時的なデータ欠落・Excel形式変更などの可能性があるため、供給再開と決めつけず手動確認してください。' +
      '前回の内容：' +
      (prev.summary || ''),
    aiImportance: prev.aiImportance || 'info',
    publishedAt: prev.publishedAt || '',
    sourceName: prev.sourceName || '厚労省（医療用医薬品供給状況報告）',
    documentNumber: prev.documentNumber || null,
    pharmacyImpact: prev.pharmacyImpact || '',
    requiredAction: '掲載の有無を厚労省のExcelで手動確認してください（自動では解消と判定していません）',
    primaryUrl: sourceUrl,
    remarks: prev.remarks || '',
    // 内容が不明なため、前回のハッシュをそのまま維持する（新しい内容として扱わない）
    contentHash: prev.contentHash,
    fetchedAtIso: fetchedAtIso,
    forcedChangeStatus: 'missing',
  };
}

/**
 * 今回取得した厚労省供給状況テーブル全体（currentByYjCode）と、
 * 既に追跡中のYJコードの状態一覧（existingMhlwStates：sourceRecordId＝YJコードをキーにした
 * information_itemsの既存状態オブジェクト）を突き合わせて、
 * information_items用の「今回のインカミング一覧」を作る（純粋関数）。
 *
 *   ・限定出荷／供給停止：常に含める（新規・更新・変化なしはmergeSourceItems_がハッシュで判定）
 *   ・通常出荷（Excelで明示的に確認できた場合のみ）：既に追跡中のYJコードだけ
 *     forcedChangeStatus: 'resolved' として含める（＝供給再開の確定）
 *   ・それ以外の想定外の文言：追跡中のものだけ、通常の変更検知（ハッシュ比較）に乗せて含める
 *   ・既に追跡中だが今回のExcelに存在しない（消えた理由が不明）YJコード：
 *     forcedChangeStatus: 'missing' として、内容は前回のまま・要手動確認の状態で含める
 *     （＝「消えた＝供給再開」とは判定しない）
 */
function buildMhlwSupplyIncomingItems_(currentByYjCode, existingMhlwStates, sourceUrl, fetchedAtIso) {
  var items = [];
  var seen = {};
  var trackedYjCodes = Object.keys(existingMhlwStates);

  Object.keys(currentByYjCode).forEach(function (yjCode) {
    var entry = currentByYjCode[yjCode];
    var status = entry.status || '';
    var isAbnormal = status.indexOf('限定出荷') !== -1 || status.indexOf('供給停止') !== -1;
    var isExplicitNormal = status.indexOf('通常出荷') !== -1;
    var wasTracked = trackedYjCodes.indexOf(yjCode) !== -1;

    if (!isAbnormal && !isExplicitNormal && !wasTracked) return; // 想定外の文言かつ未追跡なら無視
    if (!isAbnormal && isExplicitNormal && !wasTracked) return; // 通常出荷かつ未追跡なら一覧に出さない

    seen[yjCode] = true;
    var item = buildMhlwSupplyItem_(yjCode, entry.fields, status, sourceUrl, fetchedAtIso);
    if (isExplicitNormal && wasTracked) {
      // Excelで明示的に「通常出荷」を確認できた場合のみ、供給再開（解消）と判定する
      item.forcedChangeStatus = 'resolved';
      item.aiImportance = 'info';
    }
    items.push(item);
  });

  trackedYjCodes.forEach(function (yjCode) {
    if (seen[yjCode]) return; // 今回のExcelで見つかった（上のループで処理済み）
    items.push(buildMissingMhlwSupplyItem_(yjCode, existingMhlwStates[yjCode], sourceUrl, fetchedAtIso));
  });

  return items;
}

// ---- Mindsガイドラインライブラリ「お知らせ」：HTML解析（GAS API非依存の純粋関数） ----

/**
 * HTMLタグを取り除き、代表的なHTML実体参照を普通の文字へ戻す（純粋関数）。
 * お知らせ一覧のリンクの中身（日付・カテゴリ・タイトルがまとめて入っている）から
 * プレーンテキストを取り出すために使う。厳密なHTMLパーサではないので、
 * タグの入れ子や属性値の中の"<"等までは想定していない（お知らせ一覧のような
 * シンプルなリンクテキストの抽出に用途を絞っている）。
 */
function stripHtmlTags_(html) {
  var text = String(html || '');
  text = text.replace(/<[^>]*>/g, ' ');
  text = text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/gi, "'");
  return text;
}

/**
 * stripHtmlTags_後のテキスト（例："2026年9月8日 Minds関連 「大型血管炎」の診療ガイドラインを公開しました"）
 * から、掲載日（"YYYY-MM-DD"）とタイトル（日付・カテゴリ表記を除いた部分）を取り出す（純粋関数）。
 * 日付が見つからない場合はpublishedAtを空文字にする（呼び出し側で「不明」として扱われる）。
 */
function parseMindsNewsEntryText_(rawText) {
  var text = String(rawText || '').replace(/\s+/g, ' ').trim();
  var dateMatch = text.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  var publishedAt = '';
  var title = text;

  if (dateMatch) {
    var y = dateMatch[1];
    var m = ('0' + dateMatch[2]).slice(-2);
    var d = ('0' + dateMatch[3]).slice(-2);
    publishedAt = y + '-' + m + '-' + d;
    title = text.slice(text.indexOf(dateMatch[0]) + dateMatch[0].length);
  }

  // 既知のカテゴリ表記（日付の直後に来る想定）を取り除く。未知のカテゴリが増えても
  // タイトル自体の抽出には支障がない（先頭の余分な単語が残るだけで、
  // 「ガイドライン」を含むかどうかの判定やタイトル表示は成立する）。
  title = title.replace(/^\s*(Minds関連|作成団体関連)\s*/, '').trim();

  return { publishedAt: publishedAt, title: title };
}

/**
 * タイトルに「ガイドライン」の文字を含むかどうか（合意済みの絞り込み条件）。
 * 「組織ページを更新しました」等の事務連絡ノイズを除外するために使う。
 */
function isGuidelineNewsTitle_(title) {
  return typeof title === 'string' && title.indexOf('ガイドライン') !== -1;
}

/**
 * Mindsお知らせ一覧ページの生HTMLから、お知らせ1件ずつの{newsId, url, publishedAt, title}を
 * 抜き出す（純粋関数）。各お知らせへのリンク（href="https://minds.jcqhc.or.jp/news-{数字}/"、
 * ドメイン省略の相対リンクも許容）を探し、そのリンクの中のテキスト（日付・カテゴリ・タイトルが
 * まとめて入っている）からparseMindsNewsEntryText_で日付とタイトルを分離する。
 * 同じnewsIdへのリンクが複数回出てくる場合（サムネイル画像とテキストが別々にリンクしている等）は
 * 最初に見つかったものだけを採用し、重複を作らない。
 */
function extractMindsNewsEntries_(html) {
  var order = [];
  var byId = {};
  var pattern = /<a\b[^>]*href=["'](?:https?:\/\/minds\.jcqhc\.or\.jp)?\/news-(\d+)\/["'][^>]*>([\s\S]*?)<\/a>/gi;
  var match;

  while ((match = pattern.exec(html)) !== null) {
    var newsId = match[1];
    var parsed = parseMindsNewsEntryText_(stripHtmlTags_(match[2]));

    if (!byId[newsId]) {
      byId[newsId] = {
        newsId: newsId,
        url: 'https://minds.jcqhc.or.jp/news-' + newsId + '/',
        publishedAt: parsed.publishedAt,
        title: parsed.title,
      };
      order.push(newsId);
    } else if (!byId[newsId].title && parsed.title) {
      // 同じお知らせへの重複リンク（サムネイル画像とテキストが別々にリンクしている等）で、
      // 先に見つかった方にタイトルが無い（画像だけだった）場合は、後から見つかった
      // タイトル付きの方で補完する。
      byId[newsId].title = parsed.title;
      if (!byId[newsId].publishedAt && parsed.publishedAt) {
        byId[newsId].publishedAt = parsed.publishedAt;
      }
    }
  }

  return order.map(function (id) {
    return byId[id];
  });
}

/** Mindsガイドラインのうち、内容変更判定に使うフィールドを決まった順序の配列にする。 */
function mindsGuidelineHashFields_(f) {
  return [f.newsId, f.publishedAt, f.title];
}

/**
 * 1件のMindsお知らせエントリを、information_items用の「今回取得した内容」オブジェクトへ変換する
 * （純粋関数。buildPmdaRecallItem_・buildMhlwSupplyItem_と同じ役割）。
 * 重要度は一律'info'（参考）からスタートする：Minds側にはPMDAの回収クラスのような
 * 自動判定できる分類が無いため、人間が個別に確認・重要度確定する運用にしている（合意済み）。
 * 詳細本文までは取得していないため、summaryはタイトルをそのまま使う。
 */
function buildMindsGuidelineItem_(entry, listPageUrl, fetchedAtIso) {
  var contentHash = computeContentHash_(
    mindsGuidelineHashFields_({
      newsId: entry.newsId,
      publishedAt: entry.publishedAt,
      title: entry.title,
    }),
  );

  return {
    id: 'minds_guideline_' + entry.newsId,
    sourceRecordId: entry.newsId,
    category: 'clinical',
    itemType: 'ガイドライン',
    title: sanitizeCellValue_(entry.title),
    summary: sanitizeCellValue_(entry.title),
    aiImportance: 'info',
    publishedAt: entry.publishedAt,
    sourceName: 'Mindsガイドラインライブラリ（お知らせ）',
    documentNumber: sanitizeCellValue_('お知らせ番号：news-' + entry.newsId),
    pharmacyImpact: '',
    requiredAction: null,
    primaryUrl: entry.url,
    remarks: '',
    contentHash: contentHash,
    fetchedAtIso: fetchedAtIso,
  };
}

/**
 * お知らせ一覧の全エントリから、タイトルに「ガイドライン」を含むものだけを
 * information_items用オブジェクトの配列に変換する（純粋関数）。
 */
function buildMindsIncomingItems_(entries, listPageUrl, fetchedAtIso) {
  return entries
    .filter(function (entry) {
      return isGuidelineNewsTitle_(entry.title);
    })
    .map(function (entry) {
      return buildMindsGuidelineItem_(entry, listPageUrl, fetchedAtIso);
    });
}

// ---- 変更検知・マージ（データ消失防止の中心ロジック） ----

/**
 * 既存の人間の確認状態（previousState）と、今回の変更区分（changeStatus）から、
 * 新しい行に採用すべき「人間側フィールド」を決める。
 *
 *   ・new：初期値（未確認・未確定）
 *   ・unchanged：既存の状態をそのまま維持
 *   ・updated / resolved：
 *       - 既に「対象外」だった情報は対象外のまま維持する（人間が明示的に戻すまで変えない）
 *       - それ以外は reviewStatus を unreviewed に戻し、重要度確定はクリアする。
 *         ただし HOME表示は安全側に倒し、確定状態そのものは維持したうえで
 *         homeDisplayNeedsReview を立てて「再確認が必要」と分かるようにする。
 */
function decideMergedState_(previousState, changeStatus) {
  if (!previousState || changeStatus === 'new') {
    return {
      reviewStatus: 'unreviewed',
      confirmedImportance: null,
      importanceConfirmedBy: null,
      importanceConfirmedAt: null,
      homeDisplayConfirmed: false,
      homeDisplayConfirmedBy: null,
      homeDisplayConfirmedAt: null,
      homeDisplayNeedsReview: false,
    };
  }

  if (changeStatus === 'unchanged') {
    return {
      reviewStatus: previousState.reviewStatus,
      confirmedImportance: previousState.confirmedImportance,
      importanceConfirmedBy: previousState.importanceConfirmedBy,
      importanceConfirmedAt: previousState.importanceConfirmedAt,
      homeDisplayConfirmed: previousState.homeDisplayConfirmed,
      homeDisplayConfirmedBy: previousState.homeDisplayConfirmedBy,
      homeDisplayConfirmedAt: previousState.homeDisplayConfirmedAt,
      homeDisplayNeedsReview: Boolean(previousState.homeDisplayNeedsReview),
    };
  }

  // updated または resolved
  if (previousState.reviewStatus === 'excluded') {
    return {
      reviewStatus: 'excluded',
      confirmedImportance: previousState.confirmedImportance,
      importanceConfirmedBy: previousState.importanceConfirmedBy,
      importanceConfirmedAt: previousState.importanceConfirmedAt,
      homeDisplayConfirmed: false,
      homeDisplayConfirmedBy: previousState.homeDisplayConfirmedBy,
      homeDisplayConfirmedAt: previousState.homeDisplayConfirmedAt,
      homeDisplayNeedsReview: false,
    };
  }

  return {
    reviewStatus: 'unreviewed',
    confirmedImportance: null,
    importanceConfirmedBy: null,
    importanceConfirmedAt: null,
    homeDisplayConfirmed: previousState.homeDisplayConfirmed,
    homeDisplayConfirmedBy: previousState.homeDisplayConfirmedBy,
    homeDisplayConfirmedAt: previousState.homeDisplayConfirmedAt,
    homeDisplayNeedsReview: Boolean(previousState.homeDisplayConfirmed),
  };
}

/**
 * 1つの情報源について、今回取得したincomingItemsと既存データ（そのsourceIdの分だけ）を
 * マージする（純粋関数）。既存データはこの情報源の分しか渡さない前提
 * （他の情報源のデータはこの関数を呼ぶ側で触らないようにする）。
 *
 * changeStatusの決め方：
 *   ・incoming.forcedChangeStatus === 'missing' → 'missing'（Excel等から消えた＝内容不明。
 *     resolvedとは判定しない）
 *   ・incoming.forcedChangeStatus === 'resolved' → 'resolved'（呼び出し側が明示的に
 *     「解消を確認できた」と判断した場合のみ設定される）
 *   ・それ以外は既存データとのハッシュ比較で 'new' / 'unchanged' / 'updated' を判定
 *
 * 'missing'は特別扱い：既存の状態が既に'missing'だった場合（＝2回目以降の連続欠落）は、
 * missingStreakだけ増やして人間の確認状態は一切変えない（毎回「要再確認」が再燃しないように）。
 * 初めて'missing'になった時だけ、'updated'と同様に確認状態をリセットし、履歴にも記録する。
 *
 * 既存のcontentHashがnull（旧シートからの移行直後など）の場合は「unchanged」として扱う。
 * これにより、移行直後に「本当は変わっていないのに、ハッシュの元になる情報が完全には
 * 引き継げず誤って変更ありと判定してしまう」問題を避ける。移行後2回目以降の取得からは、
 * ハッシュ同士の比較で正しく変更検知される。
 */
function mergeSourceItems_(sourceId, incomingItems, existingById, nowIso) {
  var updatedById = {};
  var historyEntries = [];
  var stats = { addedCount: 0, updatedCount: 0, unchangedCount: 0, resolvedCount: 0, missingCount: 0 };

  incomingItems.forEach(function (incoming) {
    var existing = existingById[incoming.id] || null;
    var previousHash = existing ? existing.contentHash : null;

    var changeStatus;
    if (incoming.forcedChangeStatus === 'missing') {
      changeStatus = 'missing';
    } else if (incoming.forcedChangeStatus === 'resolved') {
      changeStatus = existing ? 'resolved' : 'new';
    } else if (!existing) {
      changeStatus = 'new';
    } else if (!existing.contentHash || existing.contentHash === incoming.contentHash) {
      changeStatus = 'unchanged';
    } else {
      changeStatus = 'updated';
    }

    var isRepeatedMissing = changeStatus === 'missing' && existing && existing.changeStatus === 'missing';

    if (changeStatus === 'new') stats.addedCount++;
    else if (changeStatus === 'unchanged') stats.unchangedCount++;
    else if (changeStatus === 'resolved') stats.resolvedCount++;
    else if (changeStatus === 'missing') stats.missingCount++;
    else stats.updatedCount++;

    var isFirstTimeEvent =
      changeStatus === 'updated' || changeStatus === 'resolved' || (changeStatus === 'missing' && !isRepeatedMissing);

    if (isFirstTimeEvent) {
      historyEntries.push({
        itemId: incoming.id,
        sourceId: sourceId,
        detectedAt: nowIso,
        previousHash: previousHash,
        newHash: incoming.contentHash,
        previousSummary: existing ? existing.summary : '',
        newSummary: incoming.summary,
        diffNote:
          changeStatus === 'resolved'
            ? '状態解消（Excelで通常出荷への復帰を確認）'
            : changeStatus === 'missing'
              ? '今回の取得で掲載が確認できませんでした（供給再開とは判定せず、要手動確認）'
              : '内容変更を検知',
      });
    }

    var mergedState;
    if (isRepeatedMissing) {
      // 2回目以降の連続欠落：確認状態・再確認フラグは前回のまま変えない
      mergedState = decideMergedState_(existing, 'unchanged');
    } else if (changeStatus === 'missing') {
      // 初めての欠落検知：内容変更(updated)と同じ扱いで再確認を促す
      mergedState = decideMergedState_(existing, 'updated');
    } else {
      mergedState = decideMergedState_(existing, changeStatus);
    }

    var missingStreak =
      changeStatus === 'missing' ? (existing && existing.missingStreak ? existing.missingStreak : 0) + 1 : 0;

    updatedById[incoming.id] = {
      id: incoming.id,
      sourceId: sourceId,
      sourceRecordId: incoming.sourceRecordId,
      category: incoming.category,
      itemType: incoming.itemType,
      title: incoming.title,
      summary: incoming.summary,
      aiImportance: incoming.aiImportance,
      publishedAt: incoming.publishedAt,
      sourceName: incoming.sourceName,
      documentNumber: incoming.documentNumber,
      pharmacyImpact: incoming.pharmacyImpact,
      requiredAction: incoming.requiredAction,
      primaryUrl: incoming.primaryUrl,
      remarks: incoming.remarks,
      contentHash: incoming.contentHash,
      previousContentHash: previousHash,
      changeStatus: changeStatus,
      missingStreak: missingStreak,
      firstFetchedAt: existing ? existing.firstFetchedAt : incoming.fetchedAtIso,
      lastFetchedAt: incoming.fetchedAtIso,
      lastChangedAt:
        changeStatus === 'unchanged' || isRepeatedMissing
          ? existing
            ? existing.lastChangedAt
            : null
          : incoming.fetchedAtIso,
      reviewStatus: mergedState.reviewStatus,
      confirmedImportance: mergedState.confirmedImportance,
      importanceConfirmedBy: mergedState.importanceConfirmedBy,
      importanceConfirmedAt: mergedState.importanceConfirmedAt,
      homeDisplayConfirmed: mergedState.homeDisplayConfirmed,
      homeDisplayConfirmedBy: mergedState.homeDisplayConfirmedBy,
      homeDisplayConfirmedAt: mergedState.homeDisplayConfirmedAt,
      homeDisplayNeedsReview: mergedState.homeDisplayNeedsReview,
    };
  });

  return { updatedById: updatedById, historyEntries: historyEntries, stats: stats };
}

/**
 * 複数の情報源の取得結果（成功／失敗まとめて）を、既存の全information_items状態
 * （existingById、全情報源分）に適用する（純粋関数）。
 *
 *   ・成功した情報源だけ mergeSourceItems_ でマージする
 *   ・失敗した情報源のexistingByIdの中身は一切変更しない（そのままコピーして残す）
 *
 * これが「一方の情報源が失敗しても他方（および失敗した側の既存情報）を
 * 巻き込んで消さない」ための中心ロジック。
 */
function applyFetchResultsToState_(existingById, fetchResults, nowIso) {
  var updatedById = {};
  Object.keys(existingById).forEach(function (id) {
    updatedById[id] = existingById[id];
  });

  var historyEntries = [];
  var runLogs = [];

  fetchResults.forEach(function (result) {
    if (!result.success) {
      runLogs.push({
        sourceId: result.sourceId,
        startedAt: result.startedAt || nowIso,
        finishedAt: nowIso,
        success: false,
        fetchedCount: 0,
        addedCount: 0,
        updatedCount: 0,
        unchangedCount: 0,
        resolvedCount: 0,
        missingCount: 0,
        errorMessage: result.error || '不明なエラー',
      });
      return; // 失敗：既存データには一切触れない
    }

    var existingForSource = {};
    Object.keys(existingById).forEach(function (id) {
      if (existingById[id].sourceId === result.sourceId) {
        existingForSource[id] = existingById[id];
      }
    });

    var merged = mergeSourceItems_(result.sourceId, result.items, existingForSource, nowIso);

    Object.keys(merged.updatedById).forEach(function (id) {
      updatedById[id] = merged.updatedById[id];
    });
    historyEntries = historyEntries.concat(merged.historyEntries);

    runLogs.push({
      sourceId: result.sourceId,
      startedAt: result.startedAt || nowIso,
      finishedAt: nowIso,
      success: true,
      fetchedCount: result.items.length,
      addedCount: merged.stats.addedCount,
      updatedCount: merged.stats.updatedCount,
      unchangedCount: merged.stats.unchangedCount,
      resolvedCount: merged.stats.resolvedCount,
      missingCount: merged.stats.missingCount,
      errorMessage: null,
    });
  });

  return { updatedById: updatedById, historyEntries: historyEntries, runLogs: runLogs };
}

/** itemType（'回収' / '供給' / 'ガイドライン' 等）から、リンクの見出しに使うラベルを決める。 */
function linkLabelForItemType_(itemType) {
  if (itemType === '供給') return '厚労省 医療用医薬品供給状況（Excel原本）';
  if (itemType === 'ガイドライン') return 'Minds お知らせページ（原文）';
  return 'PMDA 回収情報一覧（原文）';
}

/**
 * シートから読んだ「日時」の値をISO文字列に揃える。
 * Google Sheetsは日時っぽい文字列を自動でDate型に変換してしまうことがあるため、
 * Date型・文字列どちらで来ても同じ形式に正規化する。
 */
function normalizeFetchedAtValue_(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

/* ============================================================
 * セクションB：スプレッドシート・ネットワークアクセスを伴う実処理
 * ============================================================ */

var INFO_ITEMS_SHEET_NAME = 'information_items';
var INFO_ITEMS_HEADER_ = [
  'id',
  'sourceId',
  'sourceRecordId',
  'category',
  'itemType',
  'title',
  'summary',
  'aiImportance',
  'reviewStatus',
  'publishedAt',
  'sourceName',
  'documentNumber',
  'pharmacyImpact',
  'requiredAction',
  'primaryUrl',
  'remarks',
  'contentHash',
  'previousContentHash',
  'changeStatus',
  'firstFetchedAt',
  'lastFetchedAt',
  'lastChangedAt',
  'confirmedImportance',
  'importanceConfirmedBy',
  'importanceConfirmedAt',
  'homeDisplayConfirmed',
  'homeDisplayConfirmedBy',
  'homeDisplayConfirmedAt',
  'homeDisplayNeedsReview',
  'missingStreak',
];
var INFO_ITEMS_COLUMN_COUNT = INFO_ITEMS_HEADER_.length; // 30

var HISTORY_SHEET_NAME_ = 'information_item_history';
var HISTORY_HEADER_ = [
  'itemId',
  'sourceId',
  'detectedAt',
  'previousHash',
  'newHash',
  'previousSummary',
  'newSummary',
  'diffNote',
];

var RUN_LOG_SHEET_NAME_ = 'source_run_logs';
var RUN_LOG_HEADER_ = [
  'sourceId',
  'startedAt',
  'finishedAt',
  'success',
  'fetchedCount',
  'addedCount',
  'updatedCount',
  'unchangedCount',
  'resolvedCount',
  'missingCount',
  'errorMessage',
];

var SOURCE_LABELS_ = {
  pmda_recall_class1: 'PMDA回収情報（クラスI）',
  pmda_recall_class2: 'PMDA回収情報（クラスII）',
  pmda_recall_class3: 'PMDA回収情報（クラスIII）',
  mhlw_supply: '厚労省供給情報',
  minds_guideline: 'Mindsガイドライン',
};

// 旧バージョン（v2）が使っていた「情報アイテム変換結果」シート関連
var LEGACY_SHEET_NAME_ = '情報アイテム変換結果';
var LEGACY_BACKUP_SHEET_NAME_ = '旧_情報アイテム変換結果';
var LEGACY_COLUMN_COUNT_ = 21;
var LEGACY_MIGRATION_FLAG_KEY_ = 'LEGACY_MIGRATION_DONE_V3';

/** シートの1行（配列）を、readExistingItemsById_ / migrateLegacySheetIfNeeded_ 共通の状態オブジェクトへ変換する。 */
function rowToItemState_(row) {
  return {
    id: row[0],
    sourceId: row[1],
    sourceRecordId: row[2],
    category: row[3],
    itemType: row[4],
    title: row[5],
    summary: row[6],
    aiImportance: row[7],
    reviewStatus: row[8],
    publishedAt: row[9],
    sourceName: row[10],
    documentNumber: row[11],
    pharmacyImpact: row[12],
    requiredAction: row[13],
    primaryUrl: row[14],
    remarks: row[15],
    contentHash: row[16] || null,
    previousContentHash: row[17] || null,
    changeStatus: row[18] || 'unchanged',
    firstFetchedAt: normalizeFetchedAtValue_(row[19]),
    lastFetchedAt: normalizeFetchedAtValue_(row[20]),
    lastChangedAt: normalizeFetchedAtValue_(row[21]),
    confirmedImportance: row[22] || null,
    importanceConfirmedBy: row[23] || null,
    importanceConfirmedAt: normalizeFetchedAtValue_(row[24]),
    homeDisplayConfirmed: row[25] === true || row[25] === 'TRUE',
    homeDisplayConfirmedBy: row[26] || null,
    homeDisplayConfirmedAt: normalizeFetchedAtValue_(row[27]),
    homeDisplayNeedsReview: row[28] === true || row[28] === 'TRUE',
    missingStreak: Number(row[29]) || 0,
  };
}

/** 旧「情報アイテム変換結果」シートから新しい`information_items`シートへ、初回だけ移行する。 */
function migrateLegacySheetIfNeeded_() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty(LEGACY_MIGRATION_FLAG_KEY_) === 'done') return;

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var legacySheet = ss.getSheetByName(LEGACY_SHEET_NAME_);
  var newSheet = ss.getSheetByName(INFO_ITEMS_SHEET_NAME);

  if (!legacySheet || newSheet) {
    // 旧シートが無い（新規導入）、または新シートが既にある（移行済みだがフラグ未設定）場合はスキップ。
    props.setProperty(LEGACY_MIGRATION_FLAG_KEY_, 'done');
    return;
  }

  var lastRow = legacySheet.getLastRow();
  var migratedById = {};

  if (lastRow >= 2) {
    var values = legacySheet.getRange(2, 1, lastRow - 1, LEGACY_COLUMN_COUNT_).getValues();
    values.forEach(function (row) {
      var id = row[0];
      if (!id) return;
      var idStr = String(id);
      var sourceId =
        idStr.indexOf('pmda_recall_') === 0 ? 'pmda_recall' : idStr.indexOf('mhlw_supply_') === 0 ? 'mhlw_supply' : 'unknown';
      var sourceRecordId = idStr.replace(/^(pmda_recall_|mhlw_supply_)/, '');
      var fetchedAtIso = normalizeFetchedAtValue_(row[14]) || new Date().toISOString();

      migratedById[id] = {
        id: id,
        sourceId: sourceId,
        sourceRecordId: sourceRecordId,
        category: row[1] || 'pharmacy',
        itemType: row[2] || '',
        title: row[3] || '',
        summary: row[4] || '',
        aiImportance: row[5] || 'info',
        reviewStatus: row[6] || 'unreviewed',
        publishedAt: row[7] || '',
        sourceName: row[8] || '',
        documentNumber: row[9] || null,
        pharmacyImpact: row[10] || '',
        requiredAction: row[11] || null,
        primaryUrl: row[12] || '',
        remarks: row[13] || '',
        // 移行直後はハッシュ未計算（null）。mergeSourceItems_の仕様により、
        // 次回取得時は「unchanged」として扱われ、確認状態は失われない。
        contentHash: null,
        previousContentHash: null,
        changeStatus: 'unchanged',
        firstFetchedAt: fetchedAtIso,
        lastFetchedAt: fetchedAtIso,
        lastChangedAt: null,
        confirmedImportance: row[15] || null,
        importanceConfirmedBy: row[16] || null,
        importanceConfirmedAt: normalizeFetchedAtValue_(row[17]),
        homeDisplayConfirmed: row[18] === true || row[18] === 'TRUE',
        homeDisplayConfirmedBy: row[19] || null,
        homeDisplayConfirmedAt: normalizeFetchedAtValue_(row[20]),
        homeDisplayNeedsReview: false,
        missingStreak: 0,
      };
    });
  }

  writeInformationItemsSheet_(migratedById);
  legacySheet.setName(LEGACY_BACKUP_SHEET_NAME_);
  props.setProperty(LEGACY_MIGRATION_FLAG_KEY_, 'done');
  Logger.log(
    '旧シートから ' +
      Object.keys(migratedById).length +
      ' 件を ' +
      INFO_ITEMS_SHEET_NAME +
      ' へ移行しました（旧シートは「' +
      LEGACY_BACKUP_SHEET_NAME_ +
      '」として保持しています。削除はしていません）。',
  );
}

/** `information_items`シートの現在の内容を、id をキーにしたオブジェクトとして読み込む。 */
function readExistingItemsById_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(INFO_ITEMS_SHEET_NAME);
  var result = {};
  if (!sheet) return result;
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return result;
  var values = sheet.getRange(2, 1, lastRow - 1, INFO_ITEMS_COLUMN_COUNT).getValues();
  values.forEach(function (row) {
    var id = row[0];
    if (!id) return;
    result[id] = rowToItemState_(row);
  });
  return result;
}

/**
 * マージ済みの状態（byId）を`information_items`シートへ書き込む。
 * 注意：シートの削除・作り直し（deleteSheet/insertSheet）はしない。
 * byIdは常に「これまでの全idを含むスーパーセット」である前提（applyFetchResultsToState_が保証する）
 * ため、ここでの一括setValuesは「削除して作り直す」のではなく「現在状態を丸ごと書き戻す」動作になる。
 */
function writeInformationItemsSheet_(byId) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(INFO_ITEMS_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(INFO_ITEMS_SHEET_NAME);
  }
  if (sheet.getLastRow() === 0) {
    sheet.setFrozenRows(1);
  }
  // 見出し行は毎回書き直す（列を追加した際に、既存シートの見出しが古いまま
  // 残ってしまわないようにするため。冪等な操作なので毎回実行しても害はない）。
  sheet.getRange(1, 1, 1, INFO_ITEMS_HEADER_.length).setValues([INFO_ITEMS_HEADER_]);

  var ids = Object.keys(byId).sort();
  var rows = ids.map(function (id) {
    var it = byId[id];
    return [
      it.id,
      it.sourceId,
      it.sourceRecordId,
      it.category,
      it.itemType,
      it.title,
      it.summary,
      it.aiImportance,
      it.reviewStatus,
      it.publishedAt,
      it.sourceName,
      it.documentNumber,
      it.pharmacyImpact,
      it.requiredAction,
      it.primaryUrl,
      it.remarks,
      it.contentHash,
      it.previousContentHash,
      it.changeStatus,
      it.firstFetchedAt,
      it.lastFetchedAt,
      it.lastChangedAt,
      it.confirmedImportance,
      it.importanceConfirmedBy,
      it.importanceConfirmedAt,
      it.homeDisplayConfirmed,
      it.homeDisplayConfirmedBy,
      it.homeDisplayConfirmedAt,
      it.homeDisplayNeedsReview,
      it.missingStreak || 0,
    ];
  });

  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, INFO_ITEMS_COLUMN_COUNT).setValues(rows);
  }

  // 件数が減った場合（通常は減らない想定だが、念のため）、余った古い行の中身だけ消す。
  var lastRow = sheet.getLastRow();
  var expectedLastRow = rows.length + 1;
  if (lastRow > expectedLastRow) {
    sheet.getRange(expectedLastRow + 1, 1, lastRow - expectedLastRow, INFO_ITEMS_COLUMN_COUNT).clearContent();
  }
}

function appendHistoryEntries_(entries) {
  if (!entries || entries.length === 0) return;
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(HISTORY_SHEET_NAME_);
  if (!sheet) {
    sheet = ss.insertSheet(HISTORY_SHEET_NAME_);
    sheet.appendRow(HISTORY_HEADER_);
    sheet.setFrozenRows(1);
  }
  var rows = entries.map(function (e) {
    return [e.itemId, e.sourceId, e.detectedAt, e.previousHash, e.newHash, e.previousSummary, e.newSummary, e.diffNote];
  });
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, HISTORY_HEADER_.length).setValues(rows);
}

/**
 * information_item_historyシートの全行（配列の配列、HISTORY_HEADER_の並び）から、
 * 指定したitemIdの履歴だけを抜き出し、新しい順（detectedAt降順）に並べ、
 * 画面表示用のオブジェクト配列にする（純粋関数）。
 * ハッシュ値（previousHash/newHash）はデバッグ用の内部情報のため画面には出さない。
 */
function filterAndFormatHistoryRows_(rows, itemId) {
  var matched = rows.filter(function (row) {
    return row[0] === itemId;
  });
  matched.sort(function (a, b) {
    var aTime = new Date(a[2]).getTime();
    var bTime = new Date(b[2]).getTime();
    return bTime - aTime;
  });
  return matched.map(function (row) {
    return {
      detectedAt: normalizeFetchedAtValue_(row[2]),
      previousSummary: row[5] || null,
      newSummary: row[6] || '',
      diffNote: row[7] || null,
    };
  });
}

/** 指定したitemIdの変更履歴（新しい順）をシートから読んで返す。最大50件まで。 */
function getHistoryForItem_(itemId) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(HISTORY_SHEET_NAME_);
  if (!sheet) return [];
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var values = sheet.getRange(2, 1, lastRow - 1, HISTORY_HEADER_.length).getValues();
  return filterAndFormatHistoryRows_(values, itemId).slice(0, 50);
}

function appendRunLogs_(logs) {
  if (!logs || logs.length === 0) return;
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(RUN_LOG_SHEET_NAME_);
  if (!sheet) {
    sheet = ss.insertSheet(RUN_LOG_SHEET_NAME_);
    sheet.setFrozenRows(1);
  }
  // information_itemsと同様、見出し行は列追加に備えて毎回書き直す。
  sheet.getRange(1, 1, 1, RUN_LOG_HEADER_.length).setValues([RUN_LOG_HEADER_]);
  var rows = logs.map(function (l) {
    return [
      l.sourceId,
      l.startedAt,
      l.finishedAt,
      l.success,
      l.fetchedCount,
      l.addedCount,
      l.updatedCount,
      l.unchangedCount,
      l.resolvedCount,
      l.missingCount,
      l.errorMessage,
    ];
  });
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, RUN_LOG_HEADER_.length).setValues(rows);
}

/** 情報源ごとの最新の実行結果・最新の成功結果を返す（画面の「情報源ごとの取得状況」表示用）。 */
function getLatestSourceRunStatuses_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(RUN_LOG_SHEET_NAME_);
  if (!sheet) return [];
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var values = sheet.getRange(2, 1, lastRow - 1, RUN_LOG_HEADER_.length).getValues();

  var latestBySource = {};
  var latestSuccessBySource = {};
  values.forEach(function (row) {
    var sourceId = row[0];
    var entry = {
      sourceId: sourceId,
      startedAt: row[1],
      finishedAt: row[2],
      success: row[3] === true || row[3] === 'TRUE',
      fetchedCount: row[4],
      addedCount: row[5],
      updatedCount: row[6],
      unchangedCount: row[7],
      resolvedCount: row[8],
      missingCount: row[9],
      errorMessage: row[10] || null,
    };
    latestBySource[sourceId] = entry; // 後の行ほど新しいので、最後まで見た結果が最新
    if (entry.success) latestSuccessBySource[sourceId] = entry;
  });

  return Object.keys(latestBySource).map(function (sourceId) {
    var latest = latestBySource[sourceId];
    var latestSuccess = latestSuccessBySource[sourceId];
    return {
      sourceId: sourceId,
      label: SOURCE_LABELS_[sourceId] || sourceId,
      lastRunAt: latest.finishedAt,
      success: latest.success,
      fetchedCount: latest.success ? latest.fetchedCount : latestSuccess ? latestSuccess.fetchedCount : 0,
      lastSuccessAt: latestSuccess ? latestSuccess.finishedAt : null,
      errorMessage: latest.success ? null : latest.errorMessage,
    };
  });
}

// ---- PMDA回収情報：ネットワーク取得（GAS依存） ----

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
    if (text.charCodeAt(0) === 0xfeff) {
      text = text.substring(1);
    }

    var table = Utilities.parseCsv(text);
    if (!table || table.length < 2) {
      Logger.log('CSVの行数が想定より少ない');
      return [];
    }

    var header = table[0];
    if (header.length !== CSV_COLUMNS.length) {
      Logger.log(
        '警告：見出しの列数が想定(' + CSV_COLUMNS.length + ')と異なる(' + header.length + ')。PMDA側でCSVの形式が変わった可能性がある。',
      );
    }

    return table.slice(1);
  } catch (e) {
    Logger.log('取得・解析中にエラー: ' + e);
    return null;
  }
}

/**
 * 指定したクラス（1/2/3）のPMDA回収情報を取得し、
 * { sourceId, success, items, fetchedAt, error } の形で返す。
 * 「取得成功で0件」と「通信・解析失敗」を明確に区別する
 * （fetchAndParseCsv_がnullを返す＝失敗、空配列を返す＝成功で0件）。
 *
 * クラスごとに独立したsourceIdで結果を返す（PMDA_RECALL_CLASSES_参照）。これにより、
 * 呼び出し側（runConvertAllToInformationItems）でクラスごとに成功/失敗を分離して
 * source_run_logsに記録でき、1クラスの取得失敗が他クラスの更新を巻き込まない。
 */
function fetchPmdaRecallSourceResult_(recallClass, sourceId) {
  var startedAt = new Date().toISOString();
  var candidates = pmdaFiscalYearCandidatesForClass_(new Date(), recallClass);
  var rows = null;
  var usedUrl = null;
  var lastError = null;

  for (var i = 0; i < candidates.length; i++) {
    var c = candidates[i];
    var url = 'https://www.info.pmda.go.jp/kaisyuu/rcidx' + c.fiscalYear2Digit + '-' + c.recallClass + 'm.csv';
    var result = fetchAndParseCsv_(url);
    if (result === null) {
      lastError = url + ' の取得または解析に失敗しました';
      continue;
    }
    if (result.length > 0) {
      rows = result;
      usedUrl = url;
      break;
    }
    // 0件だった場合（年度切替直後など）は次の候補を試す
    rows = result;
    usedUrl = url;
  }

  var fetchedAtIso = new Date().toISOString();

  if (rows === null) {
    return {
      sourceId: sourceId,
      success: false,
      items: [],
      fetchedAt: fetchedAtIso,
      startedAt: startedAt,
      error: lastError || 'PMDA回収情報（クラス' + recallClass + '）の取得に失敗しました（候補年度すべて）',
    };
  }

  var listPageUrl = usedUrl.replace('.csv', '.html');
  var items = buildPmdaIncomingItems_(rows, listPageUrl, fetchedAtIso);

  return { sourceId: sourceId, success: true, items: items, fetchedAt: fetchedAtIso, startedAt: startedAt, error: null };
}

/** PMDA_RECALL_CLASSES_の全クラス（I・II・III）を取得し、結果の配列を返す。 */
function fetchAllPmdaRecallSourceResults_() {
  return PMDA_RECALL_CLASSES_.map(function (c) {
    return fetchPmdaRecallSourceResult_(c.recallClass, c.sourceId);
  });
}

// ---- 厚労省供給状況：ネットワーク取得（GAS依存） ----

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
  var match = html.match(/(?:https:\/\/www\.mhlw\.go\.jp)?\/content\/10800000\/\d{6}iyakuhinkyoukyu\.xlsx/);
  if (!match) {
    Logger.log('供給状況ページ内にExcelファイルへのリンクが見つかりませんでした（ページ構成が変わった可能性）。');
    return null;
  }
  var found = match[0];
  return found.indexOf('http') === 0 ? found : 'https://www.mhlw.go.jp' + found;
}

/**
 * 供給状況Excelを取得し、Googleスプレッドシートに変換してから中身を配列で返す。
 * 変換用に作った一時ファイルは読み終わったら削除する。
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
    Logger.log('Excel変換・読み込み中にエラー: ' + e + '（「サービス」にDrive APIを追加し忘れていないか確認してください）');
    return null;
  } finally {
    if (tempFileId) {
      try {
        Drive.Files.remove(tempFileId);
      } catch (e2) {
        Logger.log('一時ファイルの削除に失敗（Driveに残っている可能性、手動で削除してください）: ' + e2);
      }
    }
  }
}

/**
 * 供給状況Excelを取得し、YJコードごとの現在状態（currentByYjCode）を返す。
 * この段階では「限定出荷・供給停止だけに絞り込む」処理はしない（全件保持する）。
 * 絞り込み・解消判定はbuildMhlwSupplyIncomingItems_（純粋関数）が行う。
 */
function fetchMhlwSupplySourceRawData_() {
  var startedAt = new Date().toISOString();
  var table = fetchMhlwSupplyRawTable_();
  if (!table) {
    return { success: false, error: '供給状況ページまたはExcelの取得に失敗しました', startedAt: startedAt };
  }

  var values = table.values;
  var headerRowIndex = findMhlwSupplyHeaderRowIndex_(values);
  if (headerRowIndex === -1) {
    return { success: false, error: '見出し行（「出荷対応」を含む行）が見つかりませんでした', startedAt: startedAt };
  }

  var idx = findMhlwSupplyColumnIndices_(values[headerRowIndex]);
  if (idx.shippingStatus === undefined) {
    return { success: false, error: '「出荷対応」列の位置が特定できませんでした', startedAt: startedAt };
  }

  var currentByYjCode = {};
  for (var r = headerRowIndex + 1; r < values.length; r++) {
    var row = values[r];
    var yjCode = idx.yjCode !== undefined ? String(row[idx.yjCode] || '').trim() : '';
    if (!yjCode) continue;
    var status = idx.shippingStatus !== undefined ? String(row[idx.shippingStatus] || '').trim() : '';
    currentByYjCode[yjCode] = {
      status: status,
      fields: {
        productName: idx.productName !== undefined ? String(row[idx.productName] || '').trim() : '',
        genericName: idx.genericName !== undefined ? String(row[idx.genericName] || '').trim() : '',
        manufacturer: idx.manufacturer !== undefined ? String(row[idx.manufacturer] || '').trim() : '',
        volume: idx.shippingVolume !== undefined ? String(row[idx.shippingVolume] || '').trim() : '',
        reason: idx.reason !== undefined ? String(row[idx.reason] || '').trim() : '',
        startDate: idx.startDate !== undefined ? formatMhlwDateCell_(row[idx.startDate]) : '',
        resolution: idx.resolution !== undefined ? formatMhlwDateCell_(row[idx.resolution]) : '',
      },
    };
  }

  return { success: true, currentByYjCode: currentByYjCode, sourceUrl: table.sourceUrl, startedAt: startedAt };
}

/**
 * 厚労省供給状況を取得し、{ sourceId, success, items, fetchedAt, error } の形で返す。
 * existingMhlwSourceRecordIds（現在追跡中のYJコード一覧）を渡すことで、
 * 供給再開（解消）の判定に使う。
 */
function fetchMhlwSupplySourceResult_(existingMhlwStates) {
  var raw = fetchMhlwSupplySourceRawData_();
  var fetchedAtIso = new Date().toISOString();
  if (!raw.success) {
    return { sourceId: 'mhlw_supply', success: false, items: [], fetchedAt: fetchedAtIso, startedAt: raw.startedAt, error: raw.error };
  }
  var items = buildMhlwSupplyIncomingItems_(raw.currentByYjCode, existingMhlwStates, raw.sourceUrl, fetchedAtIso);
  return { sourceId: 'mhlw_supply', success: true, items: items, fetchedAt: fetchedAtIso, startedAt: raw.startedAt, error: null };
}

// ---- Mindsガイドラインライブラリ「お知らせ」：ネットワーク取得（GAS依存） ----

var MINDS_NEWS_LIST_URL = 'https://minds.jcqhc.or.jp/news/';

/**
 * Mindsお知らせ一覧（1ページ目・最新10件程度）を取得し、
 * { sourceId, success, items, fetchedAt, error } の形で返す。
 * 更新頻度が週1〜数件程度のため、1ページ目のみの取得で日次実行なら取りこぼしの
 * 心配はほぼ無い（合意済みの方針）。PMDA・厚労省と同様、他の情報源とは独立した
 * sourceId（minds_guideline）として成功/失敗を記録する。
 */
function fetchMindsGuidelineSourceResult_() {
  var startedAt = new Date().toISOString();
  try {
    var response = UrlFetchApp.fetch(MINDS_NEWS_LIST_URL, { muteHttpExceptions: true, followRedirects: true });
    var code = response.getResponseCode();
    if (code !== 200) {
      return {
        sourceId: 'minds_guideline',
        success: false,
        items: [],
        fetchedAt: new Date().toISOString(),
        startedAt: startedAt,
        error: 'お知らせ一覧ページの取得に失敗しました（HTTP ' + code + '）',
      };
    }

    var html = response.getContentText('UTF-8');
    var entries = extractMindsNewsEntries_(html);
    if (entries.length === 0) {
      Logger.log('Mindsお知らせ一覧からリンクを1件も抽出できませんでした。ページ構成が変わった可能性があります。');
    }

    var fetchedAtIso = new Date().toISOString();
    var items = buildMindsIncomingItems_(entries, MINDS_NEWS_LIST_URL, fetchedAtIso);

    return { sourceId: 'minds_guideline', success: true, items: items, fetchedAt: fetchedAtIso, startedAt: startedAt, error: null };
  } catch (e) {
    return {
      sourceId: 'minds_guideline',
      success: false,
      items: [],
      fetchedAt: new Date().toISOString(),
      startedAt: startedAt,
      error: 'お知らせ一覧の取得・解析中にエラー: ' + e,
    };
  }
}

/** existingByIdのうち、指定したsourceIdの分だけを sourceRecordId をキーにした形で取り出す。 */
function pickStatesBySourceId_(existingById, sourceId) {
  var result = {};
  Object.keys(existingById).forEach(function (id) {
    var state = existingById[id];
    if (state.sourceId === sourceId) {
      result[state.sourceRecordId] = state;
    }
  });
  return result;
}

// ---- 実行エントリーポイント ----

/**
 * PMDA回収情報・厚労省供給状況・Mindsガイドラインお知らせの3系統を取得し、
 * information_itemsへ安全にマージする。毎朝の自動実行（トリガー）・手動実行の両方から呼ばれる。
 *
 * ロックの取り方（v3.1で見直し）：外部取得はネットワーク越しで数秒〜十数秒かかることがあるため、
 * その間ずっとロックを保持すると、その間に人間が確認ボタンを押した操作がタイムアウトしやすくなる。
 * そこで、
 *   1. ロックを取らずに外部データを取得する（下準備として、取得前のexistingByIdも読んでおく）
 *   2. シートの読み書きだけをロックで保護する。ロックを取った直後に existingById を
 *      読み直すことで、取得中に人間が行った変更を取りこぼさない
 * という2段階に分けている。
 */
function runConvertAllToInformationItems() {
  migrateLegacySheetIfNeeded_();

  var preFetchExistingById = readExistingItemsById_();
  var existingMhlwStates = pickStatesBySourceId_(preFetchExistingById, 'mhlw_supply');

  var pmdaResults = fetchAllPmdaRecallSourceResults_(); // クラスI・II・IIIをそれぞれ独立して取得
  var mhlwResult = fetchMhlwSupplySourceResult_(existingMhlwStates);
  var mindsResult = fetchMindsGuidelineSourceResult_();

  var lock = LockService.getScriptLock();
  var gotLock = false;
  try {
    gotLock = lock.tryLock(10000);
  } catch (e) {
    gotLock = false;
  }
  if (!gotLock) {
    Logger.log(
      'シート更新の直前で他の処理と競合したため、今回の取得結果は保存されませんでした（ロック取得失敗。次回の自動実行で再取得されます）。',
    );
    return;
  }

  try {
    // ロックを取った直後に最新状態を読み直す（取得中に行われた人間の操作を取りこぼさないため）。
    var existingById = readExistingItemsById_();
    var nowIso = new Date().toISOString();
    var applied = applyFetchResultsToState_(existingById, pmdaResults.concat([mhlwResult, mindsResult]), nowIso);

    writeInformationItemsSheet_(applied.updatedById);
    appendHistoryEntries_(applied.historyEntries);
    appendRunLogs_(applied.runLogs);

    var pmdaSummary = pmdaResults
      .map(function (r) {
        return r.sourceId + ': ' + (r.success ? '成功(' + r.items.length + '件)' : '失敗: ' + r.error);
      })
      .join(' / ');
    Logger.log(
      pmdaSummary +
        ' / 厚労省供給: ' +
        (mhlwResult.success ? '成功(' + mhlwResult.items.length + '件)' : '失敗: ' + mhlwResult.error) +
        ' / Mindsガイドライン: ' +
        (mindsResult.success ? '成功(' + mindsResult.items.length + '件)' : '失敗: ' + mindsResult.error),
    );
  } finally {
    lock.releaseLock();
  }
}

/**
 * 情報源を1つだけ取得してマージする共通処理（単体デバッグ実行用）。
 * fetchResultsBuilderFn は「取得前のexistingById（ロック取得前の下準備用）」を受け取り、
 * fetchResults配列を返す関数。ネットワーク取得はロックの外で行う。
 */
function runSingleSourceConversion_(fetchResultsBuilderFn) {
  migrateLegacySheetIfNeeded_();
  var preFetchExistingById = readExistingItemsById_();
  var results = fetchResultsBuilderFn(preFetchExistingById);

  var lock = LockService.getScriptLock();
  var gotLock = false;
  try {
    gotLock = lock.tryLock(10000);
  } catch (e) {
    gotLock = false;
  }
  if (!gotLock) {
    Logger.log('シート更新の直前で他の処理と競合したため、今回の取得結果は保存されませんでした（ロック取得失敗）。');
    return;
  }
  try {
    var existingById = readExistingItemsById_();
    var nowIso = new Date().toISOString();
    var applied = applyFetchResultsToState_(existingById, results, nowIso);
    writeInformationItemsSheet_(applied.updatedById);
    appendHistoryEntries_(applied.historyEntries);
    appendRunLogs_(applied.runLogs);
    Logger.log('単体実行完了: ' + JSON.stringify(applied.runLogs));
  } finally {
    lock.releaseLock();
  }
}

/** PMDA回収情報（クラスI・II・III）だけを取得してマージする（動作確認用の単体実行）。 */
function runConvertPmdaRecallToInformationItems() {
  runSingleSourceConversion_(function () {
    return fetchAllPmdaRecallSourceResults_();
  });
}

/**
 * 【1回だけ実行する後片付け用】v3.2の一時的な不具合で作られてしまった、
 * id が "pmda_recall_class1_"「pmda_recall_class2_」「pmda_recall_class3_」で
 * 始まる重複行（本来は"pmda_recall_"のみで良かった）をinformation_itemsシートから削除する。
 *
 * 対象：このコード修正（id生成をsourceId無しに戻した版）を反映する前に
 * runConvertAllToInformationItems / runConvertPmdaRecallToInformationItems を
 * 一度でも実行したことがある場合のみ影響がある。該当行が無ければ「0件削除」と出るだけで、
 * 何度実行しても安全（誤って余分に削除することはない）。
 *
 * 実行後、あらためて runConvertAllToInformationItems を実行して、
 * クラスI・II・IIIを本来のid（pmda_recall_ + 回収番号）で正しくマージし直すこと。
 */
function runCleanupBuggyClassPrefixedPmdaIds() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(INFO_ITEMS_SHEET_NAME);
  if (!sheet) {
    Logger.log('information_itemsシートが見つかりません。何もしていません。');
    return;
  }
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    Logger.log('データ行がありません。何もしていません。');
    return;
  }

  var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  var buggyIdPattern = /^pmda_recall_class[123]_/;
  var rowsToDelete = [];
  for (var i = 0; i < ids.length; i++) {
    if (buggyIdPattern.test(String(ids[i][0]))) {
      rowsToDelete.push(i + 2); // 1行目は見出しなので+2
    }
  }

  if (rowsToDelete.length === 0) {
    Logger.log('対象の行はありませんでした（0件削除）。既にきれいな状態か、まだこの不具合の影響を受けていません。');
    return;
  }

  // 下の行から順に削除しないと、削除のたびに行番号がずれて別の行を消してしまう
  for (var j = rowsToDelete.length - 1; j >= 0; j--) {
    sheet.deleteRow(rowsToDelete[j]);
  }

  Logger.log(
    rowsToDelete.length +
      '件の重複行を削除しました。この後もう一度 runConvertAllToInformationItems を実行して、正しいidで再取得・マージしてください。',
  );
}

/** 厚労省供給状況だけを取得してマージする（動作確認用の単体実行）。 */
function runConvertMhlwSupplyToInformationItems() {
  runSingleSourceConversion_(function (preFetchExistingById) {
    var existingMhlwStates = pickStatesBySourceId_(preFetchExistingById, 'mhlw_supply');
    return [fetchMhlwSupplySourceResult_(existingMhlwStates)];
  });
}

/** Mindsガイドラインお知らせだけを取得してマージする（動作確認用の単体実行）。 */
function runConvertMindsGuidelineToInformationItems() {
  runSingleSourceConversion_(function () {
    return [fetchMindsGuidelineSourceResult_()];
  });
}

/* ============================================================
 * セクションC：Web App化（doGet / doPost）
 * ============================================================ */

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

var WATCH_SETTINGS_PROPERTY_KEY = 'WATCH_SETTINGS_JSON';

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
 * アプリからの読み込み。information_itemsシートの中身、ウォッチ設定、
 * 情報源ごとの取得状況（sourceStatuses）をまとめて返す。
 *
 * 注意（現状のセキュリティレベル）：このWeb Appは「アクセスできるユーザー：全員」で
 * 公開されているPoCです。読み取り専用のdoGetは実害が小さいためこのままにしていますが、
 * URLを知っていれば誰でもこのデータを閲覧できる状態です。
 */
function doGet(e) {
  var action = e && e.parameter && e.parameter.action;

  if (action === 'history') {
    var itemId = e.parameter.itemId;
    if (!itemId) {
      return jsonResponse_({ error: 'itemIdが指定されていません' });
    }
    return jsonResponse_({ itemId: itemId, history: getHistoryForItem_(itemId) });
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(INFO_ITEMS_SHEET_NAME);
  var now = new Date().toISOString();

  if (!sheet || sheet.getLastRow() < 2) {
    return jsonResponse_({
      items: [],
      generatedAt: now,
      watchSettings: getWatchSettings_(),
      sourceStatuses: getLatestSourceRunStatuses_(),
    });
  }

  var lastRow = sheet.getLastRow();
  var values = sheet.getRange(2, 1, lastRow - 1, INFO_ITEMS_COLUMN_COUNT).getValues();

  var items = values.map(function (row) {
    var state = rowToItemState_(row);
    return {
      id: state.id,
      sourceId: state.sourceId,
      category: state.category,
      itemType: state.itemType,
      title: state.title,
      summary: state.summary,
      aiImportance: state.aiImportance,
      confirmedImportance: state.confirmedImportance,
      importanceConfirmedBy: state.importanceConfirmedBy,
      importanceConfirmedAt: state.importanceConfirmedAt,
      reviewStatus: state.reviewStatus,
      publishedAt: state.publishedAt,
      fetchedAt: state.firstFetchedAt || now,
      lastFetchedAt: state.lastFetchedAt,
      lastChangedAt: state.lastChangedAt,
      changeStatus: state.changeStatus,
      missingStreak: state.missingStreak,
      sourceName: state.sourceName,
      documentNumber: state.documentNumber,
      pharmacyImpact: state.pharmacyImpact,
      requiredAction: state.requiredAction,
      actionDeadline: null,
      homeDisplayConfirmed: state.homeDisplayConfirmed,
      homeDisplayConfirmedBy: state.homeDisplayConfirmedBy,
      homeDisplayConfirmedAt: state.homeDisplayConfirmedAt,
      homeDisplayNeedsReview: state.homeDisplayNeedsReview,
      links: state.primaryUrl ? [{ label: linkLabelForItemType_(state.itemType), url: state.primaryUrl, kind: 'primary' }] : [],
      fetchError: null,
    };
  });

  return jsonResponse_({
    items: items,
    generatedAt: now,
    watchSettings: getWatchSettings_(),
    sourceStatuses: getLatestSourceRunStatuses_(),
  });
}

/**
 * アプリからの更新（内容確認・重要度確定・HOME表示確定・ウォッチ設定変更）を受け取る。
 * LockServiceで排他制御し、内容はホワイトリスト方式で検証、業務ルールもサーバー側で強制する。
 *
 * 重要な注意（現状のセキュリティレベル）：入力値検証は追加したが、認証（本人確認）は
 * まだ実装していない。URLを知っている人なら誰でもこのエンドポイントを呼び出せる。
 * 本番運用の前には、認証付き中継バックエンドまたは共通ログイン基盤が必須の課題として残っている。
 */
function doPost(e) {
  var lock = LockService.getScriptLock();
  var gotLock = false;
  try {
    gotLock = lock.tryLock(10000);
  } catch (lockErr) {
    gotLock = false;
  }
  if (!gotLock) {
    return jsonResponse_({ ok: false, error: 'サーバーが混み合っています。少し待ってから再度お試しください（ロック取得失敗）。' });
  }

  try {
    var body;
    try {
      body = JSON.parse(e.postData.contents);
    } catch (parseErr) {
      return jsonResponse_({ ok: false, error: 'リクエスト本文の解析に失敗しました' });
    }

    if (body.action === 'updateItemStatus') {
      return handleUpdateItemStatus_(body);
    }
    if (body.action === 'updateWatchSettings') {
      return handleUpdateWatchSettings_(body);
    }
    return jsonResponse_({ ok: false, error: '不明なaction: ' + body.action });
  } catch (err) {
    Logger.log('doPost処理中にエラー: ' + err);
    return jsonResponse_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function handleUpdateItemStatus_(body) {
  var validation = validateUpdateItemStatusInput_(body);
  if (!validation.valid) {
    return jsonResponse_({ ok: false, error: validation.error });
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(INFO_ITEMS_SHEET_NAME);
  if (!sheet) {
    return jsonResponse_({ ok: false, error: INFO_ITEMS_SHEET_NAME + ' シートがありません。先に runConvertAllToInformationItems を実行してください。' });
  }

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return jsonResponse_({ ok: false, error: INFO_ITEMS_SHEET_NAME + ' シートにデータがありません。' });
  }

  var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  var targetRow = -1;
  for (var i = 0; i < ids.length; i++) {
    if (ids[i][0] === body.id) {
      targetRow = i + 2;
      break;
    }
  }
  if (targetRow === -1) {
    return jsonResponse_({ ok: false, error: '指定されたidの行が見つかりません: ' + body.id });
  }

  var existingRow = sheet.getRange(targetRow, 1, 1, INFO_ITEMS_COLUMN_COUNT).getValues()[0];
  var existingState = rowToItemState_(existingRow);

  var ruleCheck = businessRuleAllowsUpdate_(
    {
      reviewStatus: existingState.reviewStatus,
      confirmedImportance: existingState.confirmedImportance,
      homeDisplayNeedsReview: existingState.homeDisplayNeedsReview,
    },
    body,
  );
  if (!ruleCheck.allowed) {
    return jsonResponse_({ ok: false, error: ruleCheck.error });
  }

  var now = new Date().toISOString();
  var confirmedBy = typeof body.confirmedBy === 'string' ? body.confirmedBy.slice(0, MAX_CONFIRMED_BY_LENGTH_) : '';

  // 列番号はINFO_ITEMS_HEADER_の並びに対応（1始まり）。
  if (body.reviewStatus !== undefined) {
    sheet.getRange(targetRow, 9).setValue(body.reviewStatus); // reviewStatus
  }
  if (body.confirmedImportance !== undefined) {
    sheet.getRange(targetRow, 23).setValue(body.confirmedImportance); // confirmedImportance
    sheet.getRange(targetRow, 24).setValue(confirmedBy); // importanceConfirmedBy
    sheet.getRange(targetRow, 25).setValue(now); // importanceConfirmedAt
  }
  if (body.homeDisplayConfirmed !== undefined) {
    sheet.getRange(targetRow, 26).setValue(body.homeDisplayConfirmed); // homeDisplayConfirmed
    sheet.getRange(targetRow, 27).setValue(confirmedBy); // homeDisplayConfirmedBy
    sheet.getRange(targetRow, 28).setValue(now); // homeDisplayConfirmedAt
  }
  // 「再確認必要」フラグは、明示的に「内容を確認済みにする」（reviewStatus: 'reviewed'）を
  // 行った時だけ解除する。重要度だけ・HOME表示だけの操作では解除しない
  // （内容を見ずに重要度やHOME表示を触っただけで警告が消えてしまうのを防ぐため）。
  if (body.reviewStatus === 'reviewed') {
    sheet.getRange(targetRow, 29).setValue(false); // homeDisplayNeedsReview
  }

  return jsonResponse_({ ok: true });
}

/**
 * ウォッチ設定の更新。既知のIDはコード側に固定した ALLOWED_WATCH_IDS_ を必ず使う
 * （まだ一度も保存されていない場合にgetWatchSettings_がnullを返し、任意のIDを
 * 保存できてしまう問題を防ぐため）。
 */
function handleUpdateWatchSettings_(body) {
  var validation = validateWatchSettingsInput_(body.settings, ALLOWED_WATCH_IDS_);
  if (!validation.valid) {
    return jsonResponse_({ ok: false, error: validation.error });
  }
  saveWatchSettings_(body.settings);
  return jsonResponse_({ ok: true });
}

/* ============================================================
 * セクションD：定期自動実行（時間主導トリガー）の設定
 * ------------------------------------------------------------
 * v2から関数名（runConvertAllToInformationItems）を変えていないため、
 * 既にsetupDailyTriggerを実行済みであれば、トリガーの再作成は不要。
 * ============================================================ */

var DAILY_TRIGGER_HANDLER_FUNCTION = 'runConvertAllToInformationItems';
var DAILY_TRIGGER_HOUR = 7; // 毎朝7時台に実行（実際の発火時刻はGASの仕様で±15分程度前後する）

function setupDailyTrigger() {
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

  Logger.log('毎日' + DAILY_TRIGGER_HOUR + '時台に ' + DAILY_TRIGGER_HANDLER_FUNCTION + ' を自動実行するトリガーを設定しました。');
}

function listTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  if (triggers.length === 0) {
    Logger.log('現在、設定されているトリガーはありません。');
    return;
  }
  triggers.forEach(function (trigger) {
    Logger.log('関数: ' + trigger.getHandlerFunction() + ' / 種類: ' + trigger.getEventType() + ' / トリガーID: ' + trigger.getUniqueId());
  });
}

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

/* ============================================================
 * セクションE：旧バージョン互換のPoC・デバッグ用関数
 * ------------------------------------------------------------
 * 「PMDA_回収情報_PoC」シートへ生のCSVをそのまま書き出すだけの、
 * 最初期の動作確認用スクリプト。information_itemsの仕組みとは独立しており、
 * 削除すると困る場合があるためそのまま残している。
 * ============================================================ */

var PMDA_RECALL_SHEET_NAME = 'PMDA_回収情報_PoC';

function runPmdaRecallCsvPoc() {
  var fiscalYear2Digit = currentJapaneseFiscalYear2Digit_(new Date());
  var recallClass = 1;
  var url = 'https://www.info.pmda.go.jp/kaisyuu/rcidx' + fiscalYear2Digit + '-' + recallClass + 'm.csv';

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
    var recallNumber = row[0];

    if (existingRecallNumbers[recallNumber]) {
      skippedDuplicate++;
      continue;
    }

    var outRow = [fetchedAt].concat(row).concat([sourceUrl]);
    sheet.appendRow(outRow);
    existingRecallNumbers[recallNumber] = true;
    appended++;
  }

  Logger.log('書き込み完了：新規 ' + appended + ' 件、重複スキップ ' + skippedDuplicate + ' 件');
}

function loadExistingRecallNumbers_(sheet) {
  var keys = {};
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return keys;

  var values = sheet.getRange(2, 2, lastRow - 1, 1).getValues();
  for (var i = 0; i < values.length; i++) {
    keys[values[i][0]] = true;
  }
  return keys;
}
