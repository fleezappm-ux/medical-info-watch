# 医療情報ウォッチ（初期版・モックデータ）

薬局・クリニック向けの規制/臨床情報 収集・重要度判定ツール。
[Pharmacy OS](https://github.com/fleezappm-ux/pharmacy-os) からは完全に独立して動作する。

## 現在の状態（このコミット）

- **実データ取得なし**：全件モックデータ（`src/data/mockItems.ts`）
- 画面：情報一覧（全件／要確認／重要情報（確定）／取得エラー）、詳細画面（原資料リンク分離）、ウォッチ設定（OFF／監視ON／HOME表示ON）
- Pharmacy OS連携API・実ボット・通知機能は未実装（申し送りメモ「14. 初期版で作り込まないもの」に準拠）

### 監査対応（このコミットで修正）

1. 「内容確認」「重要度確定」「HOME表示確定」を3つの独立操作に分離。AI判定を人間の確定値へ自動コピーしない（`src/lib/review.ts`, `App.tsx`）
2. 重要度・HOME表示の確定者・確定日時を型に追加（`importanceConfirmedBy/At`, `homeDisplayConfirmedBy/At`）
3. 「重要情報」タブは人間が確定したものだけに限定。AI候補のみの情報は含めない（`isConfirmedImportant`）
4. `excluded`（対象外）は内容確認・重要度確定・HOME表示確定の対象外にした
5. 「本日の取得」件数を`fetchedAt`の日付（JST基準）で正しく集計（`isSameLocalDay`）
6. 「取得エラー」専用タブを追加
7. `src/lib/review.ts`のルールに対する最低限のユニットテストを追加（`npm run test`）

### 既知の未対応（次段階）

- ウォッチ設定・確認状態はページ再読み込みで消える（永続化なし）
- 疾患・診療科・ガイドライン単位の詳細設定は未実装
- 認証・ロール・施設分離は未実装（確定者名は固定値）
- 実データ取得・DB・通知・Pharmacy OS連携APIは未実装

## セットアップ

```bash
npm install
npm run dev      # ローカル確認 (http://localhost:5173/medical-info-watch/)
npm run build    # dist/ に本番ビルド
```

## GitHub Pagesへのデプロイ手順（案）

1. GitHubで `fleezappm-ux/medical-info-watch` の新規リポジトリを作成（public）
2. このフォルダの中身をpush
   ```bash
   git init
   git add .
   git commit -m "init: 情報ウォッチ 初期版 (モックデータ)"
   git branch -M main
   git remote add origin https://github.com/fleezappm-ux/medical-info-watch.git
   git push -u origin main
   ```
3. `npm run build` で `dist/` を生成し、GitHub Pages（`gh-pages` ブランチ、または Actions によるデプロイ）で公開
   - リポジトリ名を変えた場合は `vite.config.ts` の `base` を必ず合わせて変更すること
4. 公開URL例：`https://fleezappm-ux.github.io/medical-info-watch/`

## 次のステップ（要承認）

- PMDA／厚労省の代表的な情報源1件で実データ取得の実証（申し送りメモ「6. 情報源の基本方針」）
- 発出番号・原文ハッシュ等を含むフルスキーマへの拡張
- Pharmacy OS連携API（`GET /api/integrations/pharmacy-os/home`）の実装
