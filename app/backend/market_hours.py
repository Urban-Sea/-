"""
market_hours.py - 米国/日本市場の開閉場判定 + 適応型キャッシュ TTL

閉場中は株価が変わらないため、キャッシュ TTL を延長して
Redis コマンド・yfinance 呼び出しを削減する。

対応:
- 米国 NYSE/NASDAQ: 9:30-16:00 ET (土日祝休)
- 日本 TSE: 前場 9:00-11:30、後場 12:30-15:30 JST (土日祝休)
- 祝日はアルゴリズム計算 (年次更新不要)
"""

import re
from datetime import date, datetime, time, timedelta
from functools import lru_cache
from zoneinfo import ZoneInfo

_ET = ZoneInfo("America/New_York")
_JST = ZoneInfo("Asia/Tokyo")

# 米国市場 (NYSE/NASDAQ)
_US_OPEN = time(9, 30)
_US_CLOSE = time(16, 0)

# 日本市場 (TSE) — 前場 + 後場
_JP_AM_OPEN = time(9, 0)
_JP_AM_CLOSE = time(11, 30)
_JP_PM_OPEN = time(12, 30)
_JP_PM_CLOSE = time(15, 30)

# 日本株ティッカー判定 (数字のみ or 数字.T)
_JP_TICKER_RE = re.compile(r"^\d+(\.[A-Z]+)?$", re.IGNORECASE)


# ── 祝日計算ヘルパー ──


def _nth_weekday(year: int, month: int, weekday: int, n: int) -> date:
    """month の n 番目の weekday (月=0) を返す"""
    d = date(year, month, 1)
    days_ahead = (weekday - d.weekday()) % 7
    return date(year, month, 1 + days_ahead + 7 * (n - 1))


def _last_weekday(year: int, month: int, weekday: int) -> date:
    """month の最後の weekday を返す"""
    if month == 12:
        next_month = date(year + 1, 1, 1)
    else:
        next_month = date(year, month + 1, 1)
    days_back = (next_month.weekday() - weekday) % 7
    if days_back == 0:
        days_back = 7
    return next_month - timedelta(days=days_back)


def _easter(year: int) -> date:
    """Anonymous Gregorian Easter algorithm"""
    a = year % 19
    b, c = divmod(year, 100)
    d, e = divmod(b, 4)
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = divmod(c, 4)
    el = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * el) // 451
    month, day = divmod(h + el - 7 * m + 114, 31)
    return date(year, month, day + 1)


def _vernal_equinox_day(year: int) -> int:
    """春分の日 (近似計算)"""
    return int(20.8431 + 0.242194 * (year - 1980) - int((year - 1980) / 4))


def _autumnal_equinox_day(year: int) -> int:
    """秋分の日 (近似計算)"""
    return int(23.2488 + 0.242194 * (year - 1980) - int((year - 1980) / 4))


# ── 米国祝日 ──


@lru_cache(maxsize=4)
def _us_holidays(year: int) -> frozenset:
    """NYSE 休業日 (アルゴリズム計算)"""
    raw = {
        date(year, 1, 1),                       # New Year's Day
        _nth_weekday(year, 1, 0, 3),            # MLK Day (3rd Mon)
        _nth_weekday(year, 2, 0, 3),            # Presidents' Day (3rd Mon)
        _easter(year) - timedelta(days=2),      # Good Friday
        _last_weekday(year, 5, 0),              # Memorial Day (last Mon)
        date(year, 6, 19),                      # Juneteenth
        date(year, 7, 4),                       # Independence Day
        _nth_weekday(year, 9, 0, 1),            # Labor Day (1st Mon)
        _nth_weekday(year, 11, 3, 4),           # Thanksgiving (4th Thu)
        date(year, 12, 25),                     # Christmas
    }
    # Observed rule: 土曜 → 前日金曜、日曜 → 翌月曜
    adjusted = set()
    for h in raw:
        if h.weekday() == 5:
            adjusted.add(h - timedelta(days=1))
        elif h.weekday() == 6:
            adjusted.add(h + timedelta(days=1))
        else:
            adjusted.add(h)
    return frozenset(adjusted)


# ── 日本祝日 ──


