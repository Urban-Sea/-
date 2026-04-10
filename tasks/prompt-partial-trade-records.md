# タスク: partial exit の残り半分を trade_results に記録する

## 背景

V13 の exit 判定ロジックには「半分売却 (partial exit)」の仕組みがある。

**② 弱気転換ルール**:
1. CHoCH (弱気転換) を検出 → **50% 売却** (`Mirror_Partial`)
2. その後 EMA デスクロスが来たら → **残り 50% も売却** (`Mirror_Full`)

現在の問題: **ステップ 1 の trade_results しか記録されない**。ステップ 2 で残り 50% が売却されたとき、`trade_results` に 2 件目のレコードが生成されない。`live_exit_statuses` の `trade_completed=True` で「最終的に全部手じまいされた」ことだけわかるが、**いつ・いくらで残りが売られたか**が不明。

### 実データの例 (GOOGL)

```
trade_results:
  entry=2025-07-24 exit=2025-09-25 reason=Trail_Stop(partial) return=+15.0%
  → これしかない。残り 50% の trade record がない

live_exit_statuses:
  entry=2025-07-24 trade_completed=True unrealized_pct=+66.1%
  → 最終的に +66.1% で手じまいされたことはわかるが、exit_date / exit_price が不明
```

### フロントエンドへの影響

`app/frontend/src/app/signals/page.tsx` の「過去のポジション」タブでは、同じ `entry_date` の trade を partial + full でグルーピングして 1 カードにまとめるロジックが入っている (commit `01f31d9`)。

```tsx
// entry_date でグルーピング
const tradesByEntry = new Map<string, typeof trades>();
trades.forEach(t => { ... });
// partial が先、full が後を 1 カードにまとめる
const partialTrade = sorted.find(t => isPartial(t.exit_reason));
const fullTrade = sorted.find(t => !isPartial(t.exit_reason));
```

full の trade record が存在しないため、partial のみの場合は「③ 利確ストップ (50% 売却)」と表示して 50% 売却行を省略している。full が追加されれば「② 弱気転換 → ③ 利確ストップ」のように正しく表示される。

---

## やるべきこと

### 1. exit 判定ロジックの場所を特定

`app/backend` (Python, FastAPI) の中にある exit 判定コード。おそらく以下のいずれか:
- `app/backend/services/` 以下
- `app/backend/routes/signal.py` の `/api/signal/{ticker}/history` エンドポイント
- バッチ処理 (`app/batch/`)

`trade_results` を生成しているコードを探すこと。`Trail_Stop(partial)` / `Mirror_Partial` / `ATR_Floor(partial)` 等の文字列を grep すれば見つかる。

### 2. partial exit 後の残り 50% の決済を trade_results に追記

partial exit が発生した後、残り 50% が以下のいずれかで決済されたとき:
- ① ATR Floor (損切)
- ② EMA Death Cross (反転全決済)
- ③ Trail Stop (利確)
- ④ Time Stop (保有期限)

→ **2 件目の trade record** を `trade_results` に追加する:
```python
{
    "entry_date": "2025-07-24",       # 元の買付日 (1件目と同じ)
    "exit_date": "2025-12-15",        # 残り半分が決済された日
    "entry_price": 191.74,            # 元の買値 (1件目と同じ)
    "exit_price": 285.30,             # 残り半分の決済価格
    "return_pct": 48.8,               # 残り半分の損益%
    "holding_days": 144,              # 買付日からの日数
    "exit_reason": "Trail_Stop"       # ← (partial) なし = full exit
}
```

### 3. テスト

- GOOGL で `partial` のある 4 件のポジションについて、2 件目の trade record が生成されることを確認
- `entry_date` が同じで `exit_reason` に `(partial)` がないレコードが追加されること
- フロントの「過去のポジション」タブで「② 弱気転換 → ③ 利確ストップ」のように表示されること

---

## 読むべきファイル

### 必読
| ファイル | 内容 |
|---|---|
| `tasks/handoff-design-redesign-2026-04-09.md` | デザイン改善の引き継ぎ書 (読む順序も書いてある) |
| `tasks/lessons.md` | 教訓集 |
| `app/frontend/src/app/signals/page.tsx` L1469-1510 | フロント側の partial + full グルーピングロジック |

### 調査対象
| ファイル | 内容 |
|---|---|
| `app/backend/` | Python バックエンド全体 |
| `grep -r "trade_results\|Trail_Stop\|partial" app/backend/` | trade_results 生成コードを特定 |
| `grep -r "Mirror_Partial\|ATR_Floor" app/backend/` | exit reason 定義箇所 |

### 参考
| ファイル | 内容 |
|---|---|
| `docs/sp500_v13_backtest_2026-04-09.md` | V13 バックテスト結果 (exit ロジックの仕様記述あり) |

---

## 制約

- バックエンドの exit 判定ロジックの**構造を変えない** (partial → full の 2 段階 exit は維持)
- `trade_results` の**既存フィールド**は変えない (新しいレコードを追加するだけ)
- `(partial)` 付きの exit_reason は既存通り。full の方は `(partial)` なしで記録
- commit 前に必ず `npm run build` (フロント) + バックエンドのテストを実行
- Notion は使わない (会社のワークスペースなので)
