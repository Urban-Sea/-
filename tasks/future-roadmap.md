# 将来ロードマップ：機能拡張計画

> 作成日: 2026-02-27
> 更新日: 2026-03-01
> ステータス: 検討段階（未着手）
> アーキテクチャ: `tasks/architecture-decisions.md` 参照

### 技術スタック（確定）

| レイヤー | 技術 | 言語 |
|---------|------|------|
| Frontend | Cloudflare Pages (Next.js SSG) | TypeScript |
| CRUD API | Cloudflare Workers | TypeScript |
| 計算 API | Google Cloud Run | **Python** (FastAPI + yfinance) |
| DB | Supabase PostgreSQL | — |
| キャッシュ (エッジ) | Workers Cache API | — |
| キャッシュ (アプリ) | Upstash Redis | — |
| エラー監視 | Sentry | — |
| 分析 | PostHog | — |
| 決済 | Stripe | — |
| メール | Resend | — |

---

## 1. 新タブ：マクロ検証（バリュエーション＆クロスアセット分析）

### 1.1 概要

既存タブが「今」を見るのに対し、マクロ検証タブは**長期的な歴史的位置付け**を可視化する。
「今の米国株は割高か？」「Gold vs 株のサイクルはどこか？」「ドル安は海外株に有利か？」を
データで検証し、投資判断の根拠を提供する。

### 1.2 タブ構成案

```
マクロ検証タブ
├── ダッシュボード: 現在のCAPE / Gold比率 / DXY / 地域別PER サマリーカード
├── クロスアセット比較
│   ├── S&P500 / Gold 比率（長期サイクル）
│   ├── DXY vs S&P500 相関チャート
│   ├── S&P500 vs 全世界株(VT) vs 米国除く(VXUS) パフォーマンス
│   ├── S&P500 vs 新興国(VWO) vs 欧州(VGK) vs 日本(EWJ)
│   └── 期間セレクター（1Y / 3Y / 5Y / 10Y / MAX）
├── バリュエーション分析
│   ├── Shiller CAPE 推移（1988年〜現在）+ 現在位置ハイライト
│   ├── Buffett Indicator（時価総額/GDP）推移
│   ├── 主要地域バリュエーション比較（米/欧/日/EM の trailing PE）
│   └── 危険域・割安域のバンド表示
└── 将来リターン検証（散布図）
    ├── CAPE vs その後1年リターン
    ├── CAPE vs その後10年リターン（年率換算）
    └── 「現在のCAPEはここ」マーカー + 過去の分布
```

### 1.3 必要なデータソース

| データ | ソース | 取得方法 | 頻度 | 難易度 |
|--------|--------|---------|------|--------|
| Gold (GC=F or GLD) | Yahoo Finance | バッチ追加 | 日次 | 低 |
| VT (全世界株ETF) | Yahoo Finance | バッチ追加 | 日次 | 低 |
| VXUS (米国除く全世界) | Yahoo Finance | バッチ追加 | 日次 | 低 |
| VWO (新興国) | Yahoo Finance | バッチ追加 | 日次 | 低 |
| VGK (欧州) | Yahoo Finance | バッチ追加 | 日次 | 低 |
| EWJ (日本) | Yahoo Finance | バッチ追加 | 日次 | 低 |
| S&P500 / DXY | 既にDB済み | — | — | **即可能** |
| Shiller CAPE (P/E10) | multpl.com or Shiller公式 | スクレイピング or CSV | 月次 | 中 |
| Buffett Indicator | FRED `WILL5000IND` / `GDP` | バッチ追加 | 四半期 | 低 |
| 地域別 trailing PE | Yahoo (ETF info) | yfinance `.info['trailingPE']` | 日次 | 中 |

**注意**: Forward PER (12M先) はFactSet等の有料ソースが必要。Shiller CAPEで代替すれば無料で長期分析が可能。

### 1.4 DB設計案

