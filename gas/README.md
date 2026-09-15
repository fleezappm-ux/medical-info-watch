# GAS実装（v3.5）

`pmda-recall-fetcher.gs` 1ファイルに、データ取得・変更検知・Web App化・定期実行のすべてが入っている（フリちゃんが「ファイルを丸ごと貼り替える」運用のため、あえて単一ファイル構成にしている）。

v3からの変更点（2次監査対応）は本ファイル末尾の「v3→v3.1の変更点」を、v3.1以降の変更点はさらにその下の各節を参照。

## 取得している情報

### PMDA回収情報

- `https://www.info.pmda.go.jp/kaisyuu/rcidx{年度2桁}-{クラス}{区分}.csv`
- クラスI・II・III（医薬品等）を取得。年度は実行時点の日付から自動算出する（`currentJapaneseFiscalYear2Digit_`）ため、年度が変わってもコード修正は不要。
- クラスごとに独立した情報源（`pmda_recall_class1`/`pmda_recall_class2`/`pmda_recall_class3`、`PMDA_RECALL_CLASSES_`で定義）として取得・成功失敗判定・変更検知を行う。1クラスのCSVが一時的に取得できなくても、他クラスの更新・既存データには影響しない（`source_run_logs`にもクラスごとに記録される）。
- idは常に「`pmda_recall_` + 回収番号」（v3.2.1で修正。回収番号自体がクラスをまたいで一意なため、sourceIdは含めない）。
- 対象を医療機器等（区分`k`）にも広げる場合は`PMDA_RECALL_CLASSES_`と取得URLの区分文字を見直す必要がある（現在は医薬品等`m`区分のみ）。

### 厚生労働省 医療用医薬品供給状況

- `04_00003.html` ページから最新のExcelリンクを探して取得（新システム`iyakuhin-kyokyu.mhlw.go.jp`はbot対策で取得不可のため見送り、変更なし）。
- Excelは**全件を読み込み**、そのうえで一覧に出すかどうかを判定する：
  - 限定出荷・供給停止：常に一覧に出す
  - 通常出荷：**Excelで明示的に確認できた場合だけ**、既に追跡中のYJコードを「供給再開」として一覧に出す
  - 追跡中のYJコードが今回のExcelに見当たらない：「掲載未確認（要手動確認）」として扱う（詳細は後述）

### Mindsガイドラインライブラリ「お知らせ」（v3.3で追加）

- `https://minds.jcqhc.or.jp/news/`（お知らせ一覧の1ページ目）をHTML取得・パースする（PMDAのようなCSV配布は無いため）。更新頻度が週1〜数件程度のため、1ページ目（最新10件程度）のみの取得で日次実行なら取りこぼしの心配はほぼ無い。
- 各お知らせのURL固有ID（`news-{数字}`）を、回収番号やYJコードと同様の一意キーとして使う（`minds_guideline_{数字}`がinformation_itemsのid）。
- **タイトルに「ガイドライン」を含むものだけ**を対象にする（「組織ページを更新しました」等の事務連絡ノイズを除外するため）。それ以外のお知らせは取得はするが一覧には出さない。
- カテゴリは`clinical`（治療・臨床ウォッチ、`watch_clinical`）に固定。重要度は一律`info`（参考）からスタートし、Minds側にはPMDAの回収クラスのような自動判定基準が無いため、人間が個別に確認・重要度確定する運用。
- 一覧ページのHTML構造に依存したパース（`extractMindsNewsEntries_`）のため、Minds側でページのマークアップが大きく変わると抽出できなくなる可能性がある。その場合は`fetchMindsGuidelineSourceResult_`が「取得0件」または失敗として`source_run_logs`に記録されるので、そこで気づける（他の情報源には影響しない）。

### 学会お知らせ（日本内科学会・日本糖尿病学会、v3.4で追加）

