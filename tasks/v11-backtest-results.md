# V11 Backtest Results (2026-03-21)

## Summary

V11 Signal System adds SMC/ICT concepts to the existing V10 entry system.
All changes are **size adjustment only** — `entry_allowed` gate is unchanged.

## Variants Tested

| Variant | Description |
|---------|-------------|
| V10 | Baseline: CHoCH翌日close Entry |
| V11a | V10 Entry + BOS Confidence size adjustment |
| V11b | OTE zone Entry + BOS Confidence |

## Results (2019-01 ~ 2026-03, 23 tickers, 532 trades)

| Variant | n | avg% | med% | win% | PF |
|---------|---|------|------|------|-----|
| V10 (baseline) | 532 | 19.77 | 1.26 | 54.1 | 5.73 |
| V11a (BOS conf.) | 532 | 19.77 | 1.26 | 54.1 | 5.73 |
| V11b (OTE+conf.) | 532 | 9.79 | -1.13 | 45.1 | 2.89 |

### V11a Size-Weighted Metrics
- avg weighted return: **14.15%**
- weighted PF: **5.65**
- avg confidence: **0.70**

### BOS Grade Distribution
| Grade | n | avg% | win% | avg_conf |
|-------|---|------|------|----------|
| REVERSAL | 259 | 22.32 | 50.6 | 0.95 |
| NONE | 273 | 17.35 | 57.5 | 0.45 |
| EXTENSION | 0 | - | - | - |
| CONTINUATION | 0 | - | - | - |

## Key Decisions

### NONE Grade Confidence Fix (2026-03-21)
- **Before**: GRADE_SCORE[NONE]=0.4, recency=0.5 → confidence=0.20
- **After**: GRADE_SCORE[NONE]=0.9, recency=0.5 → confidence=0.45
- **Rationale**: NONE trades have 57.5% win rate and +17.35% avg return. 0.20 was severely over-penalizing.
- **Impact**: avg weighted return 11.29% → 14.15%

### V11b (OTE Entry) — DISPLAY ONLY
- OTE entry is **harmful** on daily timeframe: avg drops 19.77% → 9.79%, win% drops 54.1% → 45.1%
- Root cause: OTE zones too wide (96.6% usage), lower entry → tighter ATR floor → more hard stops
- **Decision**: OTE/OB are chart markers for information display only, not used for entry modification

### CONTINUATION Grade Absence
- 0 trades classified as CONTINUATION
- REVERSAL catches everything (CHoCH or past_below_ema condition is very broad)
- Not a bug — the classify_bos_grade logic routes most daily-timeframe scenarios to REVERSAL

## Exit Reason Distribution (V10)
| Reason | n | avg% |
|--------|---|------|
| Mirror_Full | 243 | 18.24 |
| ATR_Floor | 85 | -13.63 |
| Trail_Stop | 201 | 36.07 |
| Time_Stop | 3 | -2.37 |

---

## V12 (PatB) Exit/Entry Improvements (2026-03-21)

V12 = V10 baseline + Fix1 + Fix3 + Fix6。ロジック構造の変更ではなく、タイミング調整のみ。

### 改善内容

| Fix | 内容 | 効果 |
|-----|------|------|
| Fix1 (ATR Floor Close確定) | Structure Stop を Low → Close ベースに変更 | ヒゲ貫通の誤発動 33% 削減 (85→57件) |
| Fix3 (Partial Mirror) | Bearish CHoCH で 50% 利確、EMA確認で残り50% | 全損回避 + トレンド継続時のリターン維持 |
| Fix6 (Entry Open) | Entry を翌日 Close → 翌日 Open に変更 | Open は平均 1.92% 安い → 全指標改善 |

### V10 vs V12 (PatB) 比較

| Metric | V10 (Baseline) | V12 (PatB) | 変化 |
|--------|---------------|------------|------|
| n | 532 | 532 | — |
| avg% | 19.77 | 19.67 | -0.10 |
| med% | 1.26 | 5.15 | **+3.89** |
| win% | 54.1 | 67.7 | **+13.6** |
| PF | 5.73 | 10.21 | **+4.48** |
| Sharpe | — | 0.286 | — |
| MaxDD | -54.76 | -31.57 | **-42% 改善** |
| StdDev | 88.96 | 68.69 | **-22% 改善** |

### Exit Reason Distribution (V12)

| Reason | n | avg% |
|--------|---|------|
| Mirror_Full | — | — |
| CHoCH_Warning (50%) | — | — |
| ATR_Floor (Close確定) | 57 | — |
| Trail_Stop | — | — |
| Time_Stop | — | — |

### 不採用 Fix

| Fix | 理由 |
|-----|------|
| Fix2 (Early Trail) | 効果微小、複雑性増 |
| Fix4 (Regime Trail Base) | highest weight 増加 → トレンドノイズで早期Exit。現行 EMA 0.7 + highest 0.3 が最適 |
| Fix5 (Price ATR) | 効果微小、複雑性増 |

### 実装済みファイル

- `exit_manager.py`: Fix1 (Close確定) + Fix3 (choch_exit_pct=50)
- `combined_entry_detector.py`: Fix6 (entry_timing="NEXT_OPEN")
- `signal.py`: Fix6 (entry_timing をAPI responseに追加)

---

## BOS Confidence サイズ調整の検証 (2026-03-21)

PatB (V12) + BOS Confidence の組み合わせバックテストを実施。

### PatB + BOS Confidence 結果

| Metric | PatB (size=100%) | PatB + Confidence | 差 |
|--------|-----------------|-------------------|-----|
| weighted avg | 19.47% | 13.94% | **-5.53%** |
| weighted PF | 10.14 | 10.23 | +0.09 |
| avg confidence | 1.00 | 0.69 | — |
| avg size | 100% | 69.4% | -30.6% |

### BOS Grade別パフォーマンス

| Grade | n | avg% | win% | avg_conf |
|-------|---|------|------|----------|
| REVERSAL | 259 | 21.88 | 65.6 | 0.95 |
| NONE | 275 | 17.20 | **69.5** | 0.45 |

### 判定

**BOS Confidenceサイズ調整は逆効果**。NONEグレード（win 69.5%）がREVERSAL（win 65.6%）より勝率が高いのに、サイズを55%カット。weighted avg -5.53%の悪化。

**対応**: Confidenceによるサイズ調整を無効化（`adjusted_size_pct = size_pct`）。BOS Gradeは情報表示のみ。コードは将来の再設計に備えて残す。

### Phase 3 判定

- Confidence統合は不要 → Phase 3の大部分（QM/BSL/SSL）は見送り
- **Premium/Discountのみ実装**（chart marker, display-only）
  - 実装コスト最小、情報としての価値は高い
  - `premium_discount_detector.py` として実装済み
  - chart-markers APIに統合済み

---

## Next Steps
- [x] ~~Phase 3 (QM/BSL/SSL/Premium-Discount)~~ → Premium/Discountのみ実装済み
- [ ] OTE/OB/Premium-Discount frontend chart markers implementation
- [ ] Regime-based entry threshold analysis (RECOVERY threshold 2.0 の妥当性)
- [ ] PatB (V12) ライブ運用で挙動確認
