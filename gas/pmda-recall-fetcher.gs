/**
 * 医療情報ウォッチ GAS本体（v3.7.5）
 * ------------------------------------------------------------
 * v3.7.5の変更点（JDS取得の一旦保留）：
 *   ・v3.7.2〜v3.7.4の切り分け（ヘッダー5パターン＋Cookie引き継ぎ＋範囲切り分け）の結果、
 *     日本糖尿病学会のHTTP 400エラーは、ヘッダーの中身やCookieの有無とは無関係で、
 *     お知らせモジュール（/modules/important/・/modules/important_list/）だけが
 *     GAS（Googleのサーバー）からのアクセスを拒否していることが判明した
 *     （サイトのトップページは正常に取得できる）。GAS側でリクエストの中身を
 *     どういじっても再現よく回避する方法が見つからなかったため、フリちゃんと相談の上、
 *     原因不明のまま一旦保留とすることにした。
 *   ・runConvertAllToInformationItems（毎朝の自動実行）から日本糖尿病学会の取得を
 *     外した。他7情報源の取得・変更検知には一切影響しない（設計上、情報源ごとに
 *     独立しているため）。これにより、直しようがないエラーが毎朝ログに積み上がる
 *     状態を止める。
 *   ・取得ロジック本体（fetchJdsAnnouncementSourceResult_・
 *     runConvertJdsAnnouncementToInformationItems等）は削除せず残してある。
 *     将来、JDS側の制限が解除された・別の回避策が見つかった等の理由で再開する場合は、
 *     runConvertAllToInformationItems内のコメントアウトを外すだけでよい。
 *   ・原因切り分け用だったrunDebugJdsFetchVariants（v3.7.2〜v3.7.4で使用）は
 *     役目を終えたため削除した。
 *
 * v3.7.4の変更点（JDS HTTP 400エラーの原因切り分け・続き）：
 *   ・v3.7.3のF・Gパターンの結果、jds.or.jpのトップページ（F）は正常にHTTP 200で
 *     取得できる一方、お知らせの個別記事ページ（G、/modules/important/index.php?
 *     content_id=546）は一覧ページ（A〜E）と全く同じHTTP 400で拒否されることが
 *     判明した。つまり、**サイト全体ではなく「お知らせモジュール
 *     （/modules/important/・/modules/important_list/）だけ」が狙い撃ちで
 *     ガードされている**。これは申し送りメモにあった「サーバー側がお知らせモジュールに
 *     だけCookie必須化・bot対策強化を追加した可能性」を強く裏付ける結果。
 *   ・そこで、よくあるパターン（トップページ等に1回アクセスして検証用Cookieを受け取り、
 *     そのCookieを持っていないと保護対象のページには入れない、という2段階の保護）を
 *     試すため、runDebugJdsFetchVariantsにHパターンを追加した：
 *       H：まずトップページ（https://www.jds.or.jp/）にアクセスしてSet-Cookieヘッダーを
 *          取得し、そのCookieを持たせた状態でお知らせ一覧ページに再アクセスする
 *   ・Hが200になれば「Cookie必須化」が正解で、本番のfetchGakkaiAnnouncementSourceResult_
 *     （日本糖尿病学会側のみ、日本内科学会は影響が無いので触らない）を2段階アクセスに
 *     直せば直る。Hも400のままなら、Cookie以外の要因（IPレンジそのもののブロック等）が
 *     濃厚になり、その場合はGAS側での対応は困難なため、申し送りメモにあった
 *     「原因不明のまま一旦保留する」判断が妥当になる。
 *
 * v3.7.3の変更点（JDS HTTP 400エラーの原因切り分け・続き）：
 *   ・v3.7.2のrunDebugJdsFetchVariants（A〜E、5パターンのヘッダー構成）を実行した結果、
 *     **全パターンで完全に同じHTTP 400**が返ることが判明した（本文も一字一句同じ、
 *     Apacheの素の「Your browser sent a request that this server could not
 *     understand.」という定型文）。ヘッダーなし（v3.7より前の状態相当）でも400が
 *     出ているため、v3.7.1で追加したUser-Agent等のヘッダーが原因ではないと確定した。
 *   ・本文がAI判定やbot検知の警告ページではなくApacheの素の400定型文であることから、
 *     アプリ（PHP）に届く前の、サーバー入口（Apache）レベルでリクエストそのものが
 *     拒否されている可能性が高い。つまりヘッダーの中身の問題ではなく、
 *     「GAS（Googleのサーバー）から来るリクエストという経路自体」が、この特定のURLに
 *     対して拒否されていると考えられる。
 *   ・追加の切り分けとして、runDebugJdsFetchVariants にF・Gの2パターンを追加した：
 *       F：jds.or.jpのトップページ（https://www.jds.or.jp/）を取得できるか
 *          → サイト全体がGASからのアクセスを拒否しているのか、それとも
 *            important_listページだけに何か特別なガードがあるのかを切り分ける
 *       G：お知らせ一覧に載っている個別記事ページ
 *          （https://www.jds.or.jp/modules/important/index.php?content_id=546）を
 *          取得できるか → 「一覧ページ（important_list）」と「個別記事ページ
 *          （important、リンク先そのもの）」で扱いが違うかどうかを切り分ける
 *   ・F・Gの結果次第で次の一手が変わる：
 *       - Fも400 → jds.or.jpドメイン全体がGASからのアクセスを拒否している
 *         （GASのIPレンジ自体がブロック対象。ヘッダーでは解決不可能）
 *       - Fは200・Gも400 → important_list・important配下のモジュール（お知らせ関連）
 *         だけを狙い撃ちでガードしている可能性（bot対策強化が該当箇所だけに入った等）
 *       - Fも200・Gも200・現行のURLだけ400 → important_listの特定のクエリパラメータ
 *         （content_id=1）や、そのページ固有の何かが引っかかっている可能性
 *
 * v3.7.2の変更点（JDS HTTP 400エラーの原因切り分け用デバッグ関数の追加）：
 *   ・v3.7.1でUser-Agent・Accept-Languageヘッダーを追加したにもかかわらず、
 *     日本糖尿病学会（jds_announcement）が依然としてHTTP 400を返す不具合が継続中。
 *     一方、こちら側で同じURLに（GAS以外の経路で）アクセスしたところ普通にHTTP 200が
 *     返り、ページ構成・リンクの形式（buildJdsAnnouncementLinkRegex_が想定する形）も
 *     変わっていないことを確認した。つまりサイト自体は生きており、問題は
 *     「GASからのアクセスだけが何らかの理由で弾かれている」可能性が高い。
 *   ・HTTP 400（リクエスト自体が不正）という返り方は、403（明示的な拒否）とは違い、
 *     「User-Agentはブラウザのふりをしているが、通信の“指紋”（TLSの握手など）は
 *     Googleのサーバーそのもの」という矛盾をサイト側のセキュリティ装置（WAF）が
 *     検知して弾く、というケースでよく見られるパターン。だとすると、v3.7.1で追加した
 *     偽のChrome User-Agentは、直すどころか逆に「怪しさ」を増やした可能性がある。
 *   ・原因を一発で切り分けるため、runDebugJdsFetchVariants（デバッグ用・一時的）を
 *     セクションEに追加した。ヘッダーなし／UAのみ／現行（UA+Accept-Language）／
 *     ブラウザに近いヘッダー一式／followRedirects:falseの5パターンを順番に試し、
 *     それぞれのHTTPステータスをログに出す。シート（information_items等）には
 *     一切書き込まないため、いつ実行しても安全。
 *   ・実行結果（A〜Eそれぞれ何が返ったか）を次回フリちゃんから聞いて、
 *     本番のfetchGakkaiAnnouncementSourceResult_をどう直すか決める：
 *       - Aだけ200 → v3.7.1で追加したヘッダーが逆効果だった。ヘッダーを外す（v3.6以前に戻す）
 *       - Dのみ200 → もっと本物のブラウザに近いヘッダー一式が必要。本番にAccept・Refererを追加
 *       - 全滅（全部400） → GAS（Googleのサーバー）のIP・TLSの特徴自体がブロック対象に
 *         入っている可能性が高く、ヘッダーだけでは解決できない。申し送りメモにあった
 *         「原因不明のまま一旦保留する」判断が妥当（他7情報源には影響しないため実害は限定的）
 *
 * v3.7の不具合修正：
 *   ・日本糖尿病学会のお知らせ取得が突然HTTP 400を返すようになった不具合を修正。
 *     GASのUrlFetchAppはデフォルトでUser-Agentヘッダーを送らないため、これを見て
 *     拒否するサイトがある。学会お知らせ共通の取得関数（fetchGakkaiAnnouncementSourceResult_、
 *     日本内科学会・日本糖尿病学会で共用）に、ブラウザに近いUser-Agent・Accept-Language
 *     ヘッダーを追加した。
 *
 * v3.6からの変更点（日医工お知らせボットの追加）：
 *   ・日医工の医療関係者向けサイト（www.nichiiko.co.jp）の年別お知らせ一覧
 *     （nichiiko_announcement）を新しい情報源として追加。他の情報源と同様、独立した
 *     sourceIdで成功/失敗・変更検知を行うため、1情報源の取得失敗が他情報源に影響しない
 *   ・沢井製薬と同様、会員登録・ログイン不要（確認済み）で一覧がそのままHTMLで取得できる
 *   ・お知らせ一覧のURLは年ごとに変わる（whatsnew/{年}/index.php）ため、日付から
 *     当年・前年のURLを自動算出する（厚労省報道発表の月計算と同じ考え方）
 *   ・このページは新発売・使用上の注意改訂・休業案内等も含めたあらゆるお知らせが
 *     混ざった一覧のため、タイトルに「限定出荷」「出荷停止」「出荷再開」「出荷調整」
 *     「自主回収」「供給状況」「供給停止」「供給再開」のいずれかを含むものだけを
 *     対象にする（フリちゃんと合意済み）
 *   ・タイトルに「回収」を含むものはitemTypeを「回収」、それ以外は「供給」にする
 *     （PMDA・厚労省供給・沢井製薬と同じitemTypeを再利用）
 *   ・日付とタイトルへのリンクが別要素になっているページのため、学会お知らせ・
 *     厚労省報道発表と共通の抽出関数（extractDatedAnnouncementEntries_）を再利用している
 *   詳細はgas/README.mdの「v3.6→v3.7の変更点」を参照。
 *
 * v3.5からの変更点（沢井製薬お知らせボットの追加）：
 *   ・沢井製薬の医療関係者向けサイト（med.sawai.co.jp）トップページに掲載される
 *     お知らせ一覧（sawai_announcement）を新しい情報源として追加。他の情報源と同様、
 *     独立したsourceIdで成功/失敗・変更検知を行うため、1情報源の取得失敗が
 *     他情報源に影響しない
 *   ・沢井製薬のサイトは会員登録・ログインが不要（確認済み）で、お知らせ一覧が
 *     そのままHTMLで取得できる。一方、東和薬品側は職種選択画面（Cookieベースの
 *     簡易な確認画面）が挟まり同じ方式では取得できなかったため、今回は沢井製薬のみ対応
 *   ・お知らせのうち「供給関連」カテゴリと、回収情報セクション（カテゴリラベルが無く
 *     タイトルに「回収」を含むもの）だけを対象にする（フリちゃんと合意済み）。
 *     「安全性・適正使用関連」「電子添文改訂」「包装変更」「その他」は対象外
 *   ・itemTypeは回収情報セクション由来なら「回収」、それ以外（供給関連）なら「供給」に
 *     する（PMDA・厚労省供給と同じitemTypeを再利用）。カテゴリはpharmacy、重要度は
 *     一律info（参考）からスタートし、人間が個別に確認・重要度確定する運用
 *   ・同じitemTypeを複数の情報源が使うようになったため、doGetのリンクラベル決定
 *     （linkLabelForItemType_）にsourceIdも渡すよう拡張した
 *   詳細はgas/README.mdの「v3.5→v3.6の変更点」を参照。
 *
 * v3.4からの変更点（薬機法等の法的関連情報ボットの追加）：
 *   ・厚生労働省「報道発表資料」月別一覧（mhlw_houdou）を新しい情報源として追加。
 *     他の情報源と同様、独立したsourceIdで成功/失敗・変更検知を行うため、
 *     1情報源の取得失敗が他情報源に影響しない
 *   ・このページは雇用・年金・介護・感染症等あらゆる分野の発表が混ざっているため、
 *     タイトルに「薬機法」「医薬品」「医療機器」「薬事」「調剤」「薬局」「処方箋」
 *     「医薬部外品」「再生医療等製品」「省令」「告示」のいずれかを含むものだけを
 *     対象にする（MHLW_LEGAL_KEYWORDS_で定義。フリちゃんと合意済み）
 *   ・カテゴリはpharmacy、itemTypeは行政通知に固定。重要度は一律info（参考）から
 *     スタートし、他のお知らせ系ボットと同様、人間が個別に確認・重要度確定する運用
 *   ・報道発表一覧のURLは月ごとに変わる（houdou_list_YYYYMM.html）ため、日付から
 *     当月・前月のURLを自動算出する（PMDAの年度計算と同じ考え方。月初めでまだ
 *     当月ページが無い場合に備えて前月にもフォールバックする）
 *   詳細はgas/README.mdの「v3.4→v3.5の変更点」を参照。
 *
 * v3.3からの変更点（学会お知らせボットの追加）：
 *   ・日本内科学会（naika_announcement）・日本糖尿病学会（jds_announcement）の
 *     お知らせ一覧を新しい情報源として追加。他の情報源と同様、独立したsourceIdで
 *     成功/失敗・変更検知を行うため、1情報源の取得失敗が他情報源に影響しない
 *   ・タイトルに「ガイドライン」「ガイダンス」「指針」「ステートメント」「アルゴリズム」
 *     「コンセンサス」「Recommendation」「分類」「基準」「マニュアル」のいずれかを
 *     含むものだけを対象にする（専門医試験・表彰・休業案内等の事務連絡ノイズの除外）。
 *     カテゴリはclinical、itemTypeは治療情報、重要度は一律info（参考）からスタートし、
 *     人間が個別に確認・重要度確定する運用（Minds同様、自動判定基準が無いため）
 *   ・Mindsと違い、これらのサイトは「日付」と「タイトルへのリンク」が別要素になっている
 *     ため、リンクの直前にある最も近い日付をその項目の掲載日とみなす汎用パース関数
 *     （extractDatedAnnouncementEntries_）を新設した
 *   詳細はgas/README.mdの「v3.3→v3.4の変更点」を参照。
 *
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

// ---- 学会お知らせ（日本内科学会・日本糖尿病学会）：HTML解析（GAS API非依存の純粋関数） ----

/**
 * 文字列の中から最初に見つかった日付をISO形式（"YYYY-MM-DD"）に変換して返す（純粋関数）。
 * 「YYYY年M月D日」（漢字区切り）と「YYYY/M/D」（スラッシュ区切り、日医工等で使用）の
 * どちらの形式にも対応する。見つからなければ空文字を返す。
 * parseMindsNewsEntryText_と似ているが、あちらは「日付+カテゴリ+タイトル」がまとまった
 * 1つの文字列からの分離用、こちらは任意の文字列から日付だけを拾う汎用版。
 */
