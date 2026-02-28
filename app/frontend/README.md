# Open Regime フロントエンド

Next.js 15 + TypeScript + Tailwind CSS で構築されたトレーディングダッシュボード。

## 技術スタック

- **Framework**: Next.js 15 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS 4 + shadcn/ui
- **Charts**: Recharts
- **Deploy**: Cloudflare Pages (静的エクスポート)

## ページ構成

| ページ | パス | 説明 |
|--------|------|------|
| 統合 | `/` | マーケット状態・レジーム・流動性概要 |
| 配管 | `/liquidity` | FRBバランスシート・金利・クレジットスプレッド |
| 米国景気 | `/employment` | 雇用統計・経済指標 |
| シグナル | `/signals` | V10エントリーシグナル分析 |
| 保有 | `/holdings` | ポートフォリオ・取引履歴 |

## 開発

```bash
# 依存関係インストール
npm install

# 開発サーバー起動
npm run dev

# ビルド
npm run build
```

## Cloudflare Pages デプロイ

### 方法1: Cloudflare Dashboard から

1. [Cloudflare Pages](https://pages.cloudflare.com/) にログイン
2. 「Create a project」→「Connect to Git」
3. リポジトリを選択
4. ビルド設定:
   - **Framework preset**: Next.js (Static HTML Export)
   - **Build command**: `cd app/frontend && npm install && npm run build`
   - **Build output directory**: `app/frontend/out`
5. 環境変数を設定:
   - `NEXT_PUBLIC_API_URL`: `https://empathetic-hope-production.up.railway.app`
6. 「Save and Deploy」

### 方法2: Wrangler CLI から

```bash
# Wrangler インストール
npm install -g wrangler

# ログイン
wrangler login

# デプロイ
cd app/frontend
npm run build
wrangler pages deploy out --project-name=open-regime
```

## 環境変数

| 変数 | 説明 | デフォルト |
|------|------|----------|
| `NEXT_PUBLIC_API_URL` | バックエンドAPI URL | `https://empathetic-hope-production.up.railway.app` |

## API連携

バックエンド（Railway）の19+ APIエンドポイントと連携:

- `/api/stocks` - 銘柄マスター
- `/api/signal/{ticker}` - V10シグナル分析
- `/api/regime` - Market Regime
- `/api/market-state` - マーケット状態
- `/api/liquidity/*` - 流動性データ
- `/api/employment/*` - 雇用統計
- `/api/holdings` - 保有銘柄
- `/api/trades` - 取引履歴