@lru_cache(maxsize=4)
def _jp_holidays(year: int) -> frozenset:
    """TSE 休業日 (アルゴリズム計算)"""
    raw = {
        date(year, 1, 1),                               # 元日
        _nth_weekday(year, 1, 0, 2),                    # 成人の日 (2nd Mon)
        date(year, 2, 11),                              # 建国記念の日
        date(year, 2, 23),                              # 天皇誕生日
        date(year, 3, _vernal_equinox_day(year)),       # 春分の日
        date(year, 4, 29),                              # 昭和の日
        date(year, 5, 3),                               # 憲法記念日
        date(year, 5, 4),                               # みどりの日
        date(year, 5, 5),                               # こどもの日
        _nth_weekday(year, 7, 0, 3),                    # 海の日 (3rd Mon)
        date(year, 8, 11),                              # 山の日
        _nth_weekday(year, 9, 0, 3),                    # 敬老の日 (3rd Mon)
        date(year, 9, _autumnal_equinox_day(year)),     # 秋分の日
        _nth_weekday(year, 10, 0, 2),                   # スポーツの日 (2nd Mon)
        date(year, 11, 3),                              # 文化の日
        date(year, 11, 23),                             # 勤労感謝の日
    }
    # 振替休日: 日曜が祝日 → 翌月曜
    adjusted = set()
    for h in raw:
        adjusted.add(h)
        if h.weekday() == 6:
            adjusted.add(h + timedelta(days=1))
    # 年末年始 (12/31-1/3 は TSE 休場)
    adjusted.update({
        date(year, 1, 2),
        date(year, 1, 3),
        date(year, 12, 31),
    })
    return frozenset(adjusted)


# ── 公開 API ──


def is_us_market_open() -> bool:
    """米国株式市場が開場中か判定 (土日祝 + 時間帯)"""
    now = datetime.now(_ET)
    if now.weekday() >= 5:
        return False
    if now.date() in _us_holidays(now.year):
        return False
    return _US_OPEN <= now.time() < _US_CLOSE


def is_jp_market_open() -> bool:
    """日本株式市場が開場中か判定 (土日祝 + 前場/後場)"""
    now = datetime.now(_JST)
    if now.weekday() >= 5:
        return False
    if now.date() in _jp_holidays(now.year):
        return False
    t = now.time()
    return (_JP_AM_OPEN <= t < _JP_AM_CLOSE) or (_JP_PM_OPEN <= t < _JP_PM_CLOSE)


def _is_us_trading_day(d: date) -> bool:
    """平日 & 祝日でない = 取引日"""
    return d.weekday() < 5 and d not in _us_holidays(d.year)


def _is_jp_trading_day(d: date) -> bool:
    """平日 & 祝日でない = 取引日"""
    return d.weekday() < 5 and d not in _jp_holidays(d.year)


def _seconds_until_next_open_us() -> int:
    """次の NYSE 開場 (9:30 ET) までの秒数を返す"""
    now = datetime.now(_ET)
    today = now.date()

    # 今日がまだ開場前なら今日の 9:30 を候補にする
    if _is_us_trading_day(today) and now.time() < _US_OPEN:
        target = datetime.combine(today, _US_OPEN, tzinfo=_ET)
        return max(int((target - now).total_seconds()), 0)

    # 翌日以降で最初の取引日を探す (最大 10 日先まで)
    d = today + timedelta(days=1)
    for _ in range(10):
        if _is_us_trading_day(d):
            target = datetime.combine(d, _US_OPEN, tzinfo=_ET)
            return max(int((target - now).total_seconds()), 0)
        d += timedelta(days=1)

    # フォールバック (ありえないが安全策)
    return 3600


def _seconds_until_next_open_jp() -> int:
    """次の TSE 開場までの秒数を返す (前場 9:00 or 後場 12:30)"""
    now = datetime.now(_JST)
    today = now.date()

    if _is_jp_trading_day(today):
        # 前場前
        if now.time() < _JP_AM_OPEN:
            target = datetime.combine(today, _JP_AM_OPEN, tzinfo=_JST)
            return max(int((target - now).total_seconds()), 0)
        # 昼休み中 → 後場開始まで
        if _JP_AM_CLOSE <= now.time() < _JP_PM_OPEN:
            target = datetime.combine(today, _JP_PM_OPEN, tzinfo=_JST)
            return max(int((target - now).total_seconds()), 0)

    # 翌日以降で最初の取引日を探す
    d = today + timedelta(days=1)
    for _ in range(10):
        if _is_jp_trading_day(d):
            target = datetime.combine(d, _JP_AM_OPEN, tzinfo=_JST)
            return max(int((target - now).total_seconds()), 0)
        d += timedelta(days=1)

    return 3600


def adaptive_ttl(base_ttl: int = 300, ticker: str = "") -> int:
    """
    開場中は base_ttl、閉場中は次の開場までの秒数を TTL にする。
    ticker からUS/JP市場を自動判定。
    """
    is_jp = bool(_JP_TICKER_RE.match(ticker)) if ticker else False

    if is_jp:
        if is_jp_market_open():
            return base_ttl
        return max(_seconds_until_next_open_jp(), base_ttl)
    else:
        if is_us_market_open():
            return base_ttl
        return max(_seconds_until_next_open_us(), base_ttl)
