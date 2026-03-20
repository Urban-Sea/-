"""
価格帯別 PatB 詳細分析

価格帯ごとの:
- 基本メトリクス (avg, med, win%, PF)
- Exit Reason分布 (ATR Floor率、Trail Stop率、Mirror率)
- Fix3効果の差 (50% vs 30% vs 70% partial mirror)
- ATR Floor乗数の差 (2.5 vs 3.0 vs 3.5)
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
        if df.empty: return pd.DataFrame()
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
    tr = pd.concat([df['High'] - df['Low'], abs(df['High'] - c.shift(1)), abs(df['Low'] - c.shift(1))], axis=1).max(axis=1)
    df['ATR'] = tr.rolling(14).mean()
    df['EMA_distance_atr'] = abs(df['EMA_8'] - df['EMA_21']) / df['ATR']
    return df


def detect_regime(df, idx):
    for col in ['SPY_Close', 'SPY_EMA200', 'SPY_EMA21_slope']:
        if col not in df.columns or pd.isna(df[col].iloc[idx]): return "BULL"
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
        if col in df.columns: df[col] = df[col].ffill()
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
    if 'SPY_Close' not in df.columns or idx < RS_LOOKBACK + 5: return 0.0
    try:
        sc, sp = df['Close'].iloc[idx], df['SPY_Close'].iloc[idx]
        sc0, sp0 = df['Close'].iloc[idx - RS_LOOKBACK], df['SPY_Close'].iloc[idx - RS_LOOKBACK]
        if pd.isna(sc) or pd.isna(sp) or sp == 0 or sp0 == 0: return 0.0
        return ((sc / sp) - (sc0 / sp0)) / (sc0 / sp0) * 100
    except Exception:
        return 0.0


def find_entries(df, choch_signals):
    entries = []
    cooldown = -1
    for i, choch in enumerate(choch_signals):
        if choch.type != CHoCHType.BULLISH or choch.index <= cooldown: continue
        has_prior = False
        for j in range(i-1, max(i-10, -1), -1):
            if j < 0: break
            if choch_signals[j].type == CHoCHType.BEARISH: has_prior = True; break
            if choch_signals[j].type == CHoCHType.BULLISH: break
        if not has_prior: continue
        if choch.index >= len(df) or pd.isna(df['EMA_distance_atr'].iloc[choch.index]): continue
        regime = detect_regime(df, choch.index)
        thresh = V9_EMA_THRESHOLDS.get(regime, 1.5)
        if df['EMA_distance_atr'].iloc[choch.index] > thresh: continue
        eidx = choch.index + 1
        if eidx >= len(df) - 10: continue
        ep_open = df['Open'].iloc[eidx] if 'Open' in df.columns else df['Close'].iloc[eidx]
        if pd.isna(ep_open) or ep_open <= 0: ep_open = df['Close'].iloc[eidx]
        atr = df['ATR'].iloc[eidx]
        if pd.isna(atr): atr = ep_open * 0.05
        entries.append({
            'entry_idx': eidx, 'entry_price': float(ep_open), 'entry_atr': atr,
            'regime': regime, 'price_category': categorize_price(ep_open), 'ticker': '',
        })
        cooldown = eidx + 15
    return entries


def exit_patb(df, entry_idx, entry_price, entry_atr, regime, choch_signals,
              partial_pct=0.5, atr_mult=3.0):
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

        if close <= atr_floor:
            if choch_exit_price is not None:
                blended = choch_exit_price * partial_pct + close * (1 - partial_pct)
                return d, blended, "ATR_Floor(partial)"
            return d, close, "ATR_Floor"

        for c in choch_signals:
            if c.type == CHoCHType.BEARISH and c.index == d:
                if choch_exit_price is None: choch_exit_price = close
                e8 = df['EMA_8'].iloc[d]; e21 = df['EMA_21'].iloc[d]
                if not pd.isna(e8) and not pd.isna(e21) and e8 < e21:
                    if choch_exit_price is not None:
                        blended = choch_exit_price * partial_pct + close * (1 - partial_pct)
                        return d, blended, "Mirror_Partial"
                    return d, close, "Mirror_Full"

        if not trail_active:
            e21 = df['EMA_21'].iloc[d]
            if not pd.isna(e21) and close > e21 * 1.05: trail_active = True

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


def calc_metrics(trades):
    if not trades: return {'n': 0, 'avg': 0, 'med': 0, 'win_pct': 0, 'pf': 0, 'sharpe': 0, 'max_dd': 0, 'std': 0}
    rets = pd.Series([t['return_pct'] for t in trades])
    wins = rets[rets > 0]; losses = rets[rets <= 0]
    pf = wins.sum() / abs(losses.sum()) if losses.sum() != 0 else float('inf')
    return {
        'n': len(rets), 'avg': round(rets.mean(), 2), 'med': round(rets.median(), 2),
        'win_pct': round((rets > 0).mean() * 100, 1),
        'pf': round(pf, 2), 'sharpe': round(rets.mean() / rets.std(), 3) if rets.std() > 0 else 0,
        'max_dd': round(rets.min(), 2), 'std': round(rets.std(), 2),
    }


# ==============================================================
# Main
# ==============================================================

def main():
    print("=" * 130)
    print("価格帯別 PatB 詳細分析")
    print("=" * 130)

    end_date = datetime.now().strftime("%Y-%m-%d")
    print(f"期間: {START_DATE} ~ {end_date}, 銘柄: {len(TICKERS)}個\n")

    spy_df = get_stock_data('SPY', START_DATE, end_date)
    if spy_df.empty: print("SPY FAILED"); return
    spy_df = add_indicators(spy_df)
    print(f"SPY OK ({len(spy_df)} rows)")

    # 3バリアント: PatB baseline, 30% partial, 70% partial
    variants = {
        'PatB (50%)': {'partial': 0.5, 'atr_mult': 3.0},
        '30% partial': {'partial': 0.3, 'atr_mult': 3.0},
        '70% partial': {'partial': 0.7, 'atr_mult': 3.0},
        'ATR×2.5':    {'partial': 0.5, 'atr_mult': 2.5},
        'ATR×3.5':    {'partial': 0.5, 'atr_mult': 3.5},
    }
    results = {v: [] for v in variants}

    for ticker in TICKERS:
        print(f"  {ticker}...", end=" ", flush=True)
        df = get_stock_data(ticker, START_DATE, end_date)
        if df.empty or len(df) < 60: print("skip"); continue
        df = add_indicators(df)
        df = merge_spy(df, spy_df)
        chochs = CHoCHDetector(swing_lookback=3).detect_choch(df)
        entries = find_entries(df, chochs)

        filtered = []
        for e in entries:
            rs = calc_rs_change(df, e['entry_idx'])
            if rs >= V10_RS_DOWN.get(e['price_category'], -3.0):
                e['ticker'] = ticker
                filtered.append(e)
        entries = filtered

        for e in entries:
            eidx, ep, atr, regime, pcat = e['entry_idx'], e['entry_price'], e['entry_atr'], e['regime'], e['price_category']
            for vname, vparams in variants.items():
                ex_idx, ex_price, ex_reason = exit_patb(df, eidx, ep, atr, regime, chochs,
                                                         partial_pct=vparams['partial'],
                                                         atr_mult=vparams['atr_mult'])
                results[vname].append({
                    'ticker': ticker, 'entry_date': df['Date'].iloc[eidx],
                    'return_pct': (ex_price - ep) / ep * 100,
                    'exit_reason': ex_reason, 'regime': regime,
                    'price_category': pcat, 'entry_price': ep,
                    'holding_days': ex_idx - eidx,
                })
        print(f"{len(entries)} entries")

    CATS = ["$0-5", "$5-15", "$15-35", "$35-60", "$60-100", "$100-200", "$200+"]

    # ==============================================================
    # 1. 価格帯別基本メトリクス (PatB baseline)
    # ==============================================================
    print("\n" + "=" * 130)
    print("1. 価格帯別基本メトリクス (PatB baseline)")
    print("=" * 130)

    header = f"{'Category':<12} {'n':>5} {'avg%':>8} {'med%':>8} {'win%':>7} {'PF':>7} {'Sharpe':>7} {'StdDev':>7} {'MaxDD':>7}"
    print(f"\n{header}")
    print("-" * len(header))
    for cat in CATS:
        trades = [t for t in results['PatB (50%)'] if t['price_category'] == cat]
        m = calc_metrics(trades)
        if m['n'] == 0: continue
        print(f"{cat:<12} {m['n']:>5} {m['avg']:>8.2f} {m['med']:>8.2f} {m['win_pct']:>7.1f} {m['pf']:>7.2f} {m['sharpe']:>7.3f} {m['std']:>7.2f} {m['max_dd']:>7.2f}")

    # ==============================================================
    # 2. 価格帯別 Exit Reason 分布
    # ==============================================================
    print("\n" + "=" * 130)
    print("2. 価格帯別 Exit Reason 分布 (PatB baseline)")
    print("=" * 130)

    reasons = ['ATR_Floor', 'ATR_Floor(partial)', 'Mirror_Partial', 'Trail_Stop', 'Trail_Stop(partial)', 'Time_Stop', 'Time_Stop(partial)']
    print(f"\n{'Category':<12}", end="")
    for r in reasons:
        print(f" {r[:12]:>12}", end="")
    print()
    print("-" * (12 + 13 * len(reasons)))

    for cat in CATS:
        trades = [t for t in results['PatB (50%)'] if t['price_category'] == cat]
        if not trades: continue
        n = len(trades)
        print(f"{cat:<12}", end="")
        for r in reasons:
            count = len([t for t in trades if t['exit_reason'] == r])
            pct = count / n * 100
            print(f" {pct:>5.1f}%({count:>3})", end="")
        print()

    # ==============================================================
    # 3. 価格帯別 ATR Floor率 + avg リターン
    # ==============================================================
    print("\n" + "=" * 130)
    print("3. 価格帯別 ATR Floor詳細 (PatB baseline)")
    print("=" * 130)

    print(f"\n{'Category':<12} {'n':>5} {'Floor率':>8} {'Floor n':>8} {'Floor avg':>10} {'NonFloor avg':>13} {'差':>8}")
    print("-" * 70)
    for cat in CATS:
        trades = [t for t in results['PatB (50%)'] if t['price_category'] == cat]
        if not trades: continue
        n = len(trades)
        floor = [t for t in trades if 'ATR_Floor' in t['exit_reason']]
        non_floor = [t for t in trades if 'ATR_Floor' not in t['exit_reason']]
        floor_rate = len(floor) / n * 100
        floor_avg = np.mean([t['return_pct'] for t in floor]) if floor else 0
        nf_avg = np.mean([t['return_pct'] for t in non_floor]) if non_floor else 0
        print(f"{cat:<12} {n:>5} {floor_rate:>7.1f}% {len(floor):>8} {floor_avg:>10.2f}% {nf_avg:>13.2f}% {nf_avg-floor_avg:>+7.2f}%")

    # ==============================================================
    # 4. 価格帯別 partial mirror 比率比較
    # ==============================================================
    print("\n" + "=" * 130)
    print("4. 価格帯別 partial mirror 比率比較")
    print("=" * 130)

    for cat in CATS:
        trades_50 = [t for t in results['PatB (50%)'] if t['price_category'] == cat]
        if not trades_50: continue
        m50 = calc_metrics(trades_50)
        m30 = calc_metrics([t for t in results['30% partial'] if t['price_category'] == cat])
        m70 = calc_metrics([t for t in results['70% partial'] if t['price_category'] == cat])

        print(f"\n--- {cat} (n={m50['n']}) ---")
        print(f"  {'Variant':<15} {'avg%':>8} {'med%':>8} {'win%':>7} {'PF':>7} {'MaxDD':>7}")
        print(f"  {'-'*55}")
        for label, m in [('30% partial', m30), ('50% (PatB)', m50), ('70% partial', m70)]:
            marker = " ◀" if label == '50% (PatB)' else ""
            print(f"  {label:<15} {m['avg']:>8.2f} {m['med']:>8.2f} {m['win_pct']:>7.1f} {m['pf']:>7.2f} {m['max_dd']:>7.2f}{marker}")

    # ==============================================================
    # 5. 価格帯別 ATR Floor乗数比較
    # ==============================================================
    print("\n" + "=" * 130)
    print("5. 価格帯別 ATR Floor乗数比較")
    print("=" * 130)

    for cat in CATS:
        trades_30 = [t for t in results['PatB (50%)'] if t['price_category'] == cat]
        if not trades_30: continue
        m30 = calc_metrics(trades_30)
        m25 = calc_metrics([t for t in results['ATR×2.5'] if t['price_category'] == cat])
        m35 = calc_metrics([t for t in results['ATR×3.5'] if t['price_category'] == cat])

        print(f"\n--- {cat} (n={m30['n']}) ---")
        print(f"  {'Variant':<15} {'avg%':>8} {'med%':>8} {'win%':>7} {'PF':>7} {'MaxDD':>7}")
        print(f"  {'-'*55}")
        for label, m in [('ATR×2.5', m25), ('ATR×3.0 (PatB)', m30), ('ATR×3.5', m35)]:
            marker = " ◀" if 'PatB' in label else ""
            print(f"  {label:<15} {m['avg']:>8.2f} {m['med']:>8.2f} {m['win_pct']:>7.1f} {m['pf']:>7.2f} {m['max_dd']:>7.2f}{marker}")

    # ==============================================================
    # 6. 銘柄別サマリ
    # ==============================================================
    print("\n" + "=" * 130)
    print("6. 銘柄別サマリ (PatB baseline)")
    print("=" * 130)

    print(f"\n{'Ticker':<8} {'Cat':<8} {'n':>4} {'avg%':>8} {'med%':>8} {'win%':>7} {'PF':>7} {'Floor%':>7}")
    print("-" * 60)
    ticker_stats = {}
    for t in results['PatB (50%)']:
        tk = t['ticker']
        if tk not in ticker_stats: ticker_stats[tk] = []
        ticker_stats[tk].append(t)

    for tk in TICKERS:
        if tk not in ticker_stats: continue
        trades = ticker_stats[tk]
        m = calc_metrics(trades)
        cat = trades[0]['price_category']
        floor_rate = len([t for t in trades if 'ATR_Floor' in t['exit_reason']]) / len(trades) * 100
        print(f"{tk:<8} {cat:<8} {m['n']:>4} {m['avg']:>8.2f} {m['med']:>8.2f} {m['win_pct']:>7.1f} {m['pf']:>7.2f} {floor_rate:>6.1f}%")


if __name__ == '__main__':
    main()
