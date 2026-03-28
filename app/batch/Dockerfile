FROM python:3.11-slim

WORKDIR /app

# 依存関係インストール
COPY app/batch/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# batch モジュール
COPY app/batch/ ./app/batch/

# batch が参照する backend の分析モジュール
COPY app/backend/analysis/ ./app/backend/analysis/

# セキュリティ: 非 root ユーザーで実行
RUN useradd -m -u 1000 appuser && chown -R appuser:appuser /app
USER appuser

# デフォルト: 日次バッチ
CMD ["python", "-m", "app.batch.run", "--daily"]