```sql
-- 既存 market_indicators に列追加
ALTER TABLE market_indicators ADD COLUMN gold DECIMAL;
ALTER TABLE market_indicators ADD COLUMN vt DECIMAL;    -- 全世界株ETF
ALTER TABLE market_indicators ADD COLUMN vxus DECIMAL;  -- 米国除く全世界
ALTER TABLE market_indicators ADD COLUMN vwo DECIMAL;   -- 新興国
ALTER TABLE market_indicators ADD COLUMN vgk DECIMAL;   -- 欧州
ALTER TABLE market_indicators ADD COLUMN ewj DECIMAL;   -- 日本

-- 新テーブル: バリュエーション指標（月次）
CREATE TABLE valuation_indicators (
  date DATE PRIMARY KEY,
  shiller_cape DECIMAL,         -- Shiller CAPE (P/E10)
  buffett_indicator DECIMAL,    -- Wilshire5000 / GDP (%)
  sp500_trailing_pe DECIMAL,    -- S&P500 trailing PE
  vgk_trailing_pe DECIMAL,      -- 欧州 trailing PE
  ewj_trailing_pe DECIMAL,      -- 日本 trailing PE
  vwo_trailing_pe DECIMAL,      -- 新興国 trailing PE
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 1.5 APIエンドポイント案

| エンドポイント | 内容 | Worker TTL |
|---------------|------|-----------|
| `GET /api/macro/cross-asset?period=5y` | クロスアセットデータ（SP500/Gold/VT/VXUS/DXY） | 24h |
| `GET /api/macro/valuation` | CAPE/Buffett/地域PE 最新 + 履歴 | 24h |
| `GET /api/macro/forward-returns` | CAPE水準別の将来1Y/10Yリターン散布図データ | 24h |

### 1.6 実装フェーズ

**Phase 1（即可能）: クロスアセット — DXYとS&P500**
- 既存DBデータだけで DXY vs S&P500 相関チャートを実装
- Gold (GC=F) をバッチに追加 → S&P500/Gold比率チャート
- Canvas dual-axisチャート（EconChartCanvas拡張 or 新コンポーネント）
- 工数: 2-3日

**Phase 2: ETF比較チャート**
- VT/VXUS/VWO/VGK/EWJ をバッチに追加
- market_indicatorsテーブルにカラム追加
- 地域別パフォーマンス比較チャート（正規化 or 相対リターン）
- 工数: 2-3日

**Phase 3: バリュエーション分析**
- Shiller CAPEデータ取得（multpl.com or Shiller公式CSVを初期ロード + 月次更新）
- Buffett Indicator (FRED `WILL5000IND` / `GDP`)
- valuation_indicatorsテーブル作成
- CAPE推移チャート + 危険域バンド
- 工数: 3-4日

**Phase 4: 将来リターン検証散布図**
- S&P500月次トータルリターン計算（配当再投資近似）
- CAPE vs 1Y/10Yリターン散布図（Canvas散布図コンポーネント新規）
- 「現在のCAPEはここ」インタラクティブマーカー
- 工数: 3-4日

---

## 2. AI投資レポート自動生成

### 2.1 概要

システムが保有する全データ（配管スコア、景気フェーズ、バリュエーション、クロスアセット）を
Claude APIに投入し、プロフェッショナルな投資戦略提言書を自動生成する。

### 2.2 レポート構成案

```
投資戦略提言書（自動生成）
├── 1. エグゼクティブ・サマリー
│   └── 現在の市場環境を3行で要約
├── 2. マクロ環境分析
│   ├── 配管システム: MarketState + 3レイヤースコア
│   ├── 景気フェーズ: Phase + 3カテゴリスコア
│   └── Policy Regime: QE/QT/Neutral判定
├── 3. バリュエーション分析
│   ├── CAPE現在値 vs 歴史的位置
│   ├── 地域別バリュエーション比較
│   └── S&P500/Gold比率のサイクル位置
├── 4. クロスアセット動向
│   ├── 米国株 vs 海外株のパフォーマンス差
│   ├── ドルインデックスのトレンド
│   └── 金 vs 株式のモメンタム
├── 5. リスク要因
│   ├── サームルール発動状況
│   ├── クレジットスプレッド動向
│   └── イールドカーブ形状
└── 6. 戦略的提言
    ├── 資産配分の推奨（米国株/海外株/金/現金）
    ├── セクター選好
    └── リスク管理上の注意点
```

### 2.3 技術実装案

```
バッチ（週1 or ボタン押下）
    ↓
全データ収集（配管/景気/バリュエーション/クロスアセット）
    ↓