- 日本内科学会（`https://www.naika.or.jp/info/`、最新20件まで）・日本糖尿病学会（`https://www.jds.or.jp/modules/important_list/index.php?content_id=1`、最新30件まで）それぞれの「お知らせ一覧」をHTML取得・パースする。日本糖尿病学会側は過去分まで1ページに表示されるため、`maxCount`で取得件数の上限を切っている。
- Mindsとは異なり、これらのサイトは「日付」と「タイトルへのリンク」が別要素になっている（日付がリンクの外側にある）。そのため`extractDatedAnnouncementEntries_`という汎用パース関数を新設し、詳細ページへのリンクの直前にある最も近い日付をその項目の掲載日とみなす方式にしている。
- タイトルに **「ガイドライン」「ガイダンス」「指針」「ステートメント」「アルゴリズム」「コンセンサス」「Recommendation」「分類」「基準」「マニュアル」** のいずれかを含むものだけを対象にする（`GAKKAI_TREATMENT_KEYWORDS_`で定義。フリちゃんと合意済み）。専門医試験・表彰・休業案内・医薬品の出荷停止/供給再開のお知らせ（PMDA・厚労省側と重複しうる）等の事務連絡ノイズを除外するため。
- カテゴリは`clinical`（治療・臨床ウォッチ）、itemTypeは`治療情報`に固定。重要度は一律`info`（参考）からスタートし、Minds同様、自動判定基準が無いため人間が個別に確認・重要度確定する運用。
- キーワードセットは初回実装時点の暫定案。実際に取れた件数・中身を見ながら追加・削除して調整していく想定（`GAKKAI_TREATMENT_KEYWORDS_`を編集するだけでよい）。
- 一覧ページのHTML構造に依存したパースのため、各学会側でページのマークアップが大きく変わると抽出できなくなる可能性がある。その場合は`fetchNaikaAnnouncementSourceResult_`・`fetchJdsAnnouncementSourceResult_`が「取得0件」または失敗として`source_run_logs`に記録されるので、そこで気づける（他の情報源には影響しない）。

## データの構造

Googleスプレッドシート内に3つのシートを持つ。

| シート名 | 役割 |
| --- | --- |
| `information_items` | 現在の状態（1id=1行）。人間の確認状態・重要度・HOME表示・変更検知用のハッシュ・欠落回数を含む |
| `information_item_history` | 内容変更・供給再開・掲載未確認を検知するたびに追記される変更履歴 |
| `source_run_logs` | 情報源（PMDA／厚労省供給／Minds／学会お知らせ／厚労省報道発表）ごとの実行結果（成功/失敗・件数・エラー内容）のログ |

v2までの「情報アイテム変換結果」シートは削除しない。初回実行時に自動移行され、「旧_情報アイテム変換結果」という名前でそのまま残る（詳細は後述）。

`information_items`のシート・見出し行は、実行のたびに現在の列構成（`INFO_ITEMS_HEADER_`）で書き直される。これにより、今後さらに列を追加した場合でも、既存のスプレッドシートの見出しが古いまま残ってしまう心配がない（`source_run_logs`も同様）。

## 内容変更の検知

各情報について、情報源ごとに決めた項目（PMDAなら回収理由・健康被害・回収開始日など、厚労省供給状況ならYJコード・出荷対応・出荷量など）からハッシュ値（`contentHash`、SHA-256）を計算し、前回のハッシュと比較する。

- 新規id：`changeStatus = 'new'`（未確認・未確定の初期状態）
- 既存id・ハッシュ一致：`changeStatus = 'unchanged'`（確認状態をそのまま維持）
- 既存id・ハッシュ不一致：`changeStatus = 'updated'`
  - `reviewStatus` は `unreviewed` に戻る（対象外(excluded)だった情報は対象外のまま維持）
  - 重要度確定（`confirmedImportance`）はクリアされる
  - **HOME表示確定（`homeDisplayConfirmed`）はいきなり消さない**。確定状態は維持したまま `homeDisplayNeedsReview = true` を立てて、アプリ側で「内容が変わったので再確認してください」と分かるようにしている

### 供給再開・掲載未確認の判定（v3.1で修正）

厚労省Excelから品目の掲載が確認できなくなる理由は「本当に通常出荷へ戻った」以外にも、掲載対象の変更・一時的なデータ欠落・Excel形式変更・解析漏れなど複数考えられる。そのため、判定を次のように分けている。

- **`changeStatus = 'resolved'`（供給再開・確定）**：Excel内でその品目の出荷対応が明示的に「通常出荷」と書かれていることを確認できた場合のみ
- **`changeStatus = 'missing'`（掲載未確認・要手動確認）**：追跡中のYJコードが、今回のExcelにまったく見当たらなかった場合。内容（タイトル・要約・HOME表示・重要度）はすべて**前回の値をそのまま維持**し、`requiredAction`に「手動確認してください」という案内を入れる。ハッシュも前回のまま変えない（内容不明のため）
  - 何回連続で見当たらないかを `missingStreak` に記録する
  - **初めて`missing`になった時だけ**、内容変更(`updated`)と同様に人間の確認状態をリセットし、履歴にも記録する
  - 2回目以降、連続して見当たらない間は `missingStreak` だけ増やし、確認状態・再確認フラグは変更しない（毎回アラートが再燃しないようにするため）
  - 再びExcelに掲載が確認できれば、`missingStreak`は0に戻る

