"""
BOS Grade × Exit戦略 バックテスト

現行PatB:     全トレード 50% partial mirror
PatB-v2:      REVERSAL → 30% partial, NONE → 70% partial
PatB-v3:      REVERSAL → ATR×3.5, NONE → ATR×2.5 (Floor乗数変更)
PatB-v4:      v2 + v3 合体（部分Mirror比率 + ATR Floor乗数 両方変更）
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


# ==============================================================
# Helpers
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
        ep_open = df['Open'].iloc[eidx] if 'Open' in df.columns else df['Close'].iloc[eidx]
        if pd.isna(ep_open) or ep_open <= 0:
            ep_open = df['Close'].iloc[eidx]
        atr = df['ATR'].iloc[eidx]
        if pd.isna(atr): atr = ep_open * 0.05
        entries.append({
            'entry_idx': eidx,
            'entry_price': float(ep_open),
            'entry_atr': atr,
            'regime': regime,
            'price_category': categorize_price(ep_open),
        })
        cooldown = eidx + 15
    return entries


def compute_bos_grade(df, idx):
    """BOS Grade分類（REVERSAL or NONE）"""
    try:
        det = BOSDetector()
        highs = df['High'].tolist()
        lows = df['Low'].tolist()
        closes = df['Close'].tolist()
        ema_21 = df['EMA_21'].tolist()
        bos_signals = det.detect_bos(highs, lows)
        choch_bos = det.detect_choch(highs, lows)
        analysis = det.classify_bos_grade(bos_signals, choch_bos, closes, ema_21, idx)
        return analysis.grade
    except Exception:
        return BOSGrade.NONE


# ==============================================================
# Exit Functions
# ==============================================================

def exit_patb(df, entry_idx, entry_price, entry_atr, regime, choch_signals,
              partial_pct=0.5, atr_mult=3.0):
    """
    PatB Exit with configurable partial mirror % and ATR floor multiplier.

    partial_pct: CHoCH Warning時の退出比率 (0.0〜1.0)
    atr_mult: ATR Floor = entry_price - entry_atr * atr_mult
    """
    trail_mult = {"BULL": 3.0, "WEAKENING": 2.7, "BEAR": 2.5, "RECOVERY": 3.5}.get(regime, 3.0)
    atr_floor = entry_price - entry_atr * atr_mult
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
                blended = choch_exit_price * partial_pct + close * (1 - partial_pct)
                return d, blended, "ATR_Floor(partial)"
            return d, close, "ATR_Floor"

        for c in choch_signals:
            if c.type == CHoCHType.BEARISH and c.index == d:
                # Fix3: Bearish CHoCHで部分退出記録
                if choch_exit_price is None:
                    choch_exit_price = close

                e8 = df['EMA_8'].iloc[d]; e21 = df['EMA_21'].iloc[d]
                if not pd.isna(e8) and not pd.isna(e21) and e8 < e21:
                    if choch_exit_price is not None:
                        blended = choch_exit_price * partial_pct + close * (1 - partial_pct)
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
                    blended = choch_exit_price * partial_pct + exit_price * (1 - partial_pct)
                    return d, blended, "Trail_Stop(partial)"
                return d, exit_price, "Trail_Stop"

    exit_price = df['Close'].iloc[max_day]
    if choch_exit_price is not None:
        blended = choch_exit_price * partial_pct + exit_price * (1 - partial_pct)
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


# ==============================================================
# Main
# ==============================================================

def main():
    print("=" * 120)
    print("BOS Grade × Exit戦略 バックテスト")
    print("=" * 120)

    end_date = datetime.now().strftime("%Y-%m-%d")
    print(f"期間: {START_DATE} ~ {end_date}, 銘柄: {len(TICKERS)}個")

    print("\nSPY取得...", end=" ", flush=True)
    spy_df = get_stock_data('SPY', START_DATE, end_date)
    if spy_df.empty:
        print("FAILED"); return
    spy_df = add_indicators(spy_df)
    print(f"OK ({len(spy_df)} rows)")

    # Variants:
    # PatB:    全トレード partial=50%, atr_mult=3.0
    # v2:      REVERSAL→30%, NONE→70% (partial mirror比率変更)
    # v3:      REVERSAL→ATR×3.5, NONE→ATR×2.5 (Floor乗数変更)
    # v4:      v2+v3 合体
    variant_names = ['PatB (50%/3.0)', 'v2 (R30/N70)', 'v3 (R3.5/N2.5)', 'v4 (v2+v3)']
    results = {name: [] for name in variant_names}

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
            ep = e['entry_price']
            atr = e['entry_atr']
            regime = e['regime']
            pcat = e['price_category']

            # BOS Grade
            grade = compute_bos_grade(df, eidx)
            grade_str = grade.value

            base_info = {
                'ticker': ticker, 'entry_date': df['Date'].iloc[eidx],
                'holding_days': 0, 'regime': regime,
                'price_category': pcat, 'entry_price': ep,
                'bos_grade': grade_str,
            }

            # PatB baseline: 50% / ATR×3.0
            ex_idx, ex_price, ex_reason = exit_patb(df, eidx, ep, atr, regime, chochs,
                                                     partial_pct=0.5, atr_mult=3.0)
            results['PatB (50%/3.0)'].append({
                **base_info, 'return_pct': (ex_price - ep) / ep * 100,
                'exit_reason': ex_reason, 'holding_days': ex_idx - eidx,
            })

            # v2: Grade-based partial mirror %
            if grade in (BOSGrade.REVERSAL, BOSGrade.EXTENSION):
                v2_partial = 0.3  # 大振れ型: 30%退出、70%残す
            else:
                v2_partial = 0.7  # 安定型: 70%退出、30%残す
            ex_idx, ex_price, ex_reason = exit_patb(df, eidx, ep, atr, regime, chochs,
                                                     partial_pct=v2_partial, atr_mult=3.0)
            results['v2 (R30/N70)'].append({
                **base_info, 'return_pct': (ex_price - ep) / ep * 100,
                'exit_reason': ex_reason, 'holding_days': ex_idx - eidx,
            })

            # v3: Grade-based ATR floor multiplier
            if grade in (BOSGrade.REVERSAL, BOSGrade.EXTENSION):
                v3_atr = 3.5  # 大振れ型: 広いストップ
            else:
                v3_atr = 2.5  # 安定型: 狭いストップ
            ex_idx, ex_price, ex_reason = exit_patb(df, eidx, ep, atr, regime, chochs,
                                                     partial_pct=0.5, atr_mult=v3_atr)
            results['v3 (R3.5/N2.5)'].append({
                **base_info, 'return_pct': (ex_price - ep) / ep * 100,
                'exit_reason': ex_reason, 'holding_days': ex_idx - eidx,
            })

            # v4: v2 + v3 combined
            ex_idx, ex_price, ex_reason = exit_patb(df, eidx, ep, atr, regime, chochs,
                                                     partial_pct=v2_partial, atr_mult=v3_atr)
            results['v4 (v2+v3)'].append({
                **base_info, 'return_pct': (ex_price - ep) / ep * 100,
                'exit_reason': ex_reason, 'holding_days': ex_idx - eidx,
            })

        print(f"{len(entries)} entries")

    # ==============================================================
    # 全体比較
    # ==============================================================
    print("\n" + "=" * 120)
    print("全体比較")
    print("=" * 120)

    header = f"{'Variant':<20} {'n':>5} {'avg%':>8} {'med%':>8} {'win%':>7} {'PF':>7} {'Sharpe':>7} {'StdDev':>7} {'MaxDD':>7} {'P25':>7} {'P75':>7}"
    print(f"\n{header}")
    print("-" * len(header))

    baseline = calc_metrics(results['PatB (50%/3.0)'])
    for name in variant_names:
        m = calc_metrics(results[name])
        delta = ""
        if name != 'PatB (50%/3.0)':
            da = m['avg'] - baseline['avg']
            dm = m['med'] - baseline['med']
            dw = m['win_pct'] - baseline['win_pct']
            dp = m['pf'] - baseline['pf']
            delta = f"  Δavg={da:+.2f} Δmed={dm:+.2f} Δwin={dw:+.1f} ΔPF={dp:+.2f}"
        print(f"{name:<20} {m['n']:>5} {m['avg']:>8.2f} {m['med']:>8.2f} {m['win_pct']:>7.1f} {m['pf']:>7.2f} {m['sharpe']:>7.3f} {m['std']:>7.2f} {m['max_dd']:>7.2f} {m['p25']:>7.2f} {m['p75']:>7.2f}{delta}")

    # ==============================================================
    # Grade別 × Variant 詳細
    # ==============================================================
    print("\n" + "=" * 120)
    print("Grade別 × Variant 詳細")
    print("=" * 120)

    for grade_name in ['REVERSAL', 'NONE']:
        print(f"\n--- {grade_name} ---")
        print(f"{'Variant':<20} {'n':>5} {'avg%':>8} {'med%':>8} {'win%':>7} {'PF':>7}")
        print("-" * 55)
        for name in variant_names:
            trades = [t for t in results[name] if t['bos_grade'] == grade_name]
            m = calc_metrics(trades)
            print(f"{name:<20} {m['n']:>5} {m['avg']:>8.2f} {m['med']:>8.2f} {m['win_pct']:>7.1f} {m['pf']:>7.2f}")

    # ==============================================================
    # Exit Reason 分布
    # ==============================================================
    print("\n" + "=" * 120)
    print("Exit Reason 分布")
    print("=" * 120)

    for name in variant_names:
        trades = results[name]
        df_t = pd.DataFrame(trades)
        print(f"\n--- {name} ---")
        for reason in sorted(df_t['exit_reason'].unique()):
            r = df_t[df_t['exit_reason'] == reason]
            avg = r['return_pct'].mean()
            win = (r['return_pct'] > 0).mean() * 100
            print(f"  {reason:>22}: n={len(r):>4}, avg={avg:>7.2f}%, win={win:>5.1f}%")

    # ==============================================================
    # Regime別分析
    # ==============================================================
    print("\n" + "=" * 120)
    print("Regime別分析")
    print("=" * 120)

    for name in variant_names:
        print(f"\n--- {name} ---")
        df_t = pd.DataFrame(results[name])
        for regime in ['BULL', 'WEAKENING', 'RECOVERY', 'BEAR']:
            r = df_t[df_t['regime'] == regime]
            if r.empty: continue
            avg = r['return_pct'].mean()
            med = r['return_pct'].median()
            win = (r['return_pct'] > 0).mean() * 100
            print(f"  {regime:<12}: n={len(r):>4}, avg={avg:>7.2f}%, med={med:>7.2f}%, win={win:>5.1f}%")

    # ==============================================================
    # 年次分析（最も効果的なvariantのみ）
    # ==============================================================
    print("\n" + "=" * 120)
    print("年次分析")
    print("=" * 120)

    print(f"\n{'Year':<6}", end="")
    for name in variant_names:
        print(f"  {name:<20}", end="")
    print()
    print("-" * (6 + 22 * len(variant_names)))

    all_years = sorted(set(t['entry_date'][:4] for t in results['PatB (50%/3.0)']))
    for year in all_years:
        print(f"{year:<6}", end="")
        for name in variant_names:
            trades = [t for t in results[name] if t['entry_date'][:4] == year]
            m = calc_metrics(trades)
            print(f"  avg={m['avg']:>6.2f} w={m['win_pct']:>4.1f}%  ", end="")
        print()


if __name__ == '__main__':
    main()