プロンプト構築（数値データ + レポートテンプレート指示）
    ↓
Claude API (claude-sonnet-4-6) に送信
    ↓
Markdown レポート生成
    ↓
Supabase `ai_reports` テーブルに保存
    ↓
フロントエンド: 最新レポート表示 + 過去レポート履歴
```

### 2.4 DB設計案

```sql
CREATE TABLE ai_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_type TEXT NOT NULL DEFAULT 'weekly_strategy',  -- 'weekly_strategy', 'flash_alert'
  title TEXT NOT NULL,
  content TEXT NOT NULL,           -- Markdown形式
  data_snapshot JSONB,             -- 生成時のデータスナップショット
  model TEXT DEFAULT 'claude-sonnet-4-6',
  generated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 2.5 配置

- **統合ダッシュボードに「AIレポート」タブを追加** が自然
- or **独立した「AIレポート」タブ** として配置
- 過去レポートとの比較（前週→今週で何が変わったか）も将来的に

### 2.6 コスト見積もり

- Claude Sonnet: ~$3/1M input tokens, ~$15/1M output tokens
- レポート1本: 入力 ~3000 tokens + 出力 ~2000 tokens ≈ $0.04/本
- 週1生成: 月$0.16 — 実質無視できるコスト

### 2.7 実装フェーズ

**Phase 1: 基本レポート生成**
- バックエンドに `/api/reports/generate` エンドポイント
- 既存データ（配管+景気）のみでレポート生成
- フロントに最新レポート表示UI
- 工数: 2-3日

**Phase 2: バリュエーション統合**
- マクロ検証タブのデータ（CAPE/クロスアセット）をレポートに統合
- より詳細な分析が可能に
- 工数: 1-2日

**Phase 3: 定期自動生成 + 履歴**
- GitHub Actions で週1自動生成（バッチ後）
- 過去レポート一覧 + 差分ハイライト
- 工数: 1-2日

---

## 3. 既存タブの機能強化

### 3.1 銘柄分析タブ（signals）

| 改善項目 | 内容 | 工数 |
|---------|------|------|
| **エントリー確信度スコア** | RS/EMA/BOS/CHoCH等の合致度を0-100%で表示（現在はGO/NO-GOのみ） | 中 |
| **バッチ分析の強化** | ウォッチリスト全銘柄のシグナル一覧 + ソート（確信度順、セクター別） | 中 |
| **セクターローテーション表示** | 11セクターの相対強度ヒートマップ（SPDRセクターETF: XLK,XLF,XLE等） | 大 |
| **マルチタイムフレーム分析** | 週足/月足のトレンドも同時表示（現在は日足のみ） | 中 |
| **アラート機能連携** | 「この銘柄がGOになったら通知」設定 | 中 |
| **出来高分析** | Volume Profile / OBV / 出来高急増検知 | 中 |
| **類似チャートパターン検出** | 過去のエントリーポイントと類似するパターンを検索 | 大 |

### 3.2 統合ダッシュボード（dashboard）

| 改善項目 | 内容 | 工数 |
|---------|------|------|
| **マーケットサマリーカード** | S&P500/NASDAQ/VIX/DXY/Gold の当日変動をコンパクト表示 | 小 |
| **週次変化トラッカー** | 先週→今週でスコアがどう変わったか（矢印+差分表示） | 小 |
| **ミニチャート（スパークライン）** | 各スコアの直近30日推移をカード内に小さく表示 | 中 |
| **カスタムアラート設定** | 「配管スコアが70超えたら通知」等のユーザー定義閾値 | 中 |
| **AIインサイトカード** | Claude APIで「今週の注目ポイント」を自動生成 | 中 |

### 3.3 配管タブ（liquidity）

| 改善項目 | 内容 | 工数 |
|---------|------|------|
| **レイヤー間相関分析** | L1/L2A/L2B の相関マトリクス + 時系列 | 中 |
| **先行指標ハイライト** | 過去パターンから「次に何が起こりやすいか」を表示 | 大 |
| **FRBイベントカレンダー** | FOMC日程、QT/QEスケジュールをチャート上にオーバーレイ | 中 |
| **ネット流動性トレンド** | SOMA - RRP - TGA の推移と変化率 | 小 |