## 再確認フラグ（homeDisplayNeedsReview）の解除条件（v3.1で修正）

`homeDisplayNeedsReview`は、`doPost`のアクション内容に関わらず解除されるのではなく、**`reviewStatus: 'reviewed'`を明示的に指定した場合だけ**解除される。重要度だけ、あるいはHOME表示だけを操作しても解除されない。

さらに、GAS側の業務ルール（`businessRuleAllowsUpdate_`）で、`homeDisplayNeedsReview`が立っている情報については、**先に「内容を確認済みにする」を行わない限り**、重要度確定・HOME表示の変更そのものを拒否する（同じリクエストで`reviewStatus: 'reviewed'`と重要度確定を同時に送ることは許可している）。これにより「原資料を確認 → 内容確認済みにする → 重要度を再確定 → HOME表示を再確認」という順序をサーバー側でも強制している。

## ウォッチ設定IDの検証（v3.1で修正）

ウォッチ設定の保存を許可するIDは、コード側の固定リスト `ALLOWED_WATCH_IDS_ = ['watch_pharmacy', 'watch_clinic', 'watch_clinical', 'watch_system']` で常に検証する。以前は「まだ一度も保存されていない場合、既知ID一覧がnullになり任意のIDを保存できてしまう」問題があったため、保存済み設定の有無に関わらず常にこの固定リストを使うようにした。

## 排他制御（LockService）とロックの持ち方（v3.1で見直し）

PMDA CSV・厚労省Excelの取得はネットワーク越しで数秒〜十数秒かかることがある。v3では取得開始前からロックを取っていたため、その間に人間が確認ボタンを押すと10秒でタイムアウトしやすい問題があった。v3.1では次の2段階に分けている。

1. ロックを取らずに外部データを取得する（下準備として、取得前の`information_items`の状態も読んでおく）
2. シートの読み書きだけをロックで保護する。ロックを取った直後に状態を読み直すことで、取得中に人間が行った変更を取りこぼさない

`doPost`（人間の操作）は引き続き取得処理とは別に、操作のたびにロックを取る。ロック取得に失敗した場合、`doPost`は明確なエラーを返し、自動実行は今回分をスキップしてログに記録する（黙って何もしない、ということはしない）。

## 入力値検証・業務ルール（doPost）

- `reviewStatus` / `confirmedImportance` / ウォッチ設定の `level` ・ `id` は、決められた値・固定リスト以外を拒否する
- `id` は文字種・長さを制限、`confirmedBy` は長さを制限
- 対象外(excluded)の情報は一切変更を受け付けない
- 重要度が未確定のまま HOME表示 を ON にする更新は拒否する
- 再確認必要(`homeDisplayNeedsReview`)な情報は、先に確認済みにしない限り重要度・HOME表示の変更を拒否する

これらはあくまで「不正な形式・矛盾した状態を弾く」ためのものであり、本人確認（認証）ではない点に注意。

## 数式インジェクション対策

PMDA CSV・厚労省Excelから取得した文字列のうち、先頭が `=` `+` `-` `@` のものは、スプレッドシートに書き込む前に先頭へシングルクォートを付けて無害化している（`sanitizeCellValue_`）。日付・数値・真偽値のフィールドには適用していない。

## 移行（v2→v3系）

初回の `runConvertAllToInformationItems`（または単体実行関数）実行時に、`migrateLegacySheetIfNeeded_` が自動的に動く。

- 旧「情報アイテム変換結果」シートがあれば、人間の確認状態・重要度・HOME表示・取得日時を引き継いで新しい `information_items` シートを作る
- 旧シートは**削除せず**、「旧_情報アイテム変換結果」という名前にリネームして残す
- 移行済みかどうかはスクリプトプロパティ（`LEGACY_MIGRATION_DONE_V3`）で管理するため、2回目以降は自動的にスキップされる
- 移行直後の1回目の取得では、内容が実際に変わっていても「変更あり」としては検知されない（移行時に元のハッシュ計算に必要な情報がすべては引き継げないための仕様）。**2回目以降の自動取得から正しく変更検知が働く**

