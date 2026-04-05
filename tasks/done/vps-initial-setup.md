# VPS 初期設定 完了報告

**実施日**: 2026-04-05
**対象**: Sakura VPS 1GB (Ubuntu 24.04)

---

## サーバー情報

| 項目 | 値 |
|------|---|
| プロバイダ | さくらの VPS |
| プラン | 1GB (vCPU 2core, メモリ 1GB, SSD 50GB) |
| 契約 | 年間プラン (10,285円/12ヶ月, お試し期間中) |
| OS | Ubuntu 24.04 LTS (amd64) |
| ゾーン | 大阪第3 |
| ホスト名 | os3-295-37017.vs.sakura.ne.jp |
| IPv4 | 49.212.164.21 |
| IPv6 | 2403:3a00:202:1115:49:212:164:21 |

---

## ユーザー構成

| ユーザー | 用途 | sudo | docker | SSH鍵 |
|---------|------|------|--------|-------|
| root | ログイン禁止 | - | - | - |
| ubuntu | 初期ユーザー (今後は使わない) | あり | - | open-regime-vps |
| ryu | 管理用 (メイン) | あり (NOPASSWD) | あり | open-regime-vps |
| deploy | GH Actions デプロイ用 | なし | あり | open-regime-deploy |

---

## 完了した設定 (実行コマンド詳細)

### 1. SSH 鍵作成 (ローカルで実行)

```bash
# 管理用 (ryu ユーザー向け)
ssh-keygen -t ed25519 -C "open-regime-vps" -f ~/.ssh/open-regime-vps
# → ~/.ssh/open-regime-vps (秘密鍵) と ~/.ssh/open-regime-vps.pub (公開鍵) が生成

# デプロイ用 (deploy ユーザー向け、GH Actions が使う)
ssh-keygen -t ed25519 -C "deploy-open-regime" -f ~/.ssh/open-regime-deploy
# → ~/.ssh/open-regime-deploy (秘密鍵) と ~/.ssh/open-regime-deploy.pub (公開鍵) が生成
```

`open-regime-vps.pub` はさくら VPS 申し込み時にフォームに貼り付けて登録。
パスワード認証は申し込み時に「許可しない」を選択して無効化済み。

### 2. SSH config 設定 (ローカル `~/.ssh/config`)

```bash
# 追加した内容:
Host open-regime-vps
    HostName 49.212.164.21
    User ryu
    IdentityFile ~/.ssh/open-regime-vps

Host open-regime-deploy
    HostName 49.212.164.21
    User deploy
    IdentityFile ~/.ssh/open-regime-deploy
```

接続コマンド:
```bash
ssh open-regime-vps      # → ryu@49.212.164.21
ssh open-regime-deploy   # → deploy@49.212.164.21
```

### 3. ryu ユーザー作成 (ubuntu ユーザーで VPS 上で実行)

```bash
# ユーザー作成 (パスワード設定あり、Full Name 等は空)
sudo adduser ryu
# → info: Adding user `ryu' ...
# → info: Selecting UID/GID from range 1000 to 59999 ...
# → info: Adding new group `ryu' (1001) ...
# → info: Adding new user `ryu' (1001) with group `ryu (1001)' ...
# → パスワード入力 × 2、Full Name 等は空 Enter

# sudo グループに追加 (管理者権限)
sudo usermod -aG sudo ryu

# sudo パスワード不要に設定
echo 'ryu ALL=(ALL) NOPASSWD:ALL' | sudo tee /etc/sudoers.d/ryu
# → /etc/sudoers.d/ryu に書き込まれる
# → 以降 sudo 実行時にパスワード不要

# SSH 鍵をコピー (ubuntu と同じ公開鍵を使う)
sudo mkdir -p /home/ryu/.ssh
sudo cp ~/.ssh/authorized_keys /home/ryu/.ssh/
sudo chown -R ryu:ryu /home/ryu/.ssh
sudo chmod 700 /home/ryu/.ssh       # .ssh ディレクトリは本人のみアクセス可
sudo chmod 600 /home/ryu/.ssh/authorized_keys  # 公開鍵ファイルは本人のみ読み書き可
```

確認:
```bash
sudo whoami  # → root (NOPASSWD 動作確認)
whoami       # → ryu
```

### 4. deploy ユーザー作成 (ryu ユーザーで VPS 上で実行)

```bash
# パスワード無効のユーザーを作成 (SSH 鍵認証のみ、GH Actions 専用)
sudo adduser --disabled-password --gecos "" deploy
# --disabled-password: パスワードログイン不可 (ブルートフォース対策)
# --gecos "": Full Name 等の入力をスキップ