### 3.4 景気タブ（employment）

| 改善項目 | 内容 | 工数 |
|---------|------|------|
| **フェーズ遷移確率** | 過去データから「現在のスコアだと次のフェーズ遷移確率は○%」 | 大 |
| **指標間の先行・遅行関係** | NFPの変化がConsumer Sentimentに何ヶ月遅れで影響するか等 | 大 |
| **景気サイクルタイムライン** | 過去のEXPANSION→CONTRACTION遷移を年表形式で表示 | 中 |
| **NBER景気後退期オーバーレイ** | 公式景気後退期をチャートにグレーバンド表示 | 小 |

### 3.5 保有タブ（holdings）

| 改善項目 | 内容 | 工数 |
|---------|------|------|
| **リバランス提案** | 目標配分 vs 現在配分のドリフト検出 + 提案 | 大 |
| **相関分析** | ポートフォリオ内銘柄の相関マトリクス | 中 |
| **ベンチマーク比較** | ポートフォリオ vs S&P500 のパフォーマンス比較 | 中 |
| **配当トラッカー** | 予想配当金カレンダー + 年間配当収入推計 | 中 |
| **税金計算** | 確定申告用の損益計算（特定口座/NISA区分別） | 大 |

---

## 4. 通知システム

### 4.1 概要

バッチ処理後にリスクスコアやシグナルの変動を検知し、Slack/LINEに自動通知。

### 4.2 通知トリガー

| トリガー | 条件 | 緊急度 |
|---------|------|--------|
| 配管State変化 | NORMAL → TIGHTENING 等のState遷移 | 高 |
| 景気Phase変化 | EXPANSION → SLOWDOWN 等のPhase遷移 | 高 |
| スコア急変 | 前日比 ±10pt 以上の変動 | 中 |
| サームルール発動 | Sahm Rule trigger = true | 最高 |
| エントリーシグナル | ウォッチリスト銘柄にGOシグナル | 中 |
| バリュエーション閾値 | CAPE > 35 or < 15 等 | 低 |

### 4.3 実装案

```

### 4.4 工数

- Slack通知: 1日
- LINE通知: 1日
- 閾値管理UI: 2日

---

## 5. 公開API（データ配信サービス）

### 5.1 概要

AIエージェント（Open Claw, Claude MCP, GPTs, Dify等）が爆発的に増える時代において、
**加工済みの金融分析データをAPI経由で外部配信**する。生データではなく、
独自のスコアリング・分析ロジックを通した「判断材料」を提供する点が差別化。

### 5.2 なぜAPIか

```
従来: データ → 人間が分析 → 判断
今後: データ → AIエージェントがAPI経由で取得 → 自動判断・提案

AIエージェントが増える = API消費者が爆増する
```

- Open Claw 等のAIトレーディングエージェントが自律的にデータを取得する
- MCP (Model Context Protocol) サーバーとしても提供可能
- 「人間向けUI」と「AI向けAPI」の両方でマネタイズ

### 5.3 提供可能なエンドポイント

#### Tier 1: マーケット状態（リアルタイム性: 日次）

| エンドポイント | 内容 | 競合優位性 |
|---------------|------|-----------|
| `GET /v1/regime` | Market Regime (BULL/WEAKENING/BEAR/RECOVERY) | 独自4Regime判定ロジック |
| `GET /v1/liquidity/score` | 3レイヤー流動性スコア (0-100) | Fed配管の多層分析 |
| `GET /v1/liquidity/state` | MarketState (NORMAL→CRISIS) | 5段階State判定 |
| `GET /v1/economy/score` | 景気リスクスコア (0-100) + Phase | 雇用/消費者/構造の3軸評価 |
| `GET /v1/economy/phase` | 景気フェーズ (EXPANSION→CRISIS) | 5段階Phase判定 |

#### Tier 2: 分析データ（リアルタイム性: 日次〜月次）

| エンドポイント | 内容 | 競合優位性 |
|---------------|------|-----------|
| `GET /v1/liquidity/history` | 流動性スコア履歴 | 長期バックテスト可能 |
| `GET /v1/economy/history` | 景気スコア履歴 | 1999年〜の長期データ |
| `GET /v1/macro/valuation` | CAPE + Buffett Indicator | 加工済みバリュエーション |
| `GET /v1/macro/cross-asset` | Gold比率/DXY/地域別パフォーマンス | クロスアセット分析済み |
| `GET /v1/integrated/state` | State×Phase統合判定 + 投資アドバイス | 全システム統合スコア |

#### Tier 3: AIレポート

| エンドポイント | 内容 | 競合優位性 |
|---------------|------|-----------|
| `GET /v1/report/latest` | 最新AI投資レポート (Markdown) | Claude生成の分析レポート |
| `GET /v1/report/summary` | 3行サマリー（エージェント用） | AI連携に最適化 |

### 5.4 課金モデル案

| プラン | 料金 | API呼び出し | 対象 |
|--------|------|------------|------|
| **Free** | $0 | 100回/日 | 個人開発者、試用 |
| **Developer** | $29/月 | 10,000回/日 | AIエージェント開発者 |
| **Pro** | $99/月 | 100,000回/日 | ファンド、フィンテック |
| **Enterprise** | 要相談 | 無制限 | 機関投資家 |

### 5.5 技術実装

```
外部ユーザー
    ↓ API Key認証 (X-API-Key ヘッダー)
