# 雇用API パフォーマンス最適化計画

## 現状分析

### `/api/employment/risk-score` (現在 ~3.5秒)

**DBクエリ数: 9回（すべて逐次実行）**

| # | クエリ | テーブル | 行数 | 必要性 |
|---|--------|----------|------|--------|
| 1 | NFP | economic_indicators | 24行 | 必須 |
| 2 | Claims | weekly_claims | 52行 | 必須 |
| 3 | Consumer (W875RX1, UMCSENT, DRCCLACBS, CPILFESL) | economic_indicators | 120行 | 必須 |
| 4 | JOLTS | economic_indicators | 3行 | 必須 |
| 5 | UNEMPLOY | economic_indicators | 3行 | 必須 |
| 6 | market_indicators (K字型用) | market_indicators | **300行** | **最新1行で十分** |
| 7 | ADP (雇用乖離計算内) | manual_inputs | 3行 | 必須 |
| 8 | Challenger (雇用乖離計算内) | manual_inputs | 15行 | 必須 |
| 9 | Truflation (インフレ乖離計算内) | manual_inputs | 1行 | 必須 |

**主なボトルネック:**
- 9回のDBクエリがすべて直列（US East Railway → Supabase 往復 ~300ms/回）
- `market_indicators` が300行取得（K字型は最新1行のRUT/SPXで十分）
- `manual_inputs` が3箇所バラバラに呼ばれる

### `/api/employment/risk-history` (現在 ~4秒)

**DBクエリ: 4回 + ページネーションループ最大12回**

| # | クエリ | 問題点 |
|---|--------|--------|
| 1 | NFP (months+24行) | OK |
| 2 | weekly_claims ページネーション | 1000行ずつwhile loop (全件取得) |
| 3 | consumer系 ページネーション | 1000行ずつwhile loop (全件取得) |
| 4 | market_indicators ページネーション | 1000行ずつwhile loop (全件取得) |

**主なボトルネック:**
- 3つのページネーションループが直列（各2-3往復 × 300ms）
- Sahm値を毎月再計算（O(n)の3ヶ月移動平均を120回）
- 全データをPython側でインデックス化する処理コスト

---

## 最適化プラン

### Phase 1: クエリ統合・削減（工数: 小、効果: 大）

#### 1-1. market_indicators の limit 300 → 2 に削減
```python
# Before (300行、K字型は最新1行だけ使う)
market_result = supabase.table("market_indicators") \
    .select("date,sp500,russell2000") \
    .order("date", desc=True).limit(300).execute()

# After (2行: null safe のため余裕を持つ)
market_result = supabase.table("market_indicators") \
    .select("date,sp500,russell2000") \
    .order("date", desc=True).limit(2).execute()
```
**効果**: データ転送量 99%削減、パース時間短縮

#### 1-2. JOLTS + UNEMPLOY を consumer クエリに統合 (9→7クエリ)
```python
# Before: 3つの別クエリ
consumer_indicators = ["W875RX1", "UMCSENT", "DRCCLACBS", "CPILFESL"]
# + JOLTS単独クエリ
# + UNEMPLOY単独クエリ

# After: 1つのクエリに統合
all_indicators = ["W875RX1", "UMCSENT", "DRCCLACBS", "CPILFESL", "JOLTS", "UNEMPLOY"]
all_result = supabase.table("economic_indicators") \
    .select("*").in_("indicator", all_indicators) \
    .order("reference_period", desc=True).limit(150).execute()
# Python側で振り分け
```
**効果**: DBクエリ 2回削減（-600ms）

#### 1-3. manual_inputs を1回のバッチクエリに統合 (7→5クエリ)
```python
# Before: ADP(3行), Challenger(15行), Truflation(1行) = 3クエリ

# After: 1クエリで全取得
manual_result = supabase.table("manual_inputs") \
    .select("metric,reference_date,value") \
    .in_("metric", ["ADP_CHANGE", "CHALLENGER_CUTS", "TRUFLATION"]) \
    .order("reference_date", desc=True).limit(30).execute()
# Python側で metric ごとに振り分け
```
**効果**: DBクエリ 2回削減（-600ms）