# docker グループに追加 (sudo は付与しない → 権限最小化)
sudo usermod -aG docker deploy

# SSH 鍵を設定 (ローカルの open-regime-deploy.pub の中身を登録)
sudo mkdir -p /home/deploy/.ssh
echo 'ssh-ed25519 AAAA...(公開鍵の中身)... deploy-open-regime' | sudo tee /home/deploy/.ssh/authorized_keys
sudo chown -R deploy:deploy /home/deploy/.ssh
sudo chmod 700 /home/deploy/.ssh
sudo chmod 600 /home/deploy/.ssh/authorized_keys
```

### 5. swap 2GB 作成 (ryu ユーザーで VPS 上で実行)

```bash
# 2GB の swap ファイルを作成
sudo fallocate -l 2G /swapfile
# → /swapfile (2GB) が作成される

# root のみ読み書き可に設定 (セキュリティ)
sudo chmod 600 /swapfile

# swap フォーマット
sudo mkswap /swapfile
# → Setting up swapspace version 1, size = 2 GiB (2147479552 bytes)
# → no label, UUID=58b0d8ba-b2d8-458d-8bdd-67f56420e223

# swap を有効化
sudo swapon /swapfile

# 再起動後も自動で有効になるよう /etc/fstab に追加
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# swappiness を 10 に設定 (SSD なので低めに。デフォルトは 60)
# 低い値 = RAM を優先的に使い、swap はスパイク時のみ使用
sudo sysctl vm.swappiness=10
# → vm.swappiness = 10

# 再起動後も swappiness を維持
echo 'vm.swappiness=10' | sudo tee -a /etc/sysctl.conf
```

### 6. Docker インストール (ryu ユーザーで VPS 上で実行)

```bash
# Docker 公式インストールスクリプトを実行
curl -fsSL https://get.docker.com | sudo sh
# → Docker Engine 29.3.1 (Community) がインストールされる
# → Docker Compose プラグインも同梱
# → containerd v2.2.2, runc 1.3.4 も含む

# ryu を docker グループに追加 (sudo なしで docker コマンドを実行可能に)
sudo usermod -aG docker ryu
# → 反映にはセッション再接続が必要

# 再接続後の確認
docker --version         # → Docker version 29.3.1
docker compose version   # → Docker Compose version v2.x.x
docker ps                # → 空テーブル (コンテナなし、エラーなければOK)
```

### 7. パケットフィルター (さくらコントロールパネルで設定)

VPS の外側のファイアウォール。CLI 不要、Web UI で設定。

| フィルター名 | プロトコル | ポート | 送信元 |
|-------------|-----------|--------|--------|
| SSH | TCP | 22 | すべて許可 |
| Web | TCP | 80/443 | すべて許可 |

### 8. ufw ファイアウォール (ryu ユーザーで VPS 上で実行)

さくらのパケットフィルター (VPS 外側) に加え、OS レベルでも二重防御。

```bash
# デフォルトポリシー: 受信は全拒否、送信は全許可
sudo ufw default deny incoming
# → Default incoming policy changed to 'deny'

sudo ufw default allow outgoing
# → Default outgoing policy changed to 'allow'

# 許可するポートを個別に開放
sudo ufw allow 22/tcp    # SSH (これがないとログインできなくなる)
# → Rules updated / Rules updated (v6)

sudo ufw allow 80/tcp    # HTTP (Cloudflare からのアクセス)
# → Rules updated / Rules updated (v6)

sudo ufw allow 443/tcp   # HTTPS (Cloudflare からのアクセス)
# → Rules updated / Rules updated (v6)

# ファイアウォール有効化
sudo ufw enable
# → Command may disrupt existing ssh connections. Proceed with operation (y|n)? y
# → Firewall is active and enabled on system startup
# ※ 22/tcp を許可済みなので SSH は切断されない

# 確認
sudo ufw status
# → Status: active
# → 22/tcp ALLOW Anywhere
# → 80/tcp ALLOW Anywhere
# → 443/tcp ALLOW Anywhere
```

---

## 未完了

| 項目 | 備考 |
|------|------|
| Docker イメージデプロイ | docker-compose.prod.yml + GH Actions 作成後 |
| データ移行 | Supabase → VPS PostgreSQL |
| DNS 切替 | Cloudflare A レコード → 49.212.164.21 |

---

## ローカル SSH 接続方法

```bash
# 管理用 (ryu)
ssh open-regime-vps

# デプロイ確認 (deploy)
ssh open-regime-deploy
```