function findJapaneseDateAsIso_(text) {
  var s = String(text || '');
  var m = s.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (!m) {
    m = s.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  }
  if (!m) return '';
  var y = m[1];
  var mo = ('0' + m[2]).slice(-2);
  var d = ('0' + m[3]).slice(-2);
  return y + '-' + mo + '-' + d;
}

/**
 * 学会お知らせのうち、「最新の治療法・ガイドライン系」と判定するためのキーワード一覧
 * （フリちゃんと合意済み）。専門医試験・表彰・休業案内等の事務連絡ノイズを除外するために使う。
 */
var GAKKAI_TREATMENT_KEYWORDS_ = [
  'ガイドライン',
  'ガイダンス',
  '指針',
  'ステートメント',
  'アルゴリズム',
  'コンセンサス',
  'Recommendation',
  '分類',
  '基準',
  'マニュアル',
];

/** タイトルが上記キーワードのいずれかを含むかどうか。 */
function isTreatmentRelatedAnnouncementTitle_(title) {
  if (typeof title !== 'string') return false;
  for (var i = 0; i < GAKKAI_TREATMENT_KEYWORDS_.length; i++) {
    if (title.indexOf(GAKKAI_TREATMENT_KEYWORDS_[i]) !== -1) return true;
  }
  return false;
}