Cloudflare Worker (レート制限 + 認証 + キャッシュ)
    ↓
    ├── キャッシュHIT → 即返却
    ├── CRUD → Worker 内で Supabase 直接
    └── 計算 → Cloud Run (Python) → 返却
```

**認証**: API Key方式（Stripe連携で発行・管理）
**レート制限**: Upstash Redis でカウント（Worker + Cloud Run 両方から参照）
**バージョニング**: `/v1/` プレフィックスで後方互換性担保
**レスポンス形式**: JSON（MCP互換のメタデータ付き）

### 5.6 MCP (Model Context Protocol) サーバーとしての提供

```json
// MCP Tool定義例
{
  "name": "get_market_regime",
  "description": "現在の米国株Market Regime（BULL/WEAKENING/BEAR/RECOVERY）を取得",
  "input_schema": {},
  "output": {
    "regime": "BULL",
    "benchmark_price": 5200.50,
    "benchmark_ema_long": 4980.30,
    "description": "ベンチマーク > 長期EMA & 短期EMA上昇",
    "entry_recommendation": "積極的にエントリー可能"
  }
}
```

Claude Desktop、ChatGPT、Dify等のAIプラットフォームから
直接ツールとして呼び出し可能にする。

### 5.7 差別化ポイント

| 競合 | 提供内容 | 当サービスの優位性 |
|------|---------|-------------------|
| FRED API | 生の経済データ | **加工・スコアリング済み**（判断材料として即使用可能） |
| Alpha Vantage | 株価+テクニカル指標 | **マクロ+流動性+景気の統合分析** |
| Quandl | 金融データセット | **独自の配管3レイヤー分析**は他にない |
| Bloomberg API | 全データ | **無料/低価格**（Bloomberg Terminal は年$24,000） |

### 5.8 実装フェーズ

**Phase 1: 内部API整備**
- 既存エンドポイントを `/v1/` ルーティングで公開用に分離
- API Key認証ミドルウェア追加
- レスポンス形式の統一（エラーハンドリング、ページネーション）
- 工数: 3-5日

**Phase 2: 課金連携**
- Stripe + API Key 発行・管理
- KV でレート制限カウンター
- 開発者ダッシュボード（使用量確認、キー管理）
- 工数: 5-7日

**Phase 3: MCP対応**
- MCP Server as Cloudflare Worker
- ツール定義の公開
- ドキュメント（API Reference）
- 工数: 3-5日

**Phase 4: マーケティング**
- API ドキュメントサイト
- GitHub に MCP Server サンプル公開
- Product Hunt / Hacker News 等での紹介

---

## 5.5 お知らせ・メンテナンス通知機能

### 概要

ユーザー向けにメンテナンス予告やサービス障害情報をバナー表示する。

### 実装案

```
管理者 → Admin ダッシュボード → お知らせ作成
   ↓
Supabase announcements テーブルに保存
   ↓
Worker CRUD エンドポイント追加 (GET /api/announcements)
   ↓
