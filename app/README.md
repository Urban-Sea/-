# Open Regime

株式シグナル分析・通知システム

## 構成

```
app/
├── docs/                    # ドキュメント
├── scripts/                 # GitHub Actions用Python
│   ├── signal_runner.py     # シグナル計算
│   └── requirements.txt
└── frontend/                # Next.js (Cloudflare Pages)
```

## 技術スタック

- **フロントエンド**: Next.js 15 + TypeScript + Tailwind CSS
- **データベース**: Supabase (PostgreSQL)
- **認証**: Supabase Auth (Google OAuth)
- **ホスティング**: Cloudflare Pages
- **バッチ処理**: GitHub Actions
- **通知**: Slack Webhook

## セットアップ

詳細は [docs/新システム移行_会社版.md](docs/新システム移行_会社版.md) を参照