/**
 * 汎用：お知らせ一覧のHTMLから、詳細ページへのリンク（linkRegexにマッチする<a>タグ）を
 * 探し、リンクの直前にある最も近い日付（"YYYY年M月D日"）をその項目の掲載日として対応付ける
 * （純粋関数）。日本内科学会・日本糖尿病学会のように「日付は別要素・タイトル部分だけが
 * リンクになっている」タイプのお知らせ一覧に共通して使う（Mindsのように日付までリンクの
 * 中に入っているケースはextractMindsNewsEntries_を使う）。
 *
 * linkRegexは以下の3つのキャプチャグループを持つ正規表現（globalフラグ必須）：
 *   グループ1：詳細ページの完全なURL
 *   グループ2：項目の一意なID（URLの一部など）
 *   グループ3：リンクの中身（タイトルを含むHTML片）
 * 同じidが複数回出てくる場合は最初に見つかったものだけを採用する。
 */
function extractDatedAnnouncementEntries_(html, linkRegex) {
  var entries = [];
  var seen = {};
  var match;
  var DATE_LOOKBACK_CHARS = 400;

  while ((match = linkRegex.exec(html)) !== null) {
    var url = match[1];
    var id = match[2];
    if (seen[id]) continue;
    seen[id] = true;

    var title = stripHtmlTags_(match[3]).replace(/\s+/g, ' ').trim();
    // 「NEW!」等の装飾語をタイトル末尾から取り除く（サイトによって付くことがある）
    title = title.replace(/\s*NEW!?\s*$/i, '').trim();

    var searchStart = Math.max(0, match.index - DATE_LOOKBACK_CHARS);
    var precedingText = html.slice(searchStart, match.index);
    var dateMatches = precedingText.match(/\d{4}(?:年\d{1,2}月\d{1,2}日|\/\d{1,2}\/\d{1,2})/g);
    var publishedAt = dateMatches && dateMatches.length > 0 ? findJapaneseDateAsIso_(dateMatches[dateMatches.length - 1]) : '';

    entries.push({ id: id, url: url, title: title, publishedAt: publishedAt });
  }

  return entries;
}

/** 学会お知らせのうち、内容変更判定に使うフィールドを決まった順序の配列にする。 */
function gakkaiAnnouncementHashFields_(f) {
  return [f.sourceId, f.id, f.publishedAt, f.title];
}

/**
 * 1件の学会お知らせエントリを、information_items用の「今回取得した内容」オブジェクトへ
 * 変換する（純粋関数）。重要度は一律'info'（参考）からスタートする：Minds同様、
 * 学会お知らせにも自動判定できる分類が無いため、人間が個別に確認・重要度確定する運用。
 */
function buildGakkaiAnnouncementItem_(sourceId, sourceLabel, entry, fetchedAtIso) {
  var contentHash = computeContentHash_(
    gakkaiAnnouncementHashFields_({
      sourceId: sourceId,
      id: entry.id,
      publishedAt: entry.publishedAt,
      title: entry.title,
    }),
  );

  return {
    id: sourceId + '_' + entry.id,
    sourceRecordId: entry.id,
    category: 'clinical',
    itemType: '治療情報',
    title: sanitizeCellValue_(entry.title),
    summary: sanitizeCellValue_(entry.title),
    aiImportance: 'info',
    publishedAt: entry.publishedAt,
    sourceName: sanitizeCellValue_(sourceLabel + '（お知らせ）'),
    documentNumber: null,
    pharmacyImpact: '',
    requiredAction: null,
    primaryUrl: entry.url,
    remarks: '',
    contentHash: contentHash,
    fetchedAtIso: fetchedAtIso,
  };
}

/**
 * お知らせ一覧の全エントリから、GAKKAI_TREATMENT_KEYWORDS_のいずれかをタイトルに
 * 含むものだけをinformation_items用オブジェクトの配列に変換する（純粋関数）。
 */
