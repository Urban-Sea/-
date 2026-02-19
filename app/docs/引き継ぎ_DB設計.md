# 引き継ぎ: DB設計の詳細検討

> 前回のチャットで決まったことと、次にやることのまとめ

---

## 決定済みの事項

### 1. システム構成

```
フロントエンド: Next.js + Cloudflare Pages（無料）
バックエンド:   FastAPI + Railway（無料）
データベース:   Supabase PostgreSQL（無料）
株価データ:     yfinance（都度取得、DB保存しない）
```

### 2. 保存するもの・しないもの

**保存する:**
- `stock_master` - 銘柄マスター
- `economic_indicators` - 経済指標（修正履歴対応・横展開方式）
- `stock_cache` - 一時キャッシュ（5分TTL）
- `holdings` - 保有銘柄（個人）
- `trades` - 取引履歴（個人）
- `user_watchlists` - ウォッチリスト（個人）
- `user_settings` - ユーザー設定（個人）

**保存しない:**
- 株価OHLCV → yfinanceで都度取得
- EMA/ATR等 → 計算で出せる
- シグナル結果 → 再計算可能（任意）

### 3. 経済指標の修正履歴対応

横展開方式で設計済み:
```
initial_value, initial_date
rev1_value, rev1_date, rev1_change
rev2_value, rev2_date, rev2_change
final_value, final_date, final_change
revision_count, total_revision
```

### 4. キャッシュ戦略

- 5分TTL（yfinanceの更新間隔に合わせる）
- 複数ユーザーで共有
- 期限切れは定期削除

### 5. ロジック保護

- 計算ロジック（V10等）はFastAPIサーバー内に配置
- フロントエンドには結果のJSONのみ返す
- ソースコードはサーバー外に露出しない

---

## 詳細設計のSQL

[app/docs/システム設計_詳細.md](システム設計_詳細.md) のセクション3.3に記載済み

---

## 次にやること

### DB設計の詳細検討

1. **各テーブルのカラム確認**
   - 過不足ないか
   - データ型は適切か

2. **インデックス設計**
   - クエリパターンに基づく

3. **制約設計**
   - UNIQUE, NOT NULL, CHECK等

4. **経済指標の対象指標**
   - NFP, GDP, CPI, 失業率...他に何が必要か

5. **銘柄マスターの初期データ**
   - どの銘柄を登録するか
   - カテゴリ分け

---

## 参照ファイル

- [app/docs/システム設計_詳細.md](システム設計_詳細.md) - 全体設計
- [demo/docs/新システム移行_会社版.md](../../demo/docs/新システム移行_会社版.md) - 元の移行計画

---

## 現在のdemoのDB情報

### market_data.db のテーブル（参考）

```
fed_balance_sheet    (3,455件) - FRBバランスシート
interest_rates       (4,350件) - 金利
credit_spreads       (4,469件) - クレジットスプレッド
market_indicators    (4,293件) - VIX, DXY, SP500, NASDAQ
bank_sector          (4,290件) - KRE
srf_usage            (1,619件) - SRF利用額
margin_debt          (348件)   - 信用取引残高
mmf_assets           (63件)    - MMF資産
employment_monthly   (36件)    - 月次雇用統計
weekly_claims        (103件)   - 週次失業保険
trade_signals        (5,794件) - シグナル（重複あり）
signal_snapshots     (1,215件) - スナップショット
signal_outcomes      (1,215件) - 結果追跡
stock_analysis       (321件)   - 銘柄分析
```

### 疑問点（要検討）

- 日次マーケットデータ（VIX, DXY等）は新システムで必要か？
- 流動性関連（fed_balance_sheet等）はどうするか？
- これらもyfinance等で都度取得可能？

---

## 次のチャットの開始プロンプト例

```
DB設計の詳細を検討したいです。
引き継ぎファイルを読んでください: app/docs/引き継ぎ_DB設計.md
```
