FROM python:3.11-slim

WORKDIR /app

# 依存関係インストール
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# アプリケーションコピー
COPY . .

# セキュリティ: 非 root ユーザーで実行
RUN useradd -m -u 1000 appuser && chown -R appuser:appuser /app
USER appuser

# ポート公開 (Cloud Run は PORT=8080 を注入)
EXPOSE 8080

# 起動コマンド (Cloud Run の PORT 環境変数に対応)
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8080}"]
