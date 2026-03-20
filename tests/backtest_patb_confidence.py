"""
PatB (V12) + BOS Confidence バックテスト

比較:
- PatB (V12): Fix1+Fix3+Fix6, サイズ調整なし (confidence=1.0固定)
- PatB + BOS Confidence: Fix1+Fix3+Fix6, BOS Confidenceでサイズ加重

判断材料:
- BOS Confidenceがリスク調整後リターンを改善するか？
- 効果あり → Phase 3でConfidence分解能を上げる（QM/Premium-Discount統合）
- 効果なし → Phase 3はdisplay-onlyに限定
"""

import sys
import os
import warnings
warnings.filterwarnings('ignore')

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'app', 'backend'))

import pandas as pd
import numpy as np
from datetime import datetime
import yfinance as yf

from analysis.choch_detector import CHoCHDetector, CHoCHType
from analysis.bos_detector import BOSDetector, BOSGrade


# ==============================================================
# Config
# ==============================================================

TICKERS = [
    'SOUN', 'RGTI', 'IONQ', 'SOFI', 'GSAT', 'MARA', 'PLUG', 'NIO',
    'COIN', 'RKLB', 'PLTR', 'HOOD', 'AFRM', 'SNAP', 'ROKU',
    'NVDA', 'TSLA', 'META', 'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'AMD',
]

START_DATE = "2019-01-01"
RS_LOOKBACK = 21

V9_EMA_THRESHOLDS = {"BULL": 1.3, "WEAKENING": 1.0, "BEAR": 0.8, "RECOVERY": 2.0}
V10_RS_DOWN = {
    "$0-5": -30.0, "$5-15": -2.0, "$15-35": -2.0, "$35-60": -5.0,
    "$60-100": -15.0, "$100-200": -15.0, "$200+": -2.0,
}

GRADE_SCORE = {
    BOSGrade.EXTENSION: 0.9, BOSGrade.REVERSAL: 1.0,
    BOSGrade.CONTINUATION: 0.6, BOSGrade.NONE: 0.9,
}


# ==============================================================
# Helpers (共通)
# ==============================================================

def get_stock_data(ticker, start, end):
    try:
        df = yf.download(ticker, start=start, end=end, progress=False)
        if df.empty:
            return pd.DataFrame()
        df = df.reset_index()
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = [c[0] if c[1] == '' or c[1] == ticker else c[0] for c in df.columns]
        df['Date'] = pd.to_datetime(df['Date']).dt.strftime('%Y-%m-%d')
        return df
    except Exception:
        return pd.DataFrame()


def add_indicators(df):
    df = df.copy()
    c = df['Close']
    df['EMA_8'] = c.ewm(span=8, adjust=False).mean()
    df['EMA_21'] = c.ewm(span=21, adjust=False).mean()
    df['EMA_200'] = c.ewm(span=200, adjust=False).mean()
    tr = pd.concat([
        df['High'] - df['Low'],
        abs(df['High'] - c.shift(1)),
        abs(df['Low'] - c.shift(1)),
    ], axis=1).max(axis=1)
    df['ATR'] = tr.rolling(14).mean()
    df['EMA_distance_atr'] = abs(df['EMA_8'] - df['EMA_21']) / df['ATR']
    return df


def detect_regime(df, idx):
    for col in ['SPY_Close', 'SPY_EMA200', 'SPY_EMA21_slope']:
        if col not in df.columns or pd.isna(df[col].iloc[idx]):
            return "BULL"
    above = df['SPY_Close'].iloc[idx] > df['SPY_EMA200'].iloc[idx]
    up = df['SPY_EMA21_slope'].iloc[idx] > 0
    if above and up: return "BULL"
    if above and not up: return "WEAKENING"
    if not above and up: return "RECOVERY"
    return "BEAR"


