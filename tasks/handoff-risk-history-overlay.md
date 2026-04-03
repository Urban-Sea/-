# 引き継ぎ: risk-history 赤線の最新月オーバーレイ

## 状況

赤線（過去リスクスコア履歴）の最新月がリアルタイム版（青い数字）と一致しない問題を修正中。

## 根本原因

- **リアルタイム版** (`get_risk_score`): `_calc_*` 系のフル関数で計算。最新データを desc order で取得
- **履歴版** (`get_risk_history`): `_simplified_*` 系の簡易関数で計算。過去全期間を asc order + limit 1000 で取得
- この2つは**完全に別のコードパス**で、閾値もデータ取得方法も異なる
- 結果: リアルタイム=50点、履歴の最新月=38点 という乖離が発生

## やったこと（完了）

1. **正規化の除去** — 両方から除去済み。リアルタイム版は正しく50点を返す ✅
2. **precomputed_results の古いデータ削除** — 2/26時点の49点（正規化あり）を削除 ✅
3. **Redis キャッシュクリア** — `employment:risk_history:350`, `employment:risk_score` 削除済み ✅
4. **`_compute_risk_score_fresh()` 切り出し** — 内部呼び出し用の関数を作成 ✅
5. **雇用乖離の detail メッセージ改善** — 0点でもデータ状況を表示 ✅
6. **purge パラメータ追加** — `/risk-history?purge=1` でL1キャッシュをスキップ可能 ✅

## 未完了: overlay が効かない

### 試したアプローチと結果

| アプローチ | 結果 | 原因 |
|-----------|------|------|
| `await get_risk_score()` を呼ぶ | precomputed の古い値が返る | precomputed が優先される |
| `await _compute_risk_score_fresh()` を呼ぶ | Cloud Run で 500 エラー | asyncio ネスト問題（推定） |
| inline で `_calc_*` 関数を呼ぶ（consumer_rows 使用） | 成功するがスコア変わらず | consumer_rows が limit 1000 で最新 379 行欠落 |
| overlay 用に別途 desc limit 150 で取得 | スコア 38 のまま | **except に落ちている（原因未特定）** |

### 現在のコード状態

`app/backend/routers/employment.py` line 1595-1648:
- overlay ブロックが try-except 内にある
- `supabase.table("economic_indicators").select(...).execute()` を同期的に呼んでいる
- **except に落ちているがエラー内容が不明**（Cloud Run のログでしか確認できない）

## 推奨アーキテクチャ（リアルタイム overlay をやめる）

**現在の問題**: 毎リクエスト324ヶ月分を動的計算 + 最新月だけリアルタイム上書き → 複雑すぎて壊れた

**あるべき姿**:

```
[バッチ (daily/weekly)]
  │
  ├─ _calc_* フル関数で全月のスコアを計算（1つのコードパス）
  ├─ 結果を Redis or Supabase テーブル (risk_score_history) に保存
  │
  └─ _simplified_* 簡易関数は廃止

[/risk-history エンドポイント]
  │
  └─ Redis/DB から読むだけ（計算しない）

[/risk-score エンドポイント]
  │
  └─ 今のまま（リアルタイム計算）

[フロントエンド]
  │
  ├─ /risk-history のデータで赤線を描画
  └─ 最新月だけ /risk-score の total_score で上書き（JS側で1行）
```

### メリット
- **1つのコードパス**: `_simplified_*` 関数が不要になる。`_calc_*` だけでバッチ計算
- **リクエスト時に計算しない**: 読むだけなのでレスポンス高速、エラーなし
- **最新月の一致**: フロントで `/risk-score` の値を使うだけ。バックエンドの overlay 不要
- **デバッグ容易**: バッチログで計算結果を確認できる

### 実装ステップ
1. Supabase に `risk_score_history` テーブルを作成（date, total_score, employment_score, consumer_score, structure_score, phase, sahm_value）
2. バッチ (`run.py --daily`) に履歴計算ジョブを追加。`_calc_*` 関数で各月を計算して upsert
3. `/risk-history` を DB/Redis 読み取りに変更（動的計算コードを削除）
4. フロントエンド (`employment/page.tsx`) で最新月を `/risk-score` の値に差し替え
5. `_simplified_*` 関数群を削除

### 注意
- 初回は全324ヶ月分をバッチで一括計算する必要がある（1回だけ）
- 以降は daily バッチで最新月だけ追加/更新
- バッチが CF Access の 403 で Cloud Run API を叩けない問題がある → バッチ内で直接 Python 関数を呼ぶ（API 経由にしない）

## その他の注意事項

- `precomputed_results` テーブルの `risk_score` 行は削除済み。バッチの precompute が 403 (CF Access) で動かないため再生成されない
- risk-history の TTL は 6 時間 (`_RISK_HISTORY_TTL = 21600`)
- Cloud Run の L1 インメモリキャッシュは外部から消せない。デプロイでコンテナが入れ替わるまで残る

## 関連ファイル

- `app/backend/routers/employment.py` — メインのロジック（overlay コード含む）
- `app/backend/redis_cache.py` — L1 + L2 キャッシュ
- `app/backend/precomputed.py` — precomputed_results テーブル参照
- `app/batch/run.py` — daily/weekly バッチ
- `app/frontend/src/app/employment/page.tsx` — 赤線描画（line 518）
- `app/frontend/src/lib/api.ts` — `useRiskHistory(350)` hook