すでにv3（`information_items`が29列）を導入済みの場合、v3.1では列が1つ増える（`missingStreak`）が、追加の移行処理は不要。見出し行は実行のたびに自動的に現在の列構成へ書き直され、既存データの列がずれることはない。

## セットアップ・使い方

1. Googleスプレッドシートを開く（v1〜v3で使っていたものと同じでよい）
2. 拡張機能 → Apps Script
3. 中身を全部消して、`pmda-recall-fetcher.gs` の内容を貼り付けて保存
4. `runConvertAllToInformationItems` を実行（初回は権限承認、旧シートがあれば自動移行が走る）
5. Web Appとして再デプロイ（関数名は変えていないので、既存のデプロイを「編集」して再デプロイすればよい。新しいデプロイを作るとURLが変わってしまうので注意）
6. 毎朝の自動実行トリガーは関数名（`runConvertAllToInformationItems`）を変えていないため、**すでに `setupDailyTrigger` を実行済みなら再設定は不要**

## デバッグ用の単体実行

- `runConvertPmdaRecallToInformationItems`：PMDAだけ取得してマージ
- `runConvertMhlwSupplyToInformationItems`：厚労省供給状況だけ取得してマージ
- `runConvertMindsGuidelineToInformationItems`：Mindsガイドラインお知らせだけ取得してマージ
- `runConvertNaikaAnnouncementToInformationItems`：日本内科学会お知らせだけ取得してマージ
- `runConvertJdsAnnouncementToInformationItems`：日本糖尿病学会お知らせだけ取得してマージ
- `runConvertMhlwHoudouToInformationItems`：厚労省報道発表（薬機法等）だけ取得してマージ
- `runPmdaRecallCsvPoc`：`information_items` の仕組みとは独立した、PMDA CSVの生データ確認用（`PMDA_回収情報_PoC`シート）
- `listTriggers` / `setupDailyTrigger` / `removeDailyTrigger`：定期実行トリガーの確認・設定・削除

## テスト

`gas/pmda-recall-fetcher.gs` のうち、SpreadsheetApp等のGAS専用APIに依存しない関数（ハッシュ計算・変更検知・マージ・入力値検証など）は、リポジトリの `test/gas-pure-logic.test.mjs` からNode.jsの `vm` モジュールでこのファイルをそのまま読み込んでテストしている（ロジックを別ファイルに複製していないため、実際に貼り付けるコードがテストされる）。ハッシュ関数（SHA-256の純粋JS実装）はNode.jsの`crypto`モジュールが返す結果と一致することも確認済み。`npm test` で実行できる。

## v3→v3.1の変更点（2次監査対応）

1. 供給再開の誤判定を修正：Excelから消えただけでは解消と判定せず、`missing`（要手動確認）として内容・HOME表示を維持したまま扱うようにした
2. `homeDisplayNeedsReview`の解除条件を「内容を確認済みにする」操作時のみに限定し、それまでは重要度・HOME表示の変更をGAS側で拒否するようにした
3. ウォッチ設定の許可IDをコード側の固定リストで常に検証するようにした
4. 外部データの取得をロックの外に出し、シート更新の直前だけロックを取る構成に変更した
5. ハッシュ関数を軽量ハッシュ(cyrb53)からSHA-256（純粋JS実装）に変更した
6. `information_items` / `source_run_logs` の見出し行を実行のたびに自動的に書き直すようにした（列追加時に見出しが古いまま残らないように）

## v3.1→v3.2の変更点

1. PMDA回収情報をクラスII・IIIにも拡大。クラスI・II・IIIをそれぞれ独立した情報源（`pmda_recall_class1/2/3`）として扱い、1クラスの取得失敗が他クラスに影響しないようにした
2. idの生成方式を`sourceId + 回収番号`に変更（旧`pmda_recall_ + 回収番号`）。クラスをまたいで回収番号が重複してもinformation_itemsシート全体でidが一意になるようにするため
3. 画面表示用に、情報源名（sourceName）へクラス名（クラスI/II/III）を含めるようにした（`extractRecallClassLabel_`）
4. `doGet`に`?action=history&itemId=...`クエリを追加し、`information_item_history`から指定アイテムの変更履歴（新しい順・最大50件）を返せるようにした（`getHistoryForItem_` / `filterAndFormatHistoryRows_`）。アプリの詳細画面に「変更履歴」セクションを追加し、この新しいクエリを使って表示している