function buildGakkaiIncomingItems_(sourceId, sourceLabel, entries, fetchedAtIso) {
  return entries
    .filter(function (entry) {
      return isTreatmentRelatedAnnouncementTitle_(entry.title);
    })
    .map(function (entry) {
      return buildGakkaiAnnouncementItem_(sourceId, sourceLabel, entry, fetchedAtIso);
    });
}

/** 日本内科学会お知らせ（naika.or.jp/info/以下）の詳細リンクにマッチする正規表現を作る。 */
function buildNaikaAnnouncementLinkRegex_() {
  return /<a\b[^>]*href="(https:\/\/www\.naika\.or\.jp\/info\/([a-zA-Z0-9_-]+)\/)"[^>]*>([\s\S]*?)<\/a>/gi;
}

/** 日本糖尿病学会お知らせ（jds.or.jp/modules/important/以下）の詳細リンクにマッチする正規表現を作る。 */
function buildJdsAnnouncementLinkRegex_() {
  return /<a\b[^>]*href="(https:\/\/www\.jds\.or\.jp\/modules\/important\/index\.php\?content_id=(\d+))"[^>]*>([\s\S]*?)<\/a>/gi;
}

// ---- 厚労省報道発表（薬機法等の法的関連情報）：HTML解析（GAS API非依存の純粋関数） ----

/** 年・月を"YYYYMM"形式の文字列にする（1桁月は0埋め）。 */
function formatYearMonth_(year, month) {
  var mm = month < 10 ? '0' + month : String(month);
  return String(year) + mm;
}

/**
 * 厚労省「報道発表資料」月別一覧ページ（houdou_list_YYYYMM.html）のURLに使う
 * "YYYYMM"候補を、当月→前月の順で返す（純粋関数）。月初めでまだ当月のページが
 * 作成されていない場合に備えて、前月もフォールバック候補にする
 * （PMDAの年度計算と同じ考え方）。日本時間で年月を算出する。
 */
function mhlwHoudouYearMonthCandidates_(date) {
  var d = date || new Date();
  var jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  var year = jst.getUTCFullYear();
  var month = jst.getUTCMonth() + 1; // 1-12

  var prevMonth = month - 1;
  var prevYear = year;
  if (prevMonth < 1) {
    prevMonth = 12;
    prevYear = year - 1;
  }

  return [formatYearMonth_(year, month), formatYearMonth_(prevYear, prevMonth)];
}

/**
 * 厚労省報道発表のうち、「薬機法等の法的関連情報」と判定するためのキーワード一覧
 * （フリちゃんと合意済み）。報道発表資料は雇用・年金・介護・感染症等あらゆる分野が
 * 混ざっているため、薬事・薬局関連の語を含むものだけに絞り込む。
 */
var MHLW_LEGAL_KEYWORDS_ = [
  '薬機法',
  '医薬品',
  '医療機器',
  '薬事',
  '調剤',
  '薬局',
  '処方箋',
  '医薬部外品',
  '再生医療等製品',
  '省令',
  '告示',
];

/** タイトルが上記キーワードのいずれかを含むかどうか。 */
function isLegalRelatedAnnouncementTitle_(title) {
  if (typeof title !== 'string') return false;
  for (var i = 0; i < MHLW_LEGAL_KEYWORDS_.length; i++) {
    if (title.indexOf(MHLW_LEGAL_KEYWORDS_[i]) !== -1) return true;
  }
  return false;
}

/**
 * 厚労省報道発表資料一覧のHTMLから、日付付きの発表エントリを抽出する（純粋関数）。
 *
 * このページは実際に見ると、リンクのURLパターンが単一ではなく混在している
 * （`/stf/newpage_XXXXX.html`、`/stf/houdou/XXXXX_XXXXX.html`、`/toukei/...`等）ため、
 * 単一パターンでのURL一致では大半を拾い落としてしまう（v3.5初回実装で実際に0件になった
 * 不具合）。また多くのリンクがドメイン省略の相対URL（`href="/stf/..."`）だった。
 *
 * そこで方針を変更し、`/stf/`または`/toukei/`配下への`.html`リンク（絶対・相対どちらも許容）
 * を広く対象にしつつ、**リンクの直前近く（3000文字以内）に日付がある場合だけ**を
 * 発表エントリとして採用する。1日あたり10件を超える発表がある日もあるため、ウィンドウは
 * 広めに取っている。ページ上部の巨大なメニュー・パンくずリンクは、日付テキストから
 * 数千文字以上離れた場所にあるため、このウィンドウ幅でも実用上問題なく除外できる
 * （仮に紛れ込んでも、事務的なメニュー文言はMHLW_LEGAL_KEYWORDS_に一致しないことが多く、
 * 後段のキーワード絞り込みが二重の安全弁になる）。
 * リンクのパス自体（`/`を`_`に置き換えたもの）を一意なidとして使う
 * （URLパターンが混在しており、末尾の数字だけでは一意性を保証できないため）。
 */