### Phase 2: risk-history のページネーション除去（工数: 小、効果: 大）

#### 2-1. Supabase count + 単一クエリ化
```python
# Before: while loop で1000行ずつ (2-3往復 × 3テーブル)

# After: 必要な期間だけフィルタして1回で取得
start_date = (datetime.now() - timedelta(days=months * 31 + 365)).strftime("%Y-%m-%d")

claims_result = supabase.table("weekly_claims") \
    .select("week_ending,initial_claims,initial_claims_4w_avg") \
    .gte("week_ending", start_date) \
    .order("week_ending", desc=False).limit(1000).execute()
# months=120なら ~600行、1000行上限に収まる
```
**効果**: ページネーション往復3-9回 → 各1回（-900ms〜-2.4s）

#### 2-2. 日付フィルタで取得行数を削減
- `weekly_claims`: 全件 → 過去(months+12ヶ月)分のみ
- `consumer系`: 全件 → 過去(months+12ヶ月)分のみ
- `market_indicators`: 全件 → 過去(months)分のみ

### Phase 3: 並列実行（工数: 中、効果: 中）

#### 3-1. asyncio + ThreadPoolExecutor で並列DB呼び出し
```python
import asyncio
from concurrent.futures import ThreadPoolExecutor

executor = ThreadPoolExecutor(max_workers=5)

async def get_risk_score():
    loop = asyncio.get_event_loop()

    # 5つの独立クエリを並列実行
    nfp_task = loop.run_in_executor(executor, fetch_nfp)
    claims_task = loop.run_in_executor(executor, fetch_claims)
    indicators_task = loop.run_in_executor(executor, fetch_all_indicators)
    market_task = loop.run_in_executor(executor, fetch_market)
    manual_task = loop.run_in_executor(executor, fetch_manual_inputs)

    nfp, claims, indicators, market, manual = await asyncio.gather(
        nfp_task, claims_task, indicators_task, market_task, manual_task
    )
```
**効果**: 5クエリ直列(~1.5s) → 並列(~300ms)

### Phase 4: レスポンスキャッシュ（工数: 小、効果: 大 for repeat）

#### 4-1. インメモリTTLキャッシュ
```python
from functools import lru_cache
from datetime import datetime, timedelta

_risk_score_cache = {"data": None, "expires": None}

async def get_risk_score():
    now = datetime.now()
    if _risk_score_cache["data"] and _risk_score_cache["expires"] > now:
        return _risk_score_cache["data"]

    # ... 計算 ...

    _risk_score_cache["data"] = result
    _risk_score_cache["expires"] = now + timedelta(hours=1)
    return result
```
**効果**: 2回目以降 ~0ms（データは月次更新なので1時間TTLで十分）

---

## 期待効果

### risk-score

| 段階 | クエリ数 | 推定時間 |
|------|---------|---------|
| 現状 | 9回直列 | ~3.5s |
| Phase 1 (統合) | 5回直列 | ~2.0s |
| Phase 3 (並列化) | 5回並列 | ~0.6s |
| Phase 4 (キャッシュ) | 0回 | ~0ms (2回目以降) |

### risk-history

| 段階 | 推定時間 |
|------|---------|
| 現状 | ~4.0s |
| Phase 2 (ページネ除去) | ~1.5s |
| Phase 3 (並列化) | ~0.6s |
| Phase 4 (キャッシュ) | ~0ms (2回目以降) |

---

## 実装優先度

1. **Phase 1 + 2**（統合 + ページネ除去）: 最小工数で最大効果。バグリスク低。
2. **Phase 4**（キャッシュ）: 簡単に追加でき、UX向上が大きい。
3. **Phase 3**（並列化）: 初回アクセスの速度に効く。ThreadPoolExecutor導入が必要。

## 変更対象ファイル
- `app/backend/routers/employment.py` のみ（全Phase）

## 注意事項
- Supabase Python clientは同期ライブラリのため、`asyncio.gather`には`run_in_executor`が必要
- Phase 3の並列化はRailway上でスレッドプール利用するため、メモリ使用量に注意
- キャッシュTTLは1時間で十分（経済指標は月次/週次更新）
- `git push` でRailwayに反映が必要