def merge_spy(df, spy_df):
    df = df.copy()
    df['_dk'] = pd.to_datetime(df['Date']).dt.strftime('%Y-%m-%d')
    spy_sub = spy_df[['Date', 'Close', 'EMA_21', 'EMA_200']].copy()
    spy_sub.columns = ['Date', 'SPY_Close', 'SPY_EMA21', 'SPY_EMA200']
    spy_sub['SPY_EMA21_slope'] = spy_sub['SPY_EMA21'].diff(5)
    spy_sub['_dk'] = pd.to_datetime(spy_sub['Date']).dt.strftime('%Y-%m-%d')
    spy_sub = spy_sub.drop('Date', axis=1)
    df = df.merge(spy_sub, on='_dk', how='left')
    df.drop('_dk', axis=1, inplace=True)
    for col in ['SPY_Close', 'SPY_EMA21', 'SPY_EMA200', 'SPY_EMA21_slope']:
        if col in df.columns:
            df[col] = df[col].ffill()
    return df


def categorize_price(price):
    if price <= 5: return "$0-5"
    if price <= 15: return "$5-15"
    if price <= 35: return "$15-35"
    if price <= 60: return "$35-60"
    if price <= 100: return "$60-100"
    if price <= 200: return "$100-200"
    return "$200+"


def calc_rs_change(df, idx):
    if 'SPY_Close' not in df.columns or idx < RS_LOOKBACK + 5:
        return 0.0
    try:
        sc = df['Close'].iloc[idx]
        sp = df['SPY_Close'].iloc[idx]
        sc0 = df['Close'].iloc[idx - RS_LOOKBACK]
        sp0 = df['SPY_Close'].iloc[idx - RS_LOOKBACK]
        if pd.isna(sc) or pd.isna(sp) or sp == 0 or sp0 == 0:
            return 0.0
        return ((sc / sp) - (sc0 / sp0)) / (sc0 / sp0) * 100
    except Exception:
        return 0.0


# ==============================================================
# Entry Detection (V10 gate, common)
# ==============================================================

def find_entries(df, choch_signals):
    entries = []
    cooldown = -1
    for i, choch in enumerate(choch_signals):
        if choch.type != CHoCHType.BULLISH or choch.index <= cooldown:
            continue
        has_prior = False
        for j in range(i-1, max(i-10, -1), -1):
            if j < 0: break
            if choch_signals[j].type == CHoCHType.BEARISH:
                has_prior = True; break
            if choch_signals[j].type == CHoCHType.BULLISH:
                break
        if not has_prior:
            continue
        if choch.index >= len(df) or pd.isna(df['EMA_distance_atr'].iloc[choch.index]):
            continue
        regime = detect_regime(df, choch.index)
        thresh = V9_EMA_THRESHOLDS.get(regime, 1.5)
        if df['EMA_distance_atr'].iloc[choch.index] > thresh:
            continue
        eidx = choch.index + 1
        if eidx >= len(df) - 10:
            continue
        ep_close = df['Close'].iloc[eidx]
        ep_open = df['Open'].iloc[eidx] if 'Open' in df.columns else ep_close
        if pd.isna(ep_close) or ep_close <= 0:
            continue
        if pd.isna(ep_open) or ep_open <= 0:
            ep_open = ep_close
        atr = df['ATR'].iloc[eidx]
        if pd.isna(atr): atr = ep_close * 0.05
        entries.append({
            'entry_idx': eidx,
            'entry_price_open': float(ep_open),
            'entry_atr': atr,
            'regime': regime,
            'price_category': categorize_price(ep_open),
        })
        cooldown = eidx + 15
    return entries


# ==============================================================
# BOS Confidence Computation
# ==============================================================

def compute_bos_confidence(df, idx):
    """BOS Confidence Score計算"""
    try:
        det = BOSDetector()
        highs = df['High'].tolist()
        lows = df['Low'].tolist()
        closes = df['Close'].tolist()
        ema_21 = df['EMA_21'].tolist()

        bos_signals = det.detect_bos(highs, lows)
        choch_bos = det.detect_choch(highs, lows)
        analysis = det.classify_bos_grade(bos_signals, choch_bos, closes, ema_21, idx)
        confidence = det.compute_confidence_score(analysis, idx)
        return confidence, analysis.grade
    except Exception:
        return 1.0, BOSGrade.NONE