## v3.2→v3.2.1の変更点（不具合修正）

v3.2でPMDA回収情報のidを「sourceId + 回収番号」に変更したが、これは不要な変更であり、むしろv3.1以前からの既存データ（クラスIのみを扱っていた時代のid）と不整合を起こしていた（クラスIの既存データが「別の新規データ」として二重登録されてしまう不具合）。回収番号自体がPMDAの発行するクラスをまたいでも重複しない一意な番号のため、idは`pmda_recall_ + 回収番号`に戻した。

上記不具合で二重登録されてしまった行を片付けるための一度きりの関数`runCleanupBuggyClassPrefixedPmdaIds`を追加した（GASエディタの実行プルダウンから手動実行する。該当行が無ければ「0件削除」と出るだけで、何度実行しても安全）。実行後、あらためて`runConvertAllToInformationItems`を実行し、正しいidで再取得・マージし直すこと。

**Apps Scriptエディタの仕様上の注意**：関数名の末尾がアンダースコア（`_`）で終わる関数は、実行プルダウンに一切表示されない（「内部用・直接実行しない関数」という慣習を汲んだ仕様）。手動実行してほしい関数を追加する際は、必ずアンダースコア無しの名前（`runXxx`のような形）にすること。

## v3.2.1→v3.3の変更点（ガイドラインウォッチボットの追加）

Mindsガイドラインライブラリ（公益財団法人日本医療機能評価機構が運営）の「お知らせ」ページを新しい情報源（`minds_guideline`）として追加した。詳細は上の「取得している情報」内の該当節を参照。

- 他の情報源と同様、独立したsourceId・`source_run_logs`エントリを持つため、この情報源の取得失敗・ページ構成変更が他情報源（PMDA・厚労省）に影響することはない
- `runConvertAllToInformationItems`（毎朝の自動実行）が3情報源（PMDA・厚労省・Minds）すべてを取得するようになった
- 単体デバッグ実行用に`runConvertMindsGuidelineToInformationItems`を追加した
- HTML解析はGAS API非依存の純粋関数（`stripHtmlTags_` / `parseMindsNewsEntryText_` / `extractMindsNewsEntries_` / `isGuidelineNewsTitle_` / `buildMindsGuidelineItem_` / `buildMindsIncomingItems_`）として実装し、`test/gas-pure-logic.test.mjs`でテストしている
- 一覧ページの実際のHTML構造（クラス名など）は未確認のまま実装している。href（`/news-{数字}/`）というURLパターンだけを頼りに抽出するようにして構造変化に強くしてあるが、**初回実行後は`information_items`シートに実際に「ガイドライン」アイテムが正しく登録されているか、フリちゃんの環境で必ず確認してほしい**（0件のままなら`source_run_logs`のエラー内容を確認）

## v3.3→v3.4の変更点（学会お知らせボットの追加）

日本内科学会・日本糖尿病学会の「お知らせ一覧」を新しい情報源（`naika_announcement`／`jds_announcement`）として追加した。詳細は上の「取得している情報」内の該当節を参照。

- 「学会で話されている最新の治療トレンドを拾いたい」という要望から出発したが、CareNet・Medical Tribune等の医療ニュースサイトは無料会員登録が必須で自動取得の対象にできなかったため、学会公式サイトのお知らせページを情報源とする方針に変更した（フリちゃんと合意済み）
- 他の情報源と同様、独立したsourceId・`source_run_logs`エントリを持つため、この情報源の取得失敗・ページ構成変更が他情報源に影響することはない
- `runConvertAllToInformationItems`（毎朝の自動実行）が5情報源（PMDA・厚労省・Minds・日本内科学会・日本糖尿病学会）すべてを取得するようになった
- 単体デバッグ実行用に`runConvertNaikaAnnouncementToInformationItems`・`runConvertJdsAnnouncementToInformationItems`を追加した
- HTML解析はGAS API非依存の純粋関数（`findJapaneseDateAsIso_` / `isTreatmentRelatedAnnouncementTitle_` / `extractDatedAnnouncementEntries_` / `buildNaikaAnnouncementLinkRegex_` / `buildJdsAnnouncementLinkRegex_` / `buildGakkaiAnnouncementItem_` / `buildGakkaiIncomingItems_`）として実装し、`test/gas-pure-logic.test.mjs`でテストしている
- 一覧ページの実際のHTML構造は未確認のまま実装している。href（`/info/{slug}/`・`?content_id={数字}`）というURLパターンと、リンク直前の日付テキストだけを頼りに抽出するようにして構造変化に強くしてあるが、**初回実行後は`information_items`シートに実際にそれらしい「治療情報」アイテムが正しく登録されているか、フリちゃんの環境で必ず確認してほしい**（0件のままなら`source_run_logs`のエラー内容を確認）
- キーワードによる絞り込み（`GAKKAI_TREATMENT_KEYWORDS_`）は初回実装時点の暫定案。実際の取得結果を見ながら調整していく想定

