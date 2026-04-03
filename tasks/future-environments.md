# 今後の環境構成 (構想メモ)

> 作成日: 2026-04-04
> ステータス: 構想段階 (VPS デプロイ完了後に着手)

---

## 環境一覧

| 環境 | 場所 | リポジトリ | 用途 |
|------|------|----------|------|
| **本番** | VPS-1 (Sakura) | private (今のまま) | 実ユーザー向け。最新ロジック |
| **STG** | VPS-2 (Sakura) | **public** | 就活デモ + 攻撃対象 |
| **ローカル** | Mac Docker | private | 開発・テスト |

"dev" 環境は不要。ソロ開発で、ローカル Docker が dev そのもの。

---

## ネットワーク構成

### 外部通信

```
ブラウザ ──HTTPS──→ Cloudflare Proxy (SSL終端 + CDN)
                        │
                   ──HTTPS:443──→ VPS-1 nginx (本番)   CF Origin Certificate
                   ──HTTPS:443──→ VPS-2 nginx (STG)    CF Origin Certificate
```

- SSL: Cloudflare Origin Certificate (15年有効、更新不要)
- CF SSL/TLS mode: Full (strict)
- certbot 不要

### VPS 内部通信 (Docker network、外部に出ない)

```
nginx ──→ api-go:8080      (TCP)
nginx ──→ api-python:8081  (TCP)
nginx ──→ frontend:3000    (TCP)
api-go ──→ postgres:5432   (TCP)
api-go ──→ redis:6379      (TCP)
```

### VPS からの外部通信 (outbound)

| 通信元 | 通信先 | 用途 |
|--------|--------|------|
| api-python | Yahoo Finance API | yfinance で株価取得 |
| api-python | FRED API | 経済指標取得 |
| api-go | Google OAuth API | トークン交換 + userinfo |
| api-go | Stripe API | 決済処理 |
| api-go | Yahoo Finance (fx) | USD/JPY レート取得 |
| batch | Yahoo Finance + FRED | データ取得 |
| api-go/api-python | Sentry | エラー送信 |

全て HTTPS outbound。ufw は outbound デフォルト許可なので設定不要。

### SIEM 通信 (VPS間)

```
VPS-1 Wazuh Agent ──1514/tcp(暗号化)──→ VPS-2 Wazuh Manager
```

VPS-2 の ufw で VPS-1 の IP からのみ 1514 を許可。

### Firewall (ufw)

```bash
# VPS-1 (本番)
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp      # SSH
ufw allow 443/tcp     # HTTPS (CF → VPS)
# VPS-2 の Wazuh Manager へ agent 通信するだけなので追加ルール不要

# VPS-2 (STG + SIEM)
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp      # SSH
ufw allow 443/tcp     # HTTPS (CF → VPS)
ufw allow from <VPS-1_IP> to any port 1514  # Wazuh Agent
```

### nginx ルーティング (本番・STG 共通)

```
nginx :443 (CF Origin Certificate)
  ├── /api/(signal|regime|exit|stock)  → api-python:8081  (Python 計算)
  ├── /api/*                           → api-go:8080      (Go CRUD)
  ├── /admin/*                         → admin-frontend:3002
  └── /*                               → frontend:3000
```

---

## リポジトリ戦略

**リポジトリ分離** (事故防止のため):

```
github.com/ryu/open-regime          ← private (今のまま)
  └── 最新の計算ロジック (本番用)

github.com/ryu/open-regime-public   ← public (新規作成)
  └── 古い/簡略化した計算ロジック
  └── README に構成図、技術スタック、設計判断
  └── STG にデプロイ
```

ブランチ分離だと `git push` 事故で最新ロジックが公開されるリスクがある。
別リポなら間違えようがない。

---

## SIEM 構成 (Wazuh on VPS-2)

```
VPS-2
├── [docker compose profile: stg]
│   ├── nginx, api-go, api-python, frontend
│   ├── postgres, redis
│   └── wazuh-agent  ← STG コンテナのログを収集
│
└── [docker compose profile: siem]
    ├── wazuh-manager     (ログ分析・検知ルール)
    ├── wazuh-indexer     (OpenSearch、ログ保存)
    └── wazuh-dashboard   (可視化 UI)

VPS-1
└── wazuh-agent  ← 本番ログも収集
```

### 収集するログ

- nginx アクセスログ (攻撃パターン検知)
- api-go アプリログ (認証失敗、エラー)
- PostgreSQL クエリログ (SQLi 検知)
- Docker コンテナログ
- OS syslog (SSH ブルートフォース等)

### 検知ルール例 (就活アピール用)

- SQLi パターン (`UNION SELECT`, `' OR 1=1`) → アラート
- ブルートフォース (5分で10回ログイン失敗) → アラート
- ディレクトリトラバーサル (`../`) → アラート
- 異常な API レート → アラート
- JWT 改ざん試行 → アラート

### リソース要件

- Wazuh all-in-one: ~4GB RAM
- STG Docker stack: ~2-3GB RAM
- VPS-2 は 8GB RAM 以上を推奨

---

## 攻撃 PoC システム (公開リポ)

```
github.com/ryu/open-regime-security  ← public

├── attacks/
│   ├── 01_sqli/           ← SQLi テスト (sqlmap + カスタム)
│   ├── 02_auth_bypass/    ← JWT 改ざん、セッション固定
│   ├── 03_xss/            ← Stored/Reflected XSS
│   ├── 04_idor/           ← 他ユーザーの holdings にアクセス
│   ├── 05_rate_limit/     ← レート制限バイパス
│   ├── 06_ssrf/           ← 内部サービスへのリクエスト
│   └── 07_api_abuse/      ← 大量リクエスト、不正なペイロード
│
├── detection_rules/
│   └── wazuh/             ← カスタム検知ルール XML
│
├── reports/
│   ├── vulnerability_assessment.md
│   └── screenshots/       ← Wazuh ダッシュボードのスクショ
│
└── README.md              ← OWASP Top 10 対応表、実行手順
```

### 就活でのストーリー

1. 自分で投資分析 SaaS を設計・実装 (Python + Go + Next.js + Docker)
2. Docker + VPS で本番運用
3. STG 環境に意図的に古い版を置き、自分で攻撃
4. Wazuh で検知 → ルール作成 → ダッシュボードでレポート
5. 「本番ではこう修正済み」と対比して見せる
6. 攻撃コード + 検知ルール + レポートを全て公開

---

## 優先順序

1. **VPS-1 デプロイ (本番)** ← 2026-04-05 予定
2. 本番安定運用確認 (1-2 週間)
3. Stripe webhook + Admin MFA テスト
4. R2 バックアップ実装
5. public リポ作成 + VPS-2 (STG) 構築
6. Wazuh 導入 + セキュリティ学習開始
7. 攻撃 PoC リポ作成 + 脆弱性レポート

---

## 未決定事項

- VPS-2 のスペック (8GB で STG+SIEM 足りるか、16GB にするか)
- 公開リポの計算ロジックをどの版まで遡るか
- STG の認証 (ダミー ID/PW 固定が楽。Google OAuth は設定が面倒なだけ)
- R2 にログも上げるか (バックアップだけか、SIEM 連携もか)
