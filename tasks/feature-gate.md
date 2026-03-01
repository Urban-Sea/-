# Feature Gate 設計 (Step 5)

> 作成日: 2026-03-01
> ステータス: 設計確定、実装未着手

---

## 1. プラン定義

| プラン | 料金 | 対象 |
|--------|------|------|
| **Free** | $0 | 全ユーザー（デフォルト） |
| **Pro** | 未定 | 有料ユーザー（Stripe 連携） |

---

## 2. 機能制限一覧

### 2.1 ポートフォリオ・資産管理

| 機能 | Free | Pro |
|------|------|-----|
| ポートフォリオ銘柄数 | 10 まで | 無制限 |
| 現金口座 | 1 つまで | 無制限 |

### 2.2 銘柄分析

| 機能 | Free | Pro |
|------|------|-----|
| シグナル分析（個別銘柄） | 1日10回まで | 無制限 |
| バッチ分析（Quick） | JP 5 + US 5 = 10銘柄まで | 無制限 |
| 運用モード | balanced 固定 | aggressive / balanced / conservative 選択可 |

### 2.3 保有分析（Exit）

| 機能 | Free | Pro |
|------|------|-----|
| エントリー判定 | 利用可 | 利用可 |
| 今日の Exit 分析（新機能） | 利用可 | 利用可 |
| 長期保有分析 | 不可 | 利用可 |

### 2.4 マクロ・AI

| 機能 | Free | Pro |
|------|------|-----|
| ダッシュボード | 利用可 | 利用可 |
| 配管タブ | 利用可 | 利用可 |
| 景気タブ | 利用可 | 利用可 |
| マクロ検証タブ（新機能） | 不可 | 利用可 |
| AI レポート（新機能） | 不可 | 1日1回まで |

### 2.5 外部 API

| 機能 | Free | Pro |
|------|------|-----|
| 公開 API | — | 別課金体系 |

---

## 3. 制限の実装方針

### 3.1 回数制限（Redis ベース）

シグナル分析・AI レポートの日次回数制限は Upstash Redis で管理。

```
キーパターン: gate:{user_id}:{feature}:{date}
例: gate:abc123:signal:2026-03-01
TTL: 86400s (24時間)
```

| 制限対象 | Redis キー | Free 上限 |
|---------|-----------|----------|
| シグナル分析 | `gate:{uid}:signal:{date}` | 10 |
| AI レポート | `gate:{uid}:ai_report:{date}` | 0 (Pro: 1) |

### 3.2 数量制限（DB ベース）

ポートフォリオ・現金口座の上限は `users.plan` を見て Worker/Backend 側で INSERT 前にチェック。

```typescript
// Worker: holdings 作成時
const count = await supabase.table('holdings').select('id').eq('user_id', uid);
if (user.plan === 'free' && count.length >= 10) {
  return jsonResponse({ error: 'Free plan limit: 10 holdings' }, 403);
}
```

### 3.3 機能ブロック（フロントエンド + API 両方）

Pro 限定機能はフロントエンドで UI を非表示/ロック + API 側でも 403 を返す二重チェック。

```typescript
// フロントエンド: Pro 限定機能のロック表示
if (user.plan === 'free') {
  return <UpgradePrompt feature="マクロ検証" />;
}
```

```typescript
// API: Pro 限定エンドポイント
if (user.plan === 'free') {
  return jsonResponse({ error: 'Pro plan required' }, 403);
}
```

---

## 4. 新機能メモ

### 4.1 今日の Exit 分析（新規開発）

現在の Exit 分析（`/api/exit/{ticker}`）はエントリー価格ベースの損益分析。
「今日の Exit 分析」は保有銘柄に対して「今日売るべきか」を判定する新機能。

- テクニカル指標（EMA/RSI/BOS/CHoCH）の売りシグナル検知
- 保有期間・損益率を考慮した総合判定
- Free/Pro 両方で利用可（長期保有分析のみ Pro）

### 4.2 マクロ検証タブ

`tasks/future-roadmap.md` セクション 1 参照。
クロスアセット比較・バリュエーション分析・将来リターン検証。

### 4.3 AI レポート

`tasks/future-roadmap.md` セクション 2 参照。
Claude API で週次投資戦略レポートを自動生成。

---

## 5. 実装 TODO

- [ ] `users.plan` カラム確認（既存: free / pro_trial / pro / demo）
- [ ] Worker: 回数制限ミドルウェア追加（Redis INCR）
- [ ] Worker: 数量制限チェック追加（holdings, cash_balances）
- [ ] Worker: Pro 限定エンドポイント制限追加
- [ ] Frontend: `useMe()` で plan 取得 → 制限 UI 表示
- [ ] Frontend: `<UpgradePrompt>` コンポーネント作成
- [ ] Frontend: 運用モードセレクタの Free 制限
- [ ] Admin: ユーザーの plan 変更機能（既存）
- [ ] テスト: Free/Pro 両プランでの動作確認

---

## 6. 依存関係

| 依存 | 状態 |
|------|------|
| Upstash Redis | ✅ 導入済み（回数制限に使用） |
| `users.plan` カラム | ✅ 既存（free/pro_trial/pro/demo） |
| Admin Feature Flags テーブル | ✅ 既存（緊急時の機能 ON/OFF に使用） |
| Stripe（課金） | ❌ Step 7 で導入（それまでは Admin で手動 plan 変更） |
