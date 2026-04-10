"""
一致性テスト — ExitManager.evaluate_trade が exit_patternB と全件一致するか検証

ネットワーク不要: tests/fixtures/ のOHLCV CSV + trades JSON を使用
"""

import sys
import os
import json

import pytest
import pandas as pd

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'app', 'backend'))

from analysis.choch_detector import CHoCHDetector
from analysis.exit_manager import evaluate_trade

FIXTURES_DIR = os.path.join(os.path.dirname(__file__), 'fixtures')
OHLCV_DIR = os.path.join(FIXTURES_DIR, 'ohlcv')
TRADES_PATH = os.path.join(FIXTURES_DIR, 'exit_patb_trades.json')


@pytest.fixture(scope="module")
def trades():
    with open(TRADES_PATH) as f:
        return json.load(f)


@pytest.fixture(scope="module")
def dataframes():
    """全銘柄のDataFrameをキャッシュ"""
    dfs = {}
    for csv_file in os.listdir(OHLCV_DIR):
        if csv_file.endswith('.csv'):
            ticker = csv_file.replace('.csv', '')
            dfs[ticker] = pd.read_csv(os.path.join(OHLCV_DIR, csv_file))
    return dfs


@pytest.fixture(scope="module")
def choch_cache(dataframes):
    """全銘柄のCHoCHシグナルをキャッシュ"""
    cache = {}
    det = CHoCHDetector(swing_lookback=3)
    for ticker, df in dataframes.items():
        if ticker == 'SPY':
            continue
        cache[ticker] = det.detect_choch(df)
    return cache


def test_trade_count(trades):
    """フィクスチャのトレード数が想定通り"""
    assert len(trades) == 529, f"Expected 529 trades, got {len(trades)}"


def test_all_trades_match(trades, dataframes, choch_cache):
    """全532トレードで (exit_idx, exit_price, exit_reason) が完全一致"""
    mismatches = []

    for i, t in enumerate(trades):
        ticker = t['ticker']
        df = dataframes[ticker]
        chochs = choch_cache[ticker]

        result = evaluate_trade(
            df=df,
            entry_idx=t['entry_idx'],
            entry_price=t['entry_price'],
            entry_atr=t['entry_atr'],
            regime=t['regime'],
            choch_signals=chochs,
        )

        if result is None:
            mismatches.append(
                f"[{i}] {ticker} entry_idx={t['entry_idx']}: result is None"
            )
            continue

        # exit_idx 一致
        if result.exit_idx != t['exit_idx']:
            mismatches.append(
                f"[{i}] {ticker} entry_idx={t['entry_idx']}: "
                f"exit_idx expected={t['exit_idx']} got={result.exit_idx}"
            )
            continue

        # exit_price 一致 (浮動小数点許容)
        if result.exit_price != pytest.approx(t['exit_price'], rel=1e-9):
            mismatches.append(
                f"[{i}] {ticker} entry_idx={t['entry_idx']}: "
                f"exit_price expected={t['exit_price']} got={result.exit_price}"
            )
            continue

        # exit_reason 一致
        if result.exit_reason != t['exit_reason']:
            mismatches.append(
                f"[{i}] {ticker} entry_idx={t['entry_idx']}: "
                f"exit_reason expected={t['exit_reason']} got={result.exit_reason}"
            )
            continue

        # partial_exit フィールド一致
        expected_partial_idx = t.get('partial_exit_idx')
        expected_partial_price = t.get('partial_exit_price')
        if result.partial_exit_idx != expected_partial_idx:
            mismatches.append(
                f"[{i}] {ticker} entry_idx={t['entry_idx']}: "
                f"partial_exit_idx expected={expected_partial_idx} got={result.partial_exit_idx}"
            )
        if expected_partial_price is not None:
            if result.partial_exit_price != pytest.approx(expected_partial_price, rel=1e-9):
                mismatches.append(
                    f"[{i}] {ticker} entry_idx={t['entry_idx']}: "
                    f"partial_exit_price expected={expected_partial_price} got={result.partial_exit_price}"
                )
        elif result.partial_exit_price is not None:
            mismatches.append(
                f"[{i}] {ticker} entry_idx={t['entry_idx']}: "
                f"partial_exit_price expected=None got={result.partial_exit_price}"
            )

    if mismatches:
        detail = "\n".join(mismatches[:20])
        pytest.fail(f"{len(mismatches)} mismatches out of {len(trades)}:\n{detail}")


def test_metrics_match(trades, dataframes, choch_cache):
    """PF, win_rate, avg が期待値に近い（サニティチェック）"""
    returns = []

    for t in trades:
        ticker = t['ticker']
        df = dataframes[ticker]
        chochs = choch_cache[ticker]

        result = evaluate_trade(
            df=df,
            entry_idx=t['entry_idx'],
            entry_price=t['entry_price'],
            entry_atr=t['entry_atr'],
            regime=t['regime'],
            choch_signals=chochs,
        )
        if result is None:
            continue

        ret = (result.exit_price - t['entry_price']) / t['entry_price'] * 100
        returns.append(ret)

    import numpy as np
    rets = np.array(returns)
    wins = rets[rets > 0]
    losses = rets[rets <= 0]
    pf = wins.sum() / abs(losses.sum()) if losses.sum() != 0 else float('inf')
    win_rate = (rets > 0).mean() * 100
    avg = rets.mean()

    # unblended exit prices: avg 10.12%, win 74.5%, PF 8.91
    assert avg == pytest.approx(10.12, abs=0.5), f"avg={avg:.2f}"
    assert win_rate == pytest.approx(74.5, abs=0.5), f"win_rate={win_rate:.1f}"
    assert pf == pytest.approx(8.91, abs=0.5), f"PF={pf:.2f}"
