# Phase 5 #20: deploy-vps.yml 作成タスク

## やること

`.github/workflows/deploy-vps.yml` を新規作成する。SCP 方式で Docker イメージを VPS にデプロイする GitHub Actions ワークフロー。

**コードを書く前にまず計画を立てて、計画だけ返してください。実装はしないでください。**

---

## 前提情報

### VPS 情報
- Sakura VPS 1GB (Ubuntu 24.04, IP: 49.212.164.21)
- ユーザー: `deploy` (docker グループ、sudo なし)
- SSH 鍵: GH Actions Secret `VPS_SSH_KEY` に秘密鍵を登録予定
- デプロイ先: `/opt/open-regime/`
- Docker + Docker Compose インストール済み

### デプロイ方式: SCP (mansion プロジェクトと同じ)

```
GitHub Actions Runner              VPS (Sakura)
┌─────────────────┐               ┌──────────────────────┐
│ docker build    │               │ images/ (受け渡し)    │
│       ↓         │               │       ↓               │
│ docker save     │    SCP        │ gunzip -c |           │
│   | gzip        │ ──────────→   │   docker load         │
│       ↓         │               │       ↓               │
│ xxx.tar.gz      │               │ docker compose up -d  │
└─────────────────┘               │       ↓               │
                                  │ ヘルスチェック         │
                                  │       ↓               │
                                  │ rm -f images/*.tar.gz │
                                  └──────────────────────┘
```

### ビルド対象 (5 カスタムイメージ)

| イメージ名 | ビルドコンテキスト | Dockerfile | paths トリガー |
|-----------|-----------------|------------|--------------|
| `open-regime-api-python` | `./app/backend` | `./app/backend/Dockerfile` | `app/backend/**` |
| `open-regime-api-go` | `./api-go` | `./api-go/Dockerfile` | `api-go/**` |
| `open-regime-frontend` | `./app/frontend` | `./app/frontend/Dockerfile` | `app/frontend/**` |
| `open-regime-admin` | `./app/admin-frontend` | `./app/admin-frontend/Dockerfile` | `app/admin-frontend/**` |
| `open-regime-batch` | `.` (リポジトリルート) | `./app/batch/Dockerfile` | `app/batch/**`, `app/backend/analysis/**` |

公式イメージ (postgres:16-alpine, redis:7-alpine, nginx:alpine) はビルド不要。

### VPS のディレクトリ構造

```
/opt/open-regime/
├── docker-compose.prod.yml    ← SCP で転送
├── .env                       ← 手動作成済み (Secret)
├── nginx/                     ← SCP で転送
│   ├── nginx.conf
│   └── conf.d/default.prod.conf.template
├── db/init/01_schema.sql      ← SCP で転送
├── scripts/r2-backup.sh       ← SCP で転送
├── images/                    ← tar.gz の一時受け渡し (デプロイ後削除)
├── logs/
└── backup/
```

### ワークフロー設計要件

1. **トリガー**: `push to main` (paths フィルター) + `workflow_dispatch` (手動)
2. **detect-changes**: `dorny/paths-filter@v3` で変更検知

```yaml
filters: |
  api-python:
    - 'app/backend/**'
  api-go:
    - 'api-go/**'
  frontend:
    - 'app/frontend/**'
  admin:
    - 'app/admin-frontend/**'
  batch:
    - 'app/batch/**'
    - 'app/backend/analysis/**'
  infra:
    - 'docker-compose.prod.yml'
    - 'nginx/**'
    - 'db/**'
    - 'scripts/**'
```

3. **ビルドジョブ**: 変更があったイメージのみ並列ビルド
   - `docker build -t open-regime-xxx:latest`
   - `docker save open-regime-xxx:latest | gzip > open-regime-xxx.tar.gz`
   - `actions/upload-artifact@v4` でアーティファクト保存

4. **deploy ジョブ**: 全ビルド完了後 OR infra 変更時に実行
   - 実行条件: いずれかのビルドが実行された OR infra == 'true'
   - `actions/download-artifact@v4` で全 tar.gz をダウンロード
   - SCP: インフラファイル (docker-compose.prod.yml, nginx/, db/, scripts/) を VPS に転送
   - SCP: tar.gz を VPS:/opt/open-regime/images/ に転送
   - SSH (`appleboy/ssh-action@v1`) で VPS 上で:
     - 旧イメージ ID を保存 (ロールバック用)
     - `gunzip -c images/xxx.tar.gz | docker load` (各イメージ)
     - `docker compose -f docker-compose.prod.yml up -d --remove-orphans`
     - 10秒待機 → ヘルスチェック (`curl -sf http://localhost/health`)
     - **失敗時**: 旧イメージにタグ復元 → compose up (自動ロールバック)
     - **成功時**: `rm -f images/*.tar.gz` + `docker image prune -f`

5. **GH Actions Secrets**:
   - `VPS_HOST`: `49.212.164.21`
   - `VPS_USER`: `deploy`
   - `VPS_SSH_KEY`: deploy ユーザーの SSH 秘密鍵

6. **既存ワークフロー**: `.github/workflows/deploy.yml` (CF Workers/Pages/Cloud Run 用) は変更しない。旧サービス廃止まで維持。

### 参考: 既存ファイル

計画を立てるために以下のファイルを読んでください:
- `.github/workflows/deploy.yml` — 既存のデプロイワークフロー (CF/Cloud Run 用)
- `docker-compose.prod.yml` — #19 で作成済みの本番 compose
- `nginx/conf.d/default.prod.conf.template` — #19 で作成済みの本番 nginx テンプレート
- `app/backend/Dockerfile`, `api-go/Dockerfile`, `app/frontend/Dockerfile`, `app/admin-frontend/Dockerfile`, `app/batch/Dockerfile` — 各 Dockerfile

### 注意点

- `workflow_dispatch` (手動実行) の場合は paths-filter をスキップして全イメージをビルドする
- `docker-compose.prod.yml` だけ変更した場合 (infra のみ) はビルドなしで deploy ジョブだけ走る
- 初回デプロイ時はロールバック不可 (旧イメージがない) → エラーハンドリングが必要
- nginx は envsubst で起動するため、nginx コンテナ自体のビルドは不要 (公式イメージのまま)