function extractMhlwHoudouEntries_(html) {
  var entries = [];
  var seen = {};
  var pattern = /<a\b[^>]*href="((?:https:\/\/www\.mhlw\.go\.jp)?(\/(?:stf|toukei)\/[^"?#]+\.html))"[^>]*>([\s\S]*?)<\/a>/gi;
  var match;
  var DATE_LOOKBACK_CHARS = 3000;

  while ((match = pattern.exec(html)) !== null) {
    var hrefValue = match[1];
    var path = match[2];
    var id = path.replace(/^\//, '').replace(/\//g, '_').replace(/\.html$/, '');
    if (seen[id]) continue;

    var searchStart = Math.max(0, match.index - DATE_LOOKBACK_CHARS);
    var precedingText = html.slice(searchStart, match.index);
    var dateMatches = precedingText.match(/\d{4}年\d{1,2}月\d{1,2}日/g);
    if (!dateMatches || dateMatches.length === 0) continue; // 直前に日付が無い＝メニュー等とみなして除外

    var title = stripHtmlTags_(match[3]).replace(/\s+/g, ' ').trim();
    if (!title) continue;

    seen[id] = true;
    var publishedAt = findJapaneseDateAsIso_(dateMatches[dateMatches.length - 1]);
    var url = hrefValue.indexOf('http') === 0 ? hrefValue : 'https://www.mhlw.go.jp' + hrefValue;
    entries.push({ id: id, url: url, title: title, publishedAt: publishedAt });
  }

  return entries;
}

/** 厚労省報道発表のうち、内容変更判定に使うフィールドを決まった順序の配列にする。 */
function mhlwHoudouHashFields_(f) {
  return [f.id, f.publishedAt, f.title];
}

/**
 * 1件の厚労省報道発表エントリを、information_items用の「今回取得した内容」オブジェクトへ
 * 変換する（純粋関数）。重要度は一律'info'（参考）からスタートする：他の学会お知らせ等と
 * 同様、自動判定できる分類が無いため、人間が個別に確認・重要度確定する運用。
 */
function buildMhlwHoudouItem_(entry, fetchedAtIso) {
  var contentHash = computeContentHash_(
    mhlwHoudouHashFields_({ id: entry.id, publishedAt: entry.publishedAt, title: entry.title }),
  );

  return {
    id: 'mhlw_houdou_' + entry.id,
    sourceRecordId: entry.id,
    category: 'pharmacy',
    itemType: '行政通知',
    title: sanitizeCellValue_(entry.title),
    summary: sanitizeCellValue_(entry.title),
    aiImportance: 'info',
    publishedAt: entry.publishedAt,
    sourceName: '厚生労働省（報道発表資料）',
    documentNumber: null,
    pharmacyImpact: '',
    requiredAction: null,
    primaryUrl: entry.url,
    remarks: '',
    contentHash: contentHash,
    fetchedAtIso: fetchedAtIso,
  };
}

/**
 * 報道発表一覧の全エントリから、MHLW_LEGAL_KEYWORDS_のいずれかをタイトルに含むものだけを
 * information_items用オブジェクトの配列に変換する（純粋関数）。
 */
function buildMhlwHoudouIncomingItems_(entries, fetchedAtIso) {
  return entries
    .filter(function (entry) {
      return isLegalRelatedAnnouncementTitle_(entry.title);
    })
    .map(function (entry) {
      return buildMhlwHoudouItem_(entry, fetchedAtIso);
    });
}

// ---- 沢井製薬お知らせ（供給関連・回収情報）：HTML解析（GAS API非依存の純粋関数） ----

/**
 * 沢井製薬お知らせ一覧のカテゴリラベル一覧（お知らせ本文の先頭、日付の直後に現れる）。
 * 回収情報セクションのお知らせにはこのラベルが付かない（parseSawaiAnnouncementText_参照）。
 */
var SAWAI_ANNOUNCEMENT_CATEGORIES_ = ['安全性・適正使用関連', '供給関連', '電子添文改訂', '包装変更', 'その他'];

/**
 * 沢井製薬お知らせ一覧のリンクテキスト
 * （例："2026/09/14供給関連PDFNEW アレンドロン酸錠35mg「サワイ」の供給に関するお詫びとお願いPDFNEW"）
 * から、日付・カテゴリ・タイトルを分離する（純粋関数）。Mindsと同様、日付・カテゴリ・タイトルが
 * 1つのリンクの中にまとまっている。日付の直後にカテゴリラベルが無い場合は、回収情報セクションの
 * お知らせとみなす（category: ''を返す）。前後に付く「PDF」「NEW」の装飾タグは取り除く。
 */
function parseSawaiAnnouncementText_(rawText) {
  var text = String(rawText || '').replace(/\s+/g, ' ').trim();
  var dateMatch = text.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  var publishedAt = '';
  var rest = text;

  if (dateMatch) {
    var y = dateMatch[1];
    var m = ('0' + dateMatch[2]).slice(-2);
    var d = ('0' + dateMatch[3]).slice(-2);
    publishedAt = y + '-' + m + '-' + d;
    rest = text.slice(dateMatch[0].length);
  }

  var category = '';
  for (var i = 0; i < SAWAI_ANNOUNCEMENT_CATEGORIES_.length; i++) {
    if (rest.indexOf(SAWAI_ANNOUNCEMENT_CATEGORIES_[i]) === 0) {
      category = SAWAI_ANNOUNCEMENT_CATEGORIES_[i];
      rest = rest.slice(category.length);
      break;
    }
  }

  rest = rest.replace(/^(PDF|NEW)+/i, '').replace(/(PDF|NEW)+$/i, '').trim();

  return { publishedAt: publishedAt, category: category, title: rest };
}

/**
 * カテゴリが「供給関連」、またはカテゴリが空でタイトルに「回収」を含む（＝回収情報セクション）
 * ものだけを対象にする（フリちゃんと合意済み）。
 */
function isSawaiSupplyOrRecallAnnouncement_(parsed) {
  if (!parsed) return false;
  if (parsed.category === '供給関連') return true;
  if (!parsed.category && typeof parsed.title === 'string' && parsed.title.indexOf('回収') !== -1) return true;
  return false;
}

/**
 * 沢井製薬お知らせ・回収情報の詳細PDFへのリンクにマッチする正規表現を作る。
 * ナビゲーションメニュー等の大量のリンク（/product/や/topics/等）を誤って拾わないよう、
 * 個別のお知らせPDFが置かれる/file/配下（絶対・相対どちらも許容）だけに絞っている。
 */
function buildSawaiAnnouncementLinkRegex_() {
  return /<a\b[^>]*href="((?:https:\/\/med\.sawai\.co\.jp)?(\/file\/[^"?#]+))"[^>]*>([\s\S]*?)<\/a>/gi;
}

/**
 * 沢井製薬お知らせ一覧の生HTMLから、お知らせ1件ずつの{id, url, publishedAt, category, title}を
 * 抜き出す（純粋関数）。同じidへの重複リンクは最初に見つかったものだけを採用する。
 */
function extractSawaiAnnouncementEntries_(html) {
  var entries = [];
  var seen = {};
  var pattern = buildSawaiAnnouncementLinkRegex_();
  var match;

  while ((match = pattern.exec(html)) !== null) {
    var hrefValue = match[1];
    var path = match[2];
    var id = path
      .replace(/^\//, '')
      .replace(/\//g, '_')
      .replace(/\.[a-zA-Z0-9]+$/, '');
    if (seen[id]) continue;
    seen[id] = true;

    var parsed = parseSawaiAnnouncementText_(stripHtmlTags_(match[3]));
    var url = hrefValue.indexOf('http') === 0 ? hrefValue : 'https://med.sawai.co.jp' + hrefValue;

    entries.push({ id: id, url: url, publishedAt: parsed.publishedAt, category: parsed.category, title: parsed.title });
  }

  return entries;
}

/** 沢井製薬お知らせのうち、内容変更判定に使うフィールドを決まった順序の配列にする。 */
function sawaiAnnouncementHashFields_(f) {
  return [f.id, f.publishedAt, f.title];
}

/**
 * 1件の沢井製薬お知らせエントリを、information_items用の「今回取得した内容」オブジェクトへ
 * 変換する（純粋関数）。回収情報セクション由来（category空）はitemTypeを'回収'、それ以外
 * （供給関連）は'供給'にする（既存のPMDA・厚労省供給と同じitemTypeを再利用）。
 * 重要度は一律'info'（参考）からスタートし、人間が個別に確認・重要度確定する運用。
 */
function buildSawaiAnnouncementItem_(entry, fetchedAtIso) {
  var contentHash = computeContentHash_(
    sawaiAnnouncementHashFields_({ id: entry.id, publishedAt: entry.publishedAt, title: entry.title }),
  );
  var isRecall = !entry.category;

  return {
    id: 'sawai_announcement_' + entry.id,
    sourceRecordId: entry.id,
    category: 'pharmacy',
    itemType: isRecall ? '回収' : '供給',
    title: sanitizeCellValue_(entry.title),
    summary: sanitizeCellValue_(entry.title),
    aiImportance: 'info',
    publishedAt: entry.publishedAt,
    sourceName: sanitizeCellValue_('沢井製薬（' + (isRecall ? '回収情報' : entry.category) + '）'),
    documentNumber: null,
    pharmacyImpact: '',
    requiredAction: null,
    primaryUrl: entry.url,
    remarks: '',
    contentHash: contentHash,
    fetchedAtIso: fetchedAtIso,
  };
}

/**
 * お知らせ一覧の全エントリから、供給関連・回収情報のものだけをinformation_items用
 * オブジェクトの配列に変換する（純粋関数）。
 */
function buildSawaiIncomingItems_(entries, fetchedAtIso) {
  return entries
    .filter(function (entry) {
      return isSawaiSupplyOrRecallAnnouncement_({ category: entry.category, title: entry.title });
    })
    .map(function (entry) {
      return buildSawaiAnnouncementItem_(entry, fetchedAtIso);
    });
}

// ---- 日医工お知らせ（供給関連・回収情報）：HTML解析（GAS API非依存の純粋関数） ----

/**
 * 日医工お知らせ一覧のうち、「供給関連・回収情報」と判定するためのキーワード一覧
 * （フリちゃんと合意済み）。このページは新発売・使用上の注意改訂・休業案内等も含めた
 * あらゆるお知らせが混ざった一覧のため、絞り込みが必須。
 */
var NICHIIKO_WHATSNEW_KEYWORDS_ = ['限定出荷', '出荷停止', '出荷再開', '出荷調整', '自主回収', '供給状況', '供給停止', '供給再開'];

/** タイトルが上記キーワードのいずれかを含むかどうか。 */
function isNichiikoSupplyOrRecallTitle_(title) {
  if (typeof title !== 'string') return false;
  for (var i = 0; i < NICHIIKO_WHATSNEW_KEYWORDS_.length; i++) {
    if (title.indexOf(NICHIIKO_WHATSNEW_KEYWORDS_[i]) !== -1) return true;
  }
  return false;
}

/**
 * 日医工お知らせ一覧（年別ページ）の詳細PDFへのリンクにマッチする正規表現を作る。
 * ナビゲーションメニュー等の大量のリンク（/medicine/expiration等）を誤って拾わないよう、
 * 個別のお知らせPDFが置かれる/medicine/files/配下（絶対・相対どちらも許容）だけに絞っている。
 */
function buildNichiikoAnnouncementLinkRegex_() {
  return /<a\b[^>]*href="((?:https:\/\/www\.nichiiko\.co\.jp)?(\/medicine\/files\/[^"?#]+))"[^>]*>([\s\S]*?)<\/a>/gi;
}

/** 日医工お知らせのうち、内容変更判定に使うフィールドを決まった順序の配列にする。 */
function nichiikoAnnouncementHashFields_(f) {
  return [f.id, f.publishedAt, f.title];
}

/**
 * 1件の日医工お知らせエントリを、information_items用の「今回取得した内容」オブジェクトへ
 * 変換する（純粋関数）。タイトルに「回収」を含むものはitemTypeを'回収'、それ以外は'供給'に
 * する（PMDA・厚労省供給・沢井製薬と同じitemTypeを再利用）。重要度は一律'info'（参考）から
 * スタートし、人間が個別に確認・重要度確定する運用。
 */
function buildNichiikoAnnouncementItem_(entry, fetchedAtIso) {
  var contentHash = computeContentHash_(
    nichiikoAnnouncementHashFields_({ id: entry.id, publishedAt: entry.publishedAt, title: entry.title }),
  );
  var isRecall = typeof entry.title === 'string' && entry.title.indexOf('回収') !== -1;

  return {
    id: 'nichiiko_announcement_' + entry.id,
    sourceRecordId: entry.id,
    category: 'pharmacy',
    itemType: isRecall ? '回収' : '供給',
    title: sanitizeCellValue_(entry.title),
    summary: sanitizeCellValue_(entry.title),
    aiImportance: 'info',
    publishedAt: entry.publishedAt,
    sourceName: '日医工（お知らせ）',
    documentNumber: null,
    pharmacyImpact: '',
    requiredAction: null,
    primaryUrl: entry.url,
    remarks: '',
    contentHash: contentHash,
    fetchedAtIso: fetchedAtIso,
  };
}

/**
 * お知らせ一覧の全エントリから、NICHIIKO_WHATSNEW_KEYWORDS_のいずれかをタイトルに含む
 * ものだけをinformation_items用オブジェクトの配列に変換する（純粋関数）。
 */
function buildNichiikoIncomingItems_(entries, fetchedAtIso) {
  return entries
    .filter(function (entry) {
      return isNichiikoSupplyOrRecallTitle_(entry.title);
    })
    .map(function (entry) {
      return buildNichiikoAnnouncementItem_(entry, fetchedAtIso);
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

/**
 * itemType（'回収' / '供給' / 'ガイドライン' / '治療情報' / '行政通知' 等）から、リンクの見出しに
 * 使うラベルを決める。sourceIdを渡すと、同じitemTypeを複数の情報源が使うケース
 * （'回収'＝PMDAと沢井製薬、'供給'＝厚労省と沢井製薬）を区別できる。
 */
function linkLabelForItemType_(itemType, sourceId) {
  if (sourceId === 'sawai_announcement') return '沢井製薬 お知らせ（原文）';
  if (sourceId === 'nichiiko_announcement') return '日医工 お知らせ（原文）';
  if (itemType === '供給') return '厚労省 医療用医薬品供給状況（Excel原本）';
  if (itemType === 'ガイドライン') return 'Minds お知らせページ（原文）';
  if (itemType === '治療情報') return '学会お知らせページ（原文）';
  if (itemType === '行政通知') return '厚労省 報道発表資料（原文）';
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
  naika_announcement: '日本内科学会お知らせ',
  jds_announcement: '日本糖尿病学会お知らせ',
  mhlw_houdou: '厚労省報道発表（薬機法等）',
  sawai_announcement: '沢井製薬お知らせ',
  nichiiko_announcement: '日医工お知らせ',
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

// ---- 学会お知らせ（日本内科学会・日本糖尿病学会）：ネットワーク取得（GAS依存） ----

var NAIKA_INFO_LIST_URL = 'https://www.naika.or.jp/info/';
var JDS_ANNOUNCEMENT_LIST_URL = 'https://www.jds.or.jp/modules/important_list/index.php?content_id=1';

/**
 * 学会お知らせ一覧を取得し、{ sourceId, success, items, fetchedAt, error } の形で返す
 * 汎用関数（日本内科学会・日本糖尿病学会で共通）。他の情報源と同様、独立したsourceIdとして
 * 成功/失敗を記録するため、1情報源の取得失敗・ページ構成変更が他情報源に影響しない。
 * maxCountで取得件数の上限を切る（日本糖尿病学会のお知らせ一覧は過去分まで1ページに
 * まとまって表示されるため、初回実行で大量の古いお知らせを取り込みすぎないようにする）。
 * ブラウザに近いUser-Agent等のヘッダーを付けている：User-Agentが無いリクエストを
 * 一部のサイトが拒否する（HTTP 400/403等）ことがあるための対策（v3.7で日本糖尿病学会側が
 * 突然HTTP 400を返すようになった不具合の修正）。
 */
function fetchGakkaiAnnouncementSourceResult_(sourceId, sourceLabel, listUrl, linkRegex, maxCount) {
  var startedAt = new Date().toISOString();
  try {
    var response = UrlFetchApp.fetch(listUrl, {
      muteHttpExceptions: true,
      followRedirects: true,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
      },
    });
    var code = response.getResponseCode();
    if (code !== 200) {
      return {
        sourceId: sourceId,
        success: false,
        items: [],
        fetchedAt: new Date().toISOString(),
        startedAt: startedAt,
        error: sourceLabel + 'のお知らせ一覧ページの取得に失敗しました（HTTP ' + code + '）',
      };
    }

    var html = response.getContentText('UTF-8');
    var entries = extractDatedAnnouncementEntries_(html, linkRegex);
    if (maxCount) entries = entries.slice(0, maxCount);
    if (entries.length === 0) {
      Logger.log(sourceLabel + 'のお知らせ一覧からリンクを1件も抽出できませんでした。ページ構成が変わった可能性があります。');
    }

    var fetchedAtIso = new Date().toISOString();
    var items = buildGakkaiIncomingItems_(sourceId, sourceLabel, entries, fetchedAtIso);

    return { sourceId: sourceId, success: true, items: items, fetchedAt: fetchedAtIso, startedAt: startedAt, error: null };
  } catch (e) {
    return {
      sourceId: sourceId,
      success: false,
      items: [],
      fetchedAt: new Date().toISOString(),
      startedAt: startedAt,
      error: sourceLabel + 'のお知らせ取得・解析中にエラー: ' + e,
    };
  }
}

/** 日本内科学会お知らせを取得する（最新20件まで）。 */
function fetchNaikaAnnouncementSourceResult_() {
  return fetchGakkaiAnnouncementSourceResult_(
    'naika_announcement',
    '日本内科学会',
    NAIKA_INFO_LIST_URL,
    buildNaikaAnnouncementLinkRegex_(),
    20,
  );
}

/** 日本糖尿病学会お知らせを取得する（最新30件まで。過去分まで1ページに載るページのため上限を切る）。 */
function fetchJdsAnnouncementSourceResult_() {
  return fetchGakkaiAnnouncementSourceResult_(
    'jds_announcement',
    '日本糖尿病学会',
    JDS_ANNOUNCEMENT_LIST_URL,
    buildJdsAnnouncementLinkRegex_(),
    30,
  );
}

// ---- 厚労省報道発表（薬機法等の法的関連情報）：ネットワーク取得（GAS依存） ----

var MHLW_HOUDOU_LIST_BASE_URL = 'https://www.mhlw.go.jp/stf/houdou/houdou_list_';

/**
 * 厚労省「報道発表資料」月別一覧を取得し、{ sourceId, success, items, fetchedAt, error }
 * の形で返す。当月のページを試し、取得できなければ前月のページにフォールバックする
 * （月初めでまだ当月ページが作成されていない場合に備える）。
 * このページは雇用・年金・介護・感染症等あらゆる分野の発表が混ざっているため、
 * MHLW_LEGAL_KEYWORDS_による絞り込みが必須（buildMhlwHoudouIncomingItems_が行う）。
 */
function fetchMhlwHoudouSourceResult_() {
  var startedAt = new Date().toISOString();
  var candidates = mhlwHoudouYearMonthCandidates_(new Date());
  var html = null;
  var lastError = null;

  for (var i = 0; i < candidates.length; i++) {
    var url = MHLW_HOUDOU_LIST_BASE_URL + candidates[i] + '.html';
    try {
      var response = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
      var code = response.getResponseCode();
      if (code === 200) {
        html = response.getContentText('UTF-8');
        break;
      }
      lastError = url + ' の取得に失敗しました（HTTP ' + code + '）';
    } catch (e) {
      lastError = url + ' の取得中にエラー: ' + e;
    }
  }

  if (html === null) {
    return {
      sourceId: 'mhlw_houdou',
      success: false,
      items: [],
      fetchedAt: new Date().toISOString(),
      startedAt: startedAt,
      error: lastError || '厚労省報道発表一覧の取得に失敗しました（当月・前月とも）',
    };
  }

  var entries = extractMhlwHoudouEntries_(html);
  if (entries.length === 0) {
    Logger.log('厚労省報道発表一覧からリンクを1件も抽出できませんでした。ページ構成が変わった可能性があります。');
  }

  var fetchedAtIso = new Date().toISOString();
  var items = buildMhlwHoudouIncomingItems_(entries, fetchedAtIso);

  return { sourceId: 'mhlw_houdou', success: true, items: items, fetchedAt: fetchedAtIso, startedAt: startedAt, error: null };
}

// ---- 沢井製薬お知らせ（供給関連・回収情報）：ネットワーク取得（GAS依存） ----

var SAWAI_ANNOUNCEMENT_LIST_URL = 'https://med.sawai.co.jp/';

/**
 * 沢井製薬お知らせ一覧（トップページに掲載される直近の一覧）を取得し、
 * { sourceId, success, items, fetchedAt, error } の形で返す。他の情報源と同様、独立した
 * sourceIdとして成功/失敗を記録するため、この情報源の取得失敗・ページ構成変更が
 * 他情報源に影響しない。このページは会員登録・ログイン不要（確認済み。東和薬品側は
 * 職種選択画面が挟まり同じ方式では取得できなかったため、今回は沢井製薬のみ対応）。
 */
function fetchSawaiAnnouncementSourceResult_() {
  var startedAt = new Date().toISOString();
  try {
    var response = UrlFetchApp.fetch(SAWAI_ANNOUNCEMENT_LIST_URL, { muteHttpExceptions: true, followRedirects: true });
    var code = response.getResponseCode();
    if (code !== 200) {
      return {
        sourceId: 'sawai_announcement',
        success: false,
        items: [],
        fetchedAt: new Date().toISOString(),
        startedAt: startedAt,
        error: '沢井製薬お知らせ一覧の取得に失敗しました（HTTP ' + code + '）',
      };
    }

    var html = response.getContentText('UTF-8');
    var entries = extractSawaiAnnouncementEntries_(html);
    if (entries.length === 0) {
      Logger.log('沢井製薬お知らせ一覧からリンクを1件も抽出できませんでした。ページ構成が変わった可能性があります。');
    }

    var fetchedAtIso = new Date().toISOString();
    var items = buildSawaiIncomingItems_(entries, fetchedAtIso);

    return { sourceId: 'sawai_announcement', success: true, items: items, fetchedAt: fetchedAtIso, startedAt: startedAt, error: null };
  } catch (e) {
    return {
      sourceId: 'sawai_announcement',
      success: false,
      items: [],
      fetchedAt: new Date().toISOString(),
      startedAt: startedAt,
      error: '沢井製薬お知らせ取得・解析中にエラー: ' + e,
    };
  }
}

// ---- 日医工お知らせ（供給関連・回収情報）：ネットワーク取得（GAS依存） ----

var NICHIIKO_WHATSNEW_BASE_URL = 'https://www.nichiiko.co.jp/medicine/whatsnew/';

/**
 * 日医工お知らせ一覧のURLに使う年（西暦4桁の文字列）候補を、当年→前年の順で返す（純粋関数）。
 * 年が変わった直後でまだ当年ページが無い場合に備えて、前年もフォールバック候補にする
 * （PMDA・厚労省報道発表と同じ考え方）。日本時間で年を算出する。
 */
function nichiikoWhatsNewYearCandidates_(date) {
  var d = date || new Date();
  var jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  var year = jst.getUTCFullYear();
  return [String(year), String(year - 1)];
}

/**
 * 日医工お知らせ一覧（年別ページ）を取得し、{ sourceId, success, items, fetchedAt, error }
 * の形で返す。他の情報源と同様、独立したsourceIdとして成功/失敗を記録するため、
 * この情報源の取得失敗・ページ構成変更が他情報源に影響しない。このページは会員登録・
 * ログイン不要（確認済み。ページ下部に「あなたは医療関係者の方ですか？」という確認画面が
 * あるが、これは表示上のものでコンテンツ自体は取得できる）。
 */
function fetchNichiikoAnnouncementSourceResult_() {
  var startedAt = new Date().toISOString();
  var candidates = nichiikoWhatsNewYearCandidates_(new Date());
  var html = null;
  var lastError = null;

  for (var i = 0; i < candidates.length; i++) {
    var url = NICHIIKO_WHATSNEW_BASE_URL + candidates[i] + '/index.php';
    try {
      var response = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
      var code = response.getResponseCode();
      if (code === 200) {
        html = response.getContentText('UTF-8');
        break;
      }
      lastError = url + ' の取得に失敗しました（HTTP ' + code + '）';
    } catch (e) {
      lastError = url + ' の取得中にエラー: ' + e;
    }
  }

  if (html === null) {
    return {
      sourceId: 'nichiiko_announcement',
      success: false,
      items: [],
      fetchedAt: new Date().toISOString(),
      startedAt: startedAt,
      error: lastError || '日医工お知らせ一覧の取得に失敗しました（当年・前年とも）',
    };
  }

  var entries = extractDatedAnnouncementEntries_(html, buildNichiikoAnnouncementLinkRegex_());
  if (entries.length === 0) {
    Logger.log('日医工お知らせ一覧からリンクを1件も抽出できませんでした。ページ構成が変わった可能性があります。');
  }

  var fetchedAtIso = new Date().toISOString();
  var items = buildNichiikoIncomingItems_(entries, fetchedAtIso);

  return { sourceId: 'nichiiko_announcement', success: true, items: items, fetchedAt: fetchedAtIso, startedAt: startedAt, error: null };
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
  var naikaResult = fetchNaikaAnnouncementSourceResult_();
  // 日本糖尿病学会（jds_announcement）はv3.7.5より一旦保留中。
  // お知らせモジュール（/modules/important/・/modules/important_list/）だけがGASからの
  // アクセスを拒否しており、ヘッダー・Cookieのどちらをどう調整しても回避できなかったため
  // （切り分けの詳細はファイル冒頭のv3.7.2〜v3.7.4のコメント参照）。再開する場合は
  // 下のjdsResultの行と、concat内のjdsResultをコメントアウトから戻すこと。
  // var jdsResult = fetchJdsAnnouncementSourceResult_();
  var mhlwHoudouResult = fetchMhlwHoudouSourceResult_();
  var sawaiResult = fetchSawaiAnnouncementSourceResult_();
  var nichiikoResult = fetchNichiikoAnnouncementSourceResult_();

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
    var applied = applyFetchResultsToState_(
      existingById,
      pmdaResults.concat([mhlwResult, mindsResult, naikaResult, mhlwHoudouResult, sawaiResult, nichiikoResult]),
      nowIso,
    );

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
        (mindsResult.success ? '成功(' + mindsResult.items.length + '件)' : '失敗: ' + mindsResult.error) +
        ' / 日本内科学会: ' +
        (naikaResult.success ? '成功(' + naikaResult.items.length + '件)' : '失敗: ' + naikaResult.error) +
        ' / 日本糖尿病学会: 保留中（v3.7.5より取得停止、詳細はファイル冒頭コメント参照） ' +
        ' / 厚労省報道発表: ' +
        (mhlwHoudouResult.success ? '成功(' + mhlwHoudouResult.items.length + '件)' : '失敗: ' + mhlwHoudouResult.error) +
        ' / 沢井製薬お知らせ: ' +
        (sawaiResult.success ? '成功(' + sawaiResult.items.length + '件)' : '失敗: ' + sawaiResult.error) +
        ' / 日医工お知らせ: ' +
        (nichiikoResult.success ? '成功(' + nichiikoResult.items.length + '件)' : '失敗: ' + nichiikoResult.error),
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

/** 日本内科学会お知らせだけを取得してマージする（動作確認用の単体実行）。 */
function runConvertNaikaAnnouncementToInformationItems() {
  runSingleSourceConversion_(function () {
    return [fetchNaikaAnnouncementSourceResult_()];
  });
}

/** 日本糖尿病学会お知らせだけを取得してマージする（動作確認用の単体実行）。 */
function runConvertJdsAnnouncementToInformationItems() {
  runSingleSourceConversion_(function () {
    return [fetchJdsAnnouncementSourceResult_()];
  });
}

/** 厚労省報道発表（薬機法等）だけを取得してマージする（動作確認用の単体実行）。 */
function runConvertMhlwHoudouToInformationItems() {
  runSingleSourceConversion_(function () {
    return [fetchMhlwHoudouSourceResult_()];
  });
}

/** 沢井製薬お知らせ（供給関連・回収情報）だけを取得してマージする（動作確認用の単体実行）。 */
function runConvertSawaiAnnouncementToInformationItems() {
  runSingleSourceConversion_(function () {
    return [fetchSawaiAnnouncementSourceResult_()];
  });
}

/** 日医工お知らせ（供給関連・回収情報）だけを取得してマージする（動作確認用の単体実行）。 */
function runConvertNichiikoAnnouncementToInformationItems() {
  runSingleSourceConversion_(function () {
    return [fetchNichiikoAnnouncementSourceResult_()];
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
      links: state.primaryUrl ? [{ label: linkLabelForItemType_(state.itemType, state.sourceId), url: state.primaryUrl, kind: 'primary' }] : [],
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