# ==============================================================
# Exit: PatB (Fix1 + Fix3 + Fix6)
# ==============================================================

def exit_patb(df, entry_idx, entry_price, entry_atr, regime, choch_signals):
    """PatB: Fix1(ATR Close確定) + Fix3(部分Mirror)、Entry=Open (Fix6)"""
    trail_mult = {"BULL": 3.0, "WEAKENING": 2.7, "BEAR": 2.5, "RECOVERY": 3.5}.get(regime, 3.0)
    atr_floor = entry_price - entry_atr * 3.0
    max_day = min(entry_idx + 252, len(df) - 1)
    highest = entry_price
    trail_active = False
    choch_exit_price = None

    for d in range(entry_idx + 1, max_day + 1):
        close = df['Close'].iloc[d]
        high = df['High'].iloc[d]
        low = df['Low'].iloc[d]
        atr_now = df['ATR'].iloc[d] if pd.notna(df['ATR'].iloc[d]) else entry_atr
        if pd.isna(close): continue
        highest = max(highest, high)

        # Fix1: Close確定
        if close <= atr_floor:
            if choch_exit_price is not None:
                blended = choch_exit_price * 0.5 + close * 0.5
                return d, blended, "ATR_Floor(partial)"
            return d, close, "ATR_Floor"

        for c in choch_signals:
            if c.type == CHoCHType.BEARISH and c.index == d:
                # Fix3: Bearish CHoCHで50%記録
                if choch_exit_price is None:
                    choch_exit_price = close

                e8 = df['EMA_8'].iloc[d]; e21 = df['EMA_21'].iloc[d]
                if not pd.isna(e8) and not pd.isna(e21) and e8 < e21:
                    if choch_exit_price is not None:
                        blended = choch_exit_price * 0.5 + close * 0.5
                        return d, blended, "Mirror_Partial"
                    return d, close, "Mirror_Full"

        if not trail_active:
            e21 = df['EMA_21'].iloc[d]
            if not pd.isna(e21) and close > e21 * 1.05:
                trail_active = True

        if trail_active:
            ema10 = df['Close'].iloc[max(0, d-10):d+1].ewm(span=10, adjust=False).mean().iloc[-1]
            trail_base = ema10 * 0.7 + highest * 0.3
            trail_price = trail_base - atr_now * trail_mult
            if low <= trail_price:
                exit_price = max(trail_price, low)
                if choch_exit_price is not None:
                    blended = choch_exit_price * 0.5 + exit_price * 0.5
                    return d, blended, "Trail_Stop(partial)"
                return d, exit_price, "Trail_Stop"

    exit_price = df['Close'].iloc[max_day]
    if choch_exit_price is not None:
        blended = choch_exit_price * 0.5 + exit_price * 0.5
        return max_day, blended, "Time_Stop(partial)"
    return max_day, exit_price, "Time_Stop"


# ==============================================================
# Metrics
# ==============================================================

def calc_metrics(trades):
    if not trades:
        return {'n': 0, 'avg': 0, 'med': 0, 'win_pct': 0, 'pf': 0, 'sharpe': 0,
                'max_dd': 0, 'std': 0, 'p25': 0, 'p75': 0}
    rets = pd.Series([t['return_pct'] for t in trades])
    wins = rets[rets > 0]
    losses = rets[rets <= 0]
    pf = wins.sum() / abs(losses.sum()) if losses.sum() != 0 else float('inf')
    sharpe = rets.mean() / rets.std() if rets.std() > 0 else 0
    max_dd = rets.min() if len(rets) > 0 else 0
    return {
        'n': len(rets),
        'avg': round(rets.mean(), 2),
        'med': round(rets.median(), 2),
        'win_pct': round((rets > 0).mean() * 100, 1),
        'pf': round(pf, 2),
        'sharpe': round(sharpe, 3),
        'max_dd': round(max_dd, 2),
        'std': round(rets.std(), 2),
        'p25': round(rets.quantile(0.25), 2),
        'p75': round(rets.quantile(0.75), 2),
    }


