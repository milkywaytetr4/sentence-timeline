# 1a 読解タイムライン

東大英語1a（要約）を解くときの閲覧ログを文単位で記録し、先生と生徒の取り組みをタイムラインで比較するアプリです。
要件は「要件定義たたき台」（2026年10月2日）、画面は Claude Design の「学習記録アプリ v3」に基づきます。

## 構成

- Next.js（App Router）+ TypeScript、Vercel に載せる前提
- Supabase（Postgres + Storage）。ブラウザからは一切触らず、DB アクセスはサーバー側（Route Handler と Server Action）に閉じる
- スクリーンショットからの本文抽出と解答の改稿は OpenAI API（`gpt-6-luna`）をサーバーから呼ぶ

| パス | 内容 |
| --- | --- |
| `/enter` | 合言葉の入力。ロール入りの署名付き httpOnly cookie を発行する |
| `/` | 問題一覧、取り組み履歴、新規取り組みの開始 |
| `/attempts/[id]` | 計測画面 |
| `/compare` | タイムライン比較（`?problem=...&a=id1,id2` で版を指定できる）。各解答の下で、解答の書き口を残して LLM に改稿させられる（取り組みごとに最新の1回を保存） |
| `/admin/import` | スクリーンショットからの問題の取り込み（先生のみ） |
| `/admin/problems/[id]` | 文・段落の区切りとメタ情報の編集（先生のみ） |

記録は「いま見ている文」が切り替わった時点のイベント（`events` テーブル）だけを保存し、画面の状態やタイムラインは毎回イベント列から計算します（`lib/domain/timeline.ts`）。Undo は行を消さず `voided` を立てます。イベントは端末の localStorage に一時保持してまとめて送り、失敗したら再送します。

## セットアップ

1. Supabase のプロジェクトを作り、`npx supabase login` → `npx supabase link --project-ref <プロジェクトの ref>` → `npx supabase db push` で `supabase/migrations` を適用する（テーブル、RLS、RPC 関数、private バケット `problem-images` を作成）。以後マイグレーションを追加したときも `npx supabase db push` で適用する
2. `.env.example` を `.env.local` にコピーして値を入れる。Vercel では同じ変数を Environment Variables に登録する
3. `npm install` → `npm run dev`

## 開発用コマンド

```bash
npm run dev        # 開発サーバー
npm test           # 単体テスト（vitest）
npm run typecheck  # 型チェック
npm run lint       # Biome
```

## 制約

- 取り込める画像は PNG / JPEG で10枚・合計4MBまで（Vercel の関数が受け取れる本文が 4.5MB までのため）。1MB を超える画像はブラウザ側で JPEG に変換してから送る
- 取り組みの記録がある問題は、誤字修正とメタ情報の編集だけができる（文の結合・分割をすると過去のタイムラインが崩れるため）