Frontend → ページ上部にバナー表示
```

### DB 設計

```sql
CREATE TABLE announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'info',  -- 'maintenance' / 'info' / 'warning'
  active BOOLEAN NOT NULL DEFAULT true,
  starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ends_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 必要な変更

| ファイル | 変更 |
|---------|------|
| Supabase | `announcements` テーブル作成 |
| `app/worker/src/routes/announcements.ts` | 新規: GET (認証不要、全ユーザーに表示) |
| `app/worker/src/index.ts` | ルーティング追加 |
| `app/frontend/` | バナーコンポーネント追加 (SWR で取得、TTL 5分) |
| `app/admin-frontend/` | お知らせ管理画面追加 (CRUD) |

### 工数

1-2 日（Admin 管理画面含む）

---

## 5.6 インフラ導入ステップ (Step 4〜7)

### 導入順序と依存関係

```
Step 1 ✅ CRUD → Workers
Step 2 ✅ Railway → Cloud Run
Step 3 ✅ Upstash Redis
Step 4    Sentry        ← エラー監視（公開前に必須）
Step 5    Feature Gate  ← per-user 制限 (Redis 基盤済み)
Step 6    PostHog       ← ユーザー行動分析
Step 7    Stripe+Resend ← 収益化 + メール送信
```

### 各サービス概要

| サービス | 役割 | 無料枠 | 超過時の影響 |
|---------|------|--------|------------|
| **Sentry** | エラー監視・通知 | 5,000 イベント/月 | エラー通知が止まるだけ。アプリ動く |
| **PostHog** | ユーザー行動分析 | 100 万イベント/月 | 分析記録が止まるだけ。アプリ動く |
| **Resend** | Auth メール送信 (Supabase Custom SMTP) | 100 通/日 (月 3,000) | **新規登録・パスワードリセットが止まる** |
| **Stripe** | サブスクリプション課金 | 固定費なし (手数料 3.6%) | — |
| **Feature Gate** | Free/Pro プラン制限 | — (自前実装) | — |

### コスト方針

- **全サービス Free プランで開始**（自動課金 ON にしない）
- 超過するとサービスが止まるが、**Resend 以外はアプリに影響なし**
- Resend が上限に達する頃にはユーザー十分 → $20/月で解決
- Google OAuth ログインなら確認メール不要 → Resend 負荷軽減

---

## 6. 全体優先度マトリクス

### Tier 1: すぐやれる＆効果大（1-2週間）

| # | 項目 | 工数 | 理由 |
|---|------|------|------|
| 1 | DXY vs S&P500 チャート（データ既存） | 1日 | マクロ検証タブの足がかり |
| 2 | Gold/ETFデータのバッチ追加 | 1日 | 以降の全分析の基盤 |
| 3 | S&P500/Gold比率 + 地域別比較チャート | 2日 | クロスアセット分析の核 |
| 4 | ダッシュボードにマーケットサマリーカード | 1日 | 即効性のあるUI改善 |
| 5 | Slack/LINE通知（基本版） | 2日 | 日常利用の利便性 |

### Tier 2: データ追加が必要（2-4週間）

| # | 項目 | 工数 | 理由 |
|---|------|------|------|
| 6 | Shiller CAPE取得 + バリュエーション分析 | 3-4日 | 長期投資判断の核心 |
| 7 | CAPE vs 将来リターン散布図 | 3-4日 | 「今のCAPEだと将来は…」の説得力 |
| 8 | Buffett Indicator | 1日 | CAPEと並ぶバリュエーション指標 |
| 9 | 景気タブにNBER景気後退期オーバーレイ | 1日 | 歴史的文脈の可視化 |
| 10 | 保有タブにベンチマーク比較 | 2日 | ポートフォリオ評価 |

### Tier 3: AI連携＆高度な分析（1-2ヶ月）

| # | 項目 | 工数 | 理由 |
|---|------|------|------|
| 11 | AI投資レポート自動生成（基本版） | 2-3日 | 全データ統合の集大成 |
| 12 | セクターローテーション分析 | 3-4日 | 銘柄選定の精度向上 |
| 13 | エントリー確信度スコア | 3日 | シグナルの定量的評価 |
| 14 | リバランス提案 | 3日 | ポートフォリオ管理の自動化 |
| 15 | フェーズ遷移確率 | 4日 | 統計的な予測 |

