# VPS 側の適用スクリプト

リポジトリに置いてあるが CI からは実行されない。**VPS 上で手動実行する**もの。

## cf-origin-firewall.sh — オリジン IP 直叩きの遮断

### 何が問題か

`sudo ufw status` を見ると 80/443 は Cloudflare の IP レンジのみに絞られている。
にもかかわらず、外部から

```bash
curl -k https://49.212.164.21 -H 'Host: open-regime.com'   # → 200 が返る
```

が通る (2026-09-06 実測)。**UFW が効いていない**。

理由は Docker。`nginx` の `ports: 80:80 / 443:443` に対して Docker は
`nat PREROUTING` で DNAT を打ち、パケットをコンテナへ **FORWARD** する。
UFW のルールはホストの **INPUT** チェーンに入っているので、
そもそも評価されずに素通りする。

```
$ sudo iptables -S DOCKER-USER
-N DOCKER-USER          # ← 空。何も制限していない
```

結果として Cloudflare の WAF / Rate Limit / Bot 管理 / Geo 制限が
**オリジン IP を知っているだけで全部バイパスできる**状態になっている。

### 何をするか

Docker が FORWARD の先頭で評価する `DOCKER-USER` チェーンに、
CF レンジのみ許可するルールを入れる。

**外向き通信を巻き込まないこと**が肝。`DOCKER-USER` はコンテナの
egress も通るので、`--dports 80,443 -j DROP` を無条件に書くと
batch → R2 / FRED や api-go → Google OAuth が死ぬ。
そのため `-i ens3` (外部 IF) で「外から入ってくる新規接続」だけに限定している。

### 適用手順

```bash
# 0) 手元から転送
scp scripts/vps/cf-origin-firewall.sh scripts/vps/cf-origin-firewall.service open-regime-vps:/tmp/

# 1) 現状バックアップ
ssh open-regime-vps 'sudo iptables-save | sudo tee /root/iptables-backup-$(date +%F-%H%M).rules > /dev/null'

# 2) 設置
ssh open-regime-vps '
  sudo install -m 755 /tmp/cf-origin-firewall.sh /usr/local/sbin/cf-origin-firewall.sh
  sudo install -m 644 /tmp/cf-origin-firewall.service /etc/systemd/system/cf-origin-firewall.service'

# 3) 自動復旧のウォッチドッグを先に仕掛ける (7分以内に確認できなければ元に戻る)
ssh open-regime-vps '
  sudo rm -f /tmp/docker-user-ok
  sudo systemd-run --unit=docker-user-watchdog --on-active=420 \
    /bin/bash -c "[ -f /tmp/docker-user-ok ] || { /usr/sbin/iptables -F DOCKER-USER; logger docker-user-watchdog: reverted; }"'

# 4) 適用
ssh open-regime-vps 'sudo /usr/local/sbin/cf-origin-firewall.sh'

# 5) 検証 — ここで 3 つとも期待通りなら成功
#    a. オリジン直叩きが落ちること (手元から。タイムアウトすれば OK)
curl -k --max-time 10 https://49.212.164.21 -H 'Host: open-regime.com' -o /dev/null -w '%{http_code}\n'
#    b. CF 経由は生きていること (200 であること)
curl -s --max-time 10 https://open-regime.com/ -o /dev/null -w '%{http_code}\n'
#    c. VPS 内のヘルスチェックが通ること (deploy が使う経路)
ssh open-regime-vps 'curl -skf -H "Host: open-regime.com" https://localhost/health && echo OK'

# 6) 問題なければ確定 + 再起動後も効くように有効化
ssh open-regime-vps '
  sudo touch /tmp/docker-user-ok
  sudo systemctl stop docker-user-watchdog.timer 2>/dev/null || true
  sudo systemctl daemon-reload
  sudo systemctl enable cf-origin-firewall.service'

# --- 失敗したとき: 待てば 7 分で自動復旧するが、すぐ戻すなら ---
ssh open-regime-vps 'sudo iptables -F DOCKER-USER'
```

### 併せてやること

Cloudflare ダッシュボードで **Authenticated Origin Pulls (mTLS)** を有効化する。
IP 制限は CF の IP レンジを騙る攻撃 (CF 経由で別ゾーンから叩く) までは防げないため、
オリジン証明書での相互認証を重ねる。
