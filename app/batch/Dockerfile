FROM python:3.11-slim

WORKDIR /app

# システム依存: rclone (R2 アップロード), pg_dump (DB バックアップ)
RUN apt-get update && apt-get install -y --no-install-recommends \
        curl unzip ca-certificates postgresql-client \
    && curl -fsSL https://rclone.org/install.sh | bash \
    && apt-get purge -y curl unzip \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

# 依存関係インストール
COPY app/batch/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# batch モジュール
COPY app/batch/ ./app/batch/

# batch が参照する backend の分析モジュール
COPY app/backend/analysis/ ./app/backend/analysis/

# バックアップスクリプト
COPY scripts/ ./scripts/

# セキュリティ: 非 root ユーザーで実行
RUN useradd -m -u 1000 appuser && chown -R appuser:appuser /app
USER appuser

# デフォルト: 日次バッチ
CMD ["python", "-m", "app.batch.run", "--daily"]