### Tier 4: 商用化・収益化

| # | 項目 | 工数 | 備考 |
|---|------|------|------|
| 16 | **公開API（/v1/）+ API Key認証** | 3-5日 | AIエージェント時代の収益源 |
| 17 | **MCP Server 対応** | 3-5日 | Claude/ChatGPT等から直接ツール呼び出し |
| 18 | Stripe課金連携（API + SaaS） | 5-7日 | API Key発行・使用量課金 |
| 19 | モバイル対応 | 5-7日 | ユーザー増加時 |
| 20 | データエクスポート（CSV/PDF） | 2-3日 | 有料機能候補 |
| 21 | 税金計算 | 3-5日 | 確定申告対応 |

---

## 6. 技術的な考慮事項

### 6.1 新規バッチデータの追加パターン

> **注意**: バッチ処理は Python + yfinance を維持（Go に移行しない）。
> yfinance の安定性・拡張性（crumb 認証、レート制限、OSS コミュニティによるエンドポイント追従）を活用する。

```python
# app/batch/fetchers/macro_fetcher.py (Python + yfinance)
import yfinance as yf

def fetch_macro_etfs():
    """マクロ検証用 ETF データを yfinance で一括取得"""
    tickers = ["GC=F", "VT", "VXUS", "VWO", "VGK", "EWJ"]
    data = yf.download(tickers, period="1y", interval="1d")
    # market_indicators テーブルの対応カラムに upsert
    return data
```

### 6.2 散布図コンポーネント

Canvas ベースの散布図コンポーネントが必要（EconChartCanvas は時系列専用）。
`ScatterChartCanvas.tsx` を新規作成し、以下をサポート:
- X軸: CAPE値、Y軸: 将来リターン
- ドットのホバーで年月表示
- 「現在のCAPE」を赤マーカーで強調
- 回帰直線（オプション）

### 6.3 Claude API連携

```python
# Cloud Run (Python) でのレポート生成イメージ
# anthropic SDK を使用
import anthropic

async def generate_report() -> dict:
    client = anthropic.Anthropic()
    # 全データ収集 → プロンプト構築 → レポート生成
    # → ai_reports テーブルに保存
    return report
```

### 6.4 キャッシュ戦略

| キャッシュ層 | 技術 | 用途 | TTL |
|------------|------|------|-----|
| L1: エッジ | Workers Cache API | 全ユーザー共通レスポンス | エンドポイント別 (5分〜24時間) |
| L2: アプリ | Upstash Redis | stock_cache、レート制限、使用量カウント | キー別に設定 |
| L3: DB | Supabase (precomputed_results) | バッチ計算結果 | 24 時間 |

新エンドポイントは全て日次バッチデータなので Workers Cache TTL = 24時間。
ウォームアップリストにも追加。

---

## 7. 参考情報

### 無料データソース

| データ | ソース | URL |
|--------|--------|-----|
| Shiller CAPE | Robert Shiller | http://www.econ.yale.edu/~shiller/data.htm |
| Shiller CAPE (API) | multpl.com | https://www.multpl.com/shiller-pe/table/by-month |
| Buffett Indicator | FRED | `WILL5000IND` / `GDP` |
| Gold | Yahoo Finance | `GC=F` |
| ETF (VT等) | Yahoo Finance | yfinance ライブラリ |
| NBER景気後退期 | FRED | `USREC` (0/1フラグ) |

### 関連既存ファイル

| ファイル | 関連 |
|---------|------|
| `app/batch/run.py` | バッチにデータ取得追加（Python + yfinance 維持） |
| `app/batch/fetchers/yahoo_fetcher.py` | Yahoo Finance 取得（yfinance 維持、Go 移行しない） |
| `app/worker/src/cache-config.ts` | 新エンドポイントのTTL追加 |
| `app/worker/src/index.ts` | CRUD エンドポイント追加先 |
| `app/frontend/src/components/charts/EconChartCanvas.tsx` | チャートコンポーネント拡張 |
| `tasks/saas-considerations.md` | SaaS化の包括的検討 |
| `tasks/architecture-decisions.md` | アーキテクチャ決定事項 (2026-03-01) |
