"""
db.py — asyncpg コネクションプール管理

Docker 環境でのセルフホスト PostgreSQL 直接接続用。
auth.py がユーザー解決で使用する。計算ルーター (signal/regime/exit/stock) は DB 不要。

環境変数:
  DB_HOST     — PostgreSQL ホスト (default: postgres)
  DB_PORT     — PostgreSQL ポート (default: 5432)
  DB_NAME     — データベース名 (default: open_regime)
  DB_USER     — ユーザー名 (default: app)
  DB_PASSWORD — パスワード
"""

import logging
import os

import asyncpg

logger = logging.getLogger(__name__)

_pool: asyncpg.Pool | None = None


async def init_pool() -> None:
    """asyncpg コネクションプールを初期化。lifespan の起動時に呼ぶ。"""
    global _pool

    host = os.getenv("DB_HOST", "postgres")
    port = int(os.getenv("DB_PORT", "5432"))
    dbname = os.getenv("DB_NAME", "open_regime")
    user = os.getenv("DB_USER", "app")
    password = os.getenv("DB_PASSWORD", "")

    if not password:
        logger.warning("DB_PASSWORD is not set — pool may fail to connect")

    _pool = await asyncpg.create_pool(
        host=host,
        port=port,
        database=dbname,
        user=user,
        password=password,
        min_size=2,
        max_size=10,
    )
    logger.info("asyncpg pool created: %s@%s:%d/%s", user, host, port, dbname)


async def close_pool() -> None:
    """コネクションプールを閉じる。lifespan の終了時に呼ぶ。"""
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None
        logger.info("asyncpg pool closed")


def get_pool() -> asyncpg.Pool | None:
    """現在のコネクションプールを返す。未初期化なら None。"""
    return _pool