def calc_weighted_metrics(trades):
    """サイズ加重メトリクス"""
    if not trades:
        return {'n': 0, 'w_avg': 0, 'w_pf': 0, 'avg_conf': 0, 'avg_size': 0}
    w_rets = pd.Series([t['weighted_return'] for t in trades])
    confs = pd.Series([t['bos_confidence'] for t in trades])
    sizes = pd.Series([t['size_pct'] for t in trades])
    w_wins = w_rets[w_rets > 0]
    w_losses = w_rets[w_rets <= 0]
    w_pf = w_wins.sum() / abs(w_losses.sum()) if w_losses.sum() != 0 else float('inf')
    return {
        'n': len(w_rets),
        'w_avg': round(w_rets.mean(), 2),
        'w_pf': round(w_pf, 2),
        'avg_conf': round(confs.mean(), 2),
        'avg_size': round(sizes.mean(), 1),
    }


# ==============================================================
# Main
# ==============================================================

def main():
    print("=" * 120)
    print("PatB (V12) + BOS Confidence バックテスト")
    print("=" * 120)

    end_date = datetime.now().strftime("%Y-%m-%d")
    print(f"期間: {START_DATE} ~ {end_date}, 銘柄: {len(TICKERS)}個")

    print("\nSPY取得...", end=" ", flush=True)
    spy_df = get_stock_data('SPY', START_DATE, end_date)
    if spy_df.empty:
        print("FAILED"); return
    spy_df = add_indicators(spy_df)
    print(f"OK ({len(spy_df)} rows)")

    patb_trades = []       # PatB (confidence=1.0固定)
    patb_conf_trades = []  # PatB + BOS Confidence

    for ticker in TICKERS:
        print(f"  {ticker}...", end=" ", flush=True)
        df = get_stock_data(ticker, START_DATE, end_date)
        if df.empty or len(df) < 60:
            print("skip"); continue
        df = add_indicators(df)
        df = merge_spy(df, spy_df)

        choch_det = CHoCHDetector(swing_lookback=3)
        chochs = choch_det.detect_choch(df)
        entries = find_entries(df, chochs)

        # RS filter
        filtered = []
        for e in entries:
            rs = calc_rs_change(df, e['entry_idx'])
            cat = e['price_category']
            thresh = V10_RS_DOWN.get(cat, -3.0)
            if rs >= thresh:
                filtered.append(e)
        entries = filtered

        for e in entries:
            eidx = e['entry_idx']
            ep = e['entry_price_open']  # Fix6: Entry at Open
            atr = e['entry_atr']
            regime = e['regime']
            pcat = e['price_category']

            # Exit (PatB: Fix1+Fix3)
            ex_idx, ex_price, ex_reason = exit_patb(df, eidx, ep, atr, regime, chochs)
            ret = (ex_price - ep) / ep * 100

            # BOS Confidence
            confidence, grade = compute_bos_confidence(df, eidx)
            adj_size = int(100 * confidence)

            base_trade = {
                'ticker': ticker, 'entry_date': df['Date'].iloc[eidx],
                'return_pct': ret, 'holding_days': ex_idx - eidx,
                'exit_reason': ex_reason, 'regime': regime,
                'price_category': pcat, 'entry_price': ep,
            }

            # PatB (no confidence adjustment)
            patb_trades.append({
                **base_trade,
                'size_pct': 100,
                'weighted_return': ret,  # size=100% → weighted = raw
            })

            # PatB + BOS Confidence
            patb_conf_trades.append({
                **base_trade,
                'size_pct': adj_size,
                'bos_confidence': confidence,
                'bos_grade': grade.value,
                'weighted_return': ret * confidence,
            })

        print(f"{len(entries)} entries")

    # ==============================================================
    # 結果比較
    # ==============================================================
    print("\n" + "=" * 120)
    print("結果比較: PatB (V12) vs PatB + BOS Confidence")
    print("=" * 120)

    # 基本メトリクス（生リターン）
    m_patb = calc_metrics(patb_trades)
    m_conf = calc_metrics(patb_conf_trades)

    header = f"{'Variant':<30} {'n':>5} {'avg%':>8} {'med%':>8} {'win%':>7} {'PF':>7} {'Sharpe':>7} {'StdDev':>7} {'MaxDD':>7}"
    print(f"\n生リターン（サイズ調整前）:")
    print(header)
    print("-" * len(header))
    print(f"{'PatB (V12)':<30} {m_patb['n']:>5} {m_patb['avg']:>8.2f} {m_patb['med']:>8.2f} {m_patb['win_pct']:>7.1f} {m_patb['pf']:>7.2f} {m_patb['sharpe']:>7.3f} {m_patb['std']:>7.2f} {m_patb['max_dd']:>7.2f}")
    print(f"{'PatB + BOS Confidence':<30} {m_conf['n']:>5} {m_conf['avg']:>8.2f} {m_conf['med']:>8.2f} {m_conf['win_pct']:>7.1f} {m_conf['pf']:>7.2f} {m_conf['sharpe']:>7.3f} {m_conf['std']:>7.2f} {m_conf['max_dd']:>7.2f}")
    print("(注: 生リターンはEntry/Exit同一なので完全一致。差はサイズ加重にのみ現れる)")

    # サイズ加重メトリクス
    w_patb = calc_weighted_metrics([{**t, 'bos_confidence': 1.0} for t in patb_trades])
    w_conf = calc_weighted_metrics(patb_conf_trades)

    print(f"\nサイズ加重メトリクス:")
    print(f"{'Variant':<30} {'w_avg%':>8} {'w_PF':>7} {'avg_conf':>9} {'avg_size%':>9}")
    print("-" * 70)
    print(f"{'PatB (V12, size=100%)':<30} {w_patb['w_avg']:>8.2f} {w_patb['w_pf']:>7.2f} {'1.00':>9} {'100.0':>9}")
    print(f"{'PatB + BOS Confidence':<30} {w_conf['w_avg']:>8.2f} {w_conf['w_pf']:>7.2f} {w_conf['avg_conf']:>9} {w_conf['avg_size']:>9}")

    delta_wavg = w_conf['w_avg'] - w_patb['w_avg']
    print(f"\n  Δ weighted avg: {delta_wavg:+.2f}%")
    print(f"  Δ weighted PF: {w_conf['w_pf'] - w_patb['w_pf']:+.2f}")

    # ==============================================================
    # BOS Grade別分析
    # ==============================================================
    print("\n" + "=" * 120)
    print("BOS Grade別分析 (PatB + Confidence)")
    print("=" * 120)

    df_conf = pd.DataFrame(patb_conf_trades)
    if not df_conf.empty:
        print(f"\n{'Grade':<15} {'n':>5} {'avg%':>8} {'med%':>8} {'win%':>7} {'avg_conf':>9} {'avg_size%':>9} {'w_avg%':>8}")
        print("-" * 80)
        for grade in ['REVERSAL', 'NONE', 'EXTENSION', 'CONTINUATION']:
            g = df_conf[df_conf['bos_grade'] == grade]
            if g.empty: continue
            avg = g['return_pct'].mean()
            med = g['return_pct'].median()
            win = (g['return_pct'] > 0).mean() * 100
            ac = g['bos_confidence'].mean()
            asz = g['size_pct'].mean()
            wavg = g['weighted_return'].mean()
            print(f"{grade:<15} {len(g):>5} {avg:>8.2f} {med:>8.2f} {win:>7.1f} {ac:>9.2f} {asz:>9.1f} {wavg:>8.2f}")

    # ==============================================================
    # Confidence区間別分析
    # ==============================================================
    print("\n" + "=" * 120)
    print("Confidence区間別分析")
    print("=" * 120)

    if not df_conf.empty:
        bins = [(0.0, 0.4), (0.4, 0.6), (0.6, 0.8), (0.8, 1.0), (1.0, 1.01)]
        labels = ['0.00-0.40', '0.40-0.60', '0.60-0.80', '0.80-1.00', '1.00']
        print(f"\n{'Conf Range':<15} {'n':>5} {'avg%':>8} {'med%':>8} {'win%':>7} {'Contribution':>12}")
        print("-" * 60)
        for (lo, hi), label in zip(bins, labels):
            mask = (df_conf['bos_confidence'] >= lo) & (df_conf['bos_confidence'] < hi)
            if label == '1.00':
                mask = df_conf['bos_confidence'] >= 1.0
            g = df_conf[mask]
            if g.empty: continue
            avg = g['return_pct'].mean()
            med = g['return_pct'].median()
            win = (g['return_pct'] > 0).mean() * 100
            contrib = g['weighted_return'].sum()
            print(f"{label:<15} {len(g):>5} {avg:>8.2f} {med:>8.2f} {win:>7.1f} {contrib:>12.1f}")

    # ==============================================================
    # Confidence効果の有効性判定
    # ==============================================================
    print("\n" + "=" * 120)
    print("判定")
    print("=" * 120)

    if not df_conf.empty:
        # 低Confidence (< 0.6) のトレードが本当にパフォーマンス悪いか？
        low_conf = df_conf[df_conf['bos_confidence'] < 0.6]
        high_conf = df_conf[df_conf['bos_confidence'] >= 0.6]
        if not low_conf.empty and not high_conf.empty:
            low_avg = low_conf['return_pct'].mean()
            high_avg = high_conf['return_pct'].mean()
            low_win = (low_conf['return_pct'] > 0).mean() * 100
            high_win = (high_conf['return_pct'] > 0).mean() * 100
            print(f"\n  低Confidence (<0.6): n={len(low_conf)}, avg={low_avg:.2f}%, win={low_win:.1f}%")
            print(f"  高Confidence (≥0.6): n={len(high_conf)}, avg={high_avg:.2f}%, win={high_win:.1f}%")
            print(f"  差: avg {high_avg - low_avg:+.2f}%, win {high_win - low_win:+.1f}%")

            if high_avg > low_avg and high_win > low_win:
                print("\n  → Confidenceはリターン・勝率の両方で分離効果あり")
                print("  → Phase 3: Confidence分解能を上げる価値あり（QM/Premium-Discount統合）")
            elif high_avg > low_avg:
                print("\n  → Confidenceはリターンのみ分離効果あり（勝率は差なし）")
                print("  → Phase 3: 限定的。Premium/Discountのみ実装を検討")
            else:
                print("\n  → Confidenceの分離効果なし")
                print("  → Phase 3: display-onlyに限定。Confidence統合は不要")

    # ==============================================================
    # Regime別 Confidence効果
    # ==============================================================
    print("\n" + "=" * 120)
    print("Regime別 Confidence効果")
    print("=" * 120)

    if not df_conf.empty:
        for regime in ['BULL', 'WEAKENING', 'RECOVERY', 'BEAR']:
            r = df_conf[df_conf['regime'] == regime]
            if r.empty: continue
            raw_avg = r['return_pct'].mean()
            w_avg = r['weighted_return'].mean()
            avg_conf = r['bos_confidence'].mean()
            n = len(r)
            delta = w_avg - raw_avg
            print(f"  {regime:<12}: n={n:>4}, raw_avg={raw_avg:>7.2f}%, w_avg={w_avg:>7.2f}%, Δ={delta:>+6.2f}%, avg_conf={avg_conf:.2f}")

    # ==============================================================
    # 年次 Confidence効果
    # ==============================================================
    print("\n" + "=" * 120)
    print("年次 Confidence効果")
    print("=" * 120)

    if not df_conf.empty:
        df_conf['year'] = df_conf['entry_date'].str[:4]
        print(f"\n{'Year':<6} {'n':>5} {'raw_avg%':>9} {'w_avg%':>8} {'Δ':>7} {'avg_conf':>9}")
        print("-" * 50)
        for year in sorted(df_conf['year'].unique()):
            y = df_conf[df_conf['year'] == year]
            raw = y['return_pct'].mean()
            w = y['weighted_return'].mean()
            ac = y['bos_confidence'].mean()
            print(f"{year:<6} {len(y):>5} {raw:>9.2f} {w:>8.2f} {w-raw:>+7.2f} {ac:>9.2f}")


if __name__ == '__main__':
    main()