### 厚労省報道発表（薬機法等の法的関連情報、v3.5で追加）

- 厚生労働省「報道発表資料」の月別一覧ページ（`https://www.mhlw.go.jp/stf/houdou/houdou_list_{YYYYMM}.html`）をHTML取得・パースする。URLが月ごとに変わるため、日付から当月・前月のYYYYMMを自動算出する（`mhlwHoudouYearMonthCandidates_`。月初めでまだ当月ページが作成されていない場合に備えて前月にもフォールバックする、PMDAの年度計算と同じ考え方）。
- このページは雇用・年金・介護・感染症等、厚労省のあらゆる分野の発表が混ざっている一覧のため、他のお知らせ系ボットよりも強めの絞り込みが必要。タイトルに **「薬機法」「医薬品」「医療機器」「薬事」「調剤」「薬局」「処方箋」「医薬部外品」「再生医療等製品」「省令」「告示」** のいずれかを含むものだけを対象にする（`MHLW_LEGAL_KEYWORDS_`で定義。フリちゃんと合意済み）。
- 学会お知らせと同じ理由（日付とタイトルへのリンクが別要素）で、`extractDatedAnnouncementEntries_`（汎用パース関数）をそのまま再利用している。詳細ページへのリンクは`/stf/newpage_{数字}.html`という現行の主要パターンのみを対象にしており、これに当てはまらない古い形式のリンク（`/stf/houdou/...`等）は拾えない場合がある。
- カテゴリは`pharmacy`、itemTypeは`行政通知`に固定。重要度は一律`info`（参考）からスタートし、人間が個別に確認・重要度確定する運用。
- キーワードセット・リンクパターンともに初回実装時点の暫定案。実際に取れた件数・中身（雇用や介護のニュースが誤って混入していないか等）を見ながら調整していく想定。

## v3.4→v3.5の変更点（薬機法等の法的関連情報ボットの追加）

厚生労働省「報道発表資料」月別一覧を新しい情報源（`mhlw_houdou`）として追加した。詳細は上の「取得している情報」内の該当節を参照。

- 「薬機法等の法的な最新情報を拾いたい」という要望から。厚労省・日本薬剤師会双方の公式な法令・通知情報はほぼ月次PDF公報の形でしか公開されておらず機械的な解析が難しかったため、雇用・年金等も含む広範な「報道発表資料」一覧をキーワードで絞り込む方式を採用した（フリちゃんと合意済み）
- 他の情報源と同様、独立したsourceId・`source_run_logs`エントリを持つため、この情報源の取得失敗・ページ構成変更が他情報源に影響することはない
- `runConvertAllToInformationItems`（毎朝の自動実行）が6情報源（PMDA・厚労省供給・Minds・日本内科学会・日本糖尿病学会・厚労省報道発表）すべてを取得するようになった
- 単体デバッグ実行用に`runConvertMhlwHoudouToInformationItems`を追加した
- 新規の純粋関数：`formatYearMonth_` / `mhlwHoudouYearMonthCandidates_` / `isLegalRelatedAnnouncementTitle_` / `buildMhlwHoudouLinkRegex_` / `buildMhlwHoudouItem_` / `buildMhlwHoudouIncomingItems_`（`test/gas-pure-logic.test.mjs`でテスト済み）。日付・タイトルの抽出自体は学会お知らせと共通の`extractDatedAnnouncementEntries_`を再利用している
- **他のボットよりノイズが多くなりやすい情報源**：報道発表資料はあらゆる分野が混在するため、キーワードに引っかかって誤って混入する無関係な発表が出てくる可能性がある。初回実行後は`information_items`シートの`sourceId`が`mhlw_houdou`の行を一通り見て、明らかに無関係なものが多ければ`MHLW_LEGAL_KEYWORDS_`を調整してほしい

## 次のステップ

1. 医療機器等（区分`k`）への対象拡大
2. 認証基盤の検討（本番運用前の必須課題）
