# Phase 6: ログ収集 + R2 バックアップ + cron — VPS 側手順書

承認済み計画: `.claude/plans/distributed-wibbling-oasis.md`

## 1. Cloudflare R2 セットアップ (Dashboard, ユーザー作業)

1. R2 バケット作成: `open-regime-backup`
2. R2 API トークン発行 (Read & Write)
3. 取得した値を控える: Account ID / Access Key ID / Secret Access Key

## 2. VPS: ログディレクトリ作成 (ryu)

```bash
ssh open-regime-vps
sudo mkdir -p /var/log/open-regime/{nginx,api-go,api-python,batch}
sudo chown -R 65532:65532 /var/log/open-regime/api-go     # distroless nonroot
sudo chown -R 1000:1000   /var/log/open-regime/api-python /var/log/open-regime/batch
sudo chown -R 101:101     /var/log/open-regime/nginx       # nginx:alpine
sudo chmod 755 /var/log/open-regime
```

## 3. VPS: .env に R2 認証情報を追加 (ryu)

```bash
sudo -u deploy vim /opt/open-regime/.env
```

追加:
```
R2_BUCKET=open-regime-backup
```

(Access Key / Secret は次の rclone.conf に直接書く)

## 4. VPS: rclone.conf 作成 (ryu)

```bash
sudo tee /opt/open-regime/rclone.conf > /dev/null <<'EOF'
[r2]
type = s3
provider = Cloudflare
access_key_id = <R2_ACCESS_KEY_ID>
secret_access_key = <R2_SECRET_ACCESS_KEY>
endpoint = https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com
acl = private
EOF
sudo chown deploy:deploy /opt/open-regime/rclone.conf
sudo chmod 600 /opt/open-regime/rclone.conf
```

## 5. VPS: logrotate 配置 (ryu)

リポジトリ内の `scripts/logrotate-open-regime.conf` をコピー:

```bash
sudo cp /opt/open-regime/scripts/logrotate-open-regime.conf /etc/logrotate.d/open-regime
sudo chmod 644 /etc/logrotate.d/open-regime
sudo logrotate -d /etc/logrotate.d/open-regime   # dry-run 確認
```

## 6. VPS: cron 登録 (deploy)

```bash
ssh open-regime-deploy
crontab -e
```

```crontab
# batch 日次: JST 7:30 = UTC 22:30 (前日)
30 22 * * * cd /opt/open-regime && docker compose -f docker-compose.prod.yml run --rm batch python -m app.batch.run --daily >> /var/log/open-regime/batch/cron.log 2>&1

# batch 週次: 金曜 JST 8:00 = UTC 23:00 (木曜)
0 23 * * 4 cd /opt/open-regime && docker compose -f docker-compose.prod.yml run --rm batch python -m app.batch.run --weekly >> /var/log/open-regime/batch/cron.log 2>&1

# R2 バックアップ日次: JST 9:00 = UTC 00:00 (batch 完了後)
0 0 * * * cd /opt/open-regime && docker compose -f docker-compose.prod.yml run --rm batch bash scripts/r2-backup.sh >> /var/log/open-regime/batch/backup.log 2>&1
```

タイムライン:
```
UTC 22:30 (JST 07:30) → daily batch (~10-30 分)
UTC 23:00 (JST 08:00) → weekly batch (木曜のみ)
UTC 00:00 (JST 09:00) → R2 バックアップ
```

## 7. デプロイ後の動作確認

```bash
# ログファイル生成
ls -la /var/log/open-regime/{nginx,api-go,api-python,batch}/

# JSON 形式チェック
tail -1 /var/log/open-regime/api-go/app.log     | jq .
tail -1 /var/log/open-regime/api-python/app.log | jq .
tail -1 /var/log/open-regime/nginx/access.log   | jq .

# 手動 R2 バックアップテスト
cd /opt/open-regime
docker compose -f docker-compose.prod.yml run --rm batch bash scripts/r2-backup.sh

# R2 にアップロードされたか
docker compose -f docker-compose.prod.yml run --rm batch rclone ls r2:open-regime-backup/ --config /etc/rclone/rclone.conf
```
