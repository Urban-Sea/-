# Cloud Run 移行 TODO (Step 2)

## Phase 0: GCP セットアップ（手動）

- [ ] GCP プロジェクト作成（プロジェクト ID をメモ）
- [ ] API 有効化: Cloud Run Admin, Artifact Registry, IAM Credentials
- [ ] Artifact Registry リポジトリ作成 (us-east1, Docker, `open-regime`)
- [ ] Workload Identity Federation 設定（下記コマンド参照）
- [ ] GitHub Secrets 登録: `GCP_PROJECT_ID`, `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_SERVICE_ACCOUNT`

### WIF セットアップコマンド

```bash
PROJECT_ID=<your-project-id>
PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')
REPO=<github-user>/<github-repo>

# WIF プール
gcloud iam workload-identity-pools create "github" \
  --project=$PROJECT_ID \
  --location="global" \
  --display-name="GitHub Actions"

# OIDC プロバイダー
gcloud iam workload-identity-pools providers create-oidc "github-actions" \
  --project=$PROJECT_ID \
  --location="global" \
  --workload-identity-pool="github" \
  --display-name="GitHub Actions" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --issuer-uri="https://token.actions.githubusercontent.com"

# サービスアカウント
gcloud iam service-accounts create github-actions-deployer \
  --project=$PROJECT_ID \
  --display-name="GitHub Actions Deployer"

# ロール付与
for ROLE in roles/run.admin roles/artifactregistry.writer roles/iam.serviceAccountUser; do
  gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:github-actions-deployer@${PROJECT_ID}.iam.gserviceaccount.com" \
    --role="$ROLE"
done

# WIF ↔ SA バインディング
gcloud iam service-accounts add-iam-policy-binding \
  github-actions-deployer@${PROJECT_ID}.iam.gserviceaccount.com \
  --project=$PROJECT_ID \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github/attribute.repository/${REPO}"
```

### GitHub Secrets に登録する値

| Secret 名 | 値 |
|-----------|-----|
| `GCP_PROJECT_ID` | プロジェクト ID |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | `projects/<PROJECT_NUMBER>/locations/global/workloadIdentityPools/github/providers/github-actions` |
| `GCP_SERVICE_ACCOUNT` | `github-actions-deployer@<PROJECT_ID>.iam.gserviceaccount.com` |

## Phase 1: コード変更（完了済み）

- [x] Dockerfile — Cloud Run PORT 対応
- [x] .dockerignore 新規作成
- [x] auth.py — レガシー X-User-Email パス削除
- [x] main.py — CORS allow_headers から X-User-Email 削除
- [x] proxy.ts — X-User-Email 転送削除
- [x] cors.ts — Allow-Headers から X-User-Email 削除
- [x] railway.json 削除
- [x] deploy.yml — Backend デプロイジョブ追加 (WIF)

## Phase 2: 初回デプロイ & 切り替え

- [ ] Phase 0 完了後にコミット → main にプッシュ → CI が Cloud Run にデプロイ
- [ ] Cloud Run 環境変数を手動設定:
  ```bash
  gcloud run services update open-regime-backend \
    --region us-east1 \
    --set-env-vars \
      PROXY_SECRET=<Worker と同じ値>,\
      SUPABASE_URL=<Supabase URL>,\
      SUPABASE_KEY=<service_role key>,\
      SUPABASE_JWT_SECRET=<JWT secret>,\
      ADMIN_EMAILS=<管理者メール>,\
      MFA_ENCRYPTION_KEY=<MFA暗号化キー>
  ```
- [ ] Cloud Run 直接テスト: `curl https://<url>/health`
- [ ] wrangler.jsonc の ORIGIN を Cloud Run URL に変更 → プッシュ
- [ ] スモークテスト（regime, signal/SPY, stock/SPY, liquidity/overview, employment/risk-score）
- [ ] 1 週間問題なければ Railway 廃止

## Phase 3: クリーンアップ（1 週間後）

- [ ] CRUD ルーター削除（holdings, trades, watchlist, users, admin, admin_mfa）
- [ ] main.py から該当 include_router 行を削除
- [ ] requirements.txt から pyotp, qrcode[pil] 削除
- [ ] Railway プロジェクト廃止

---

## 残りのセキュリティ TODO

- [ ] Supabase Auth: Leaked Password Protection 有効化（Dashboard → Auth → Settings）
