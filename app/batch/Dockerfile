FROM python:3.12-slim AS builder
WORKDIR /build

ARG RCLONE_VERSION=1.74.1
RUN apt-get update && apt-get install -y --no-install-recommends curl unzip \
    && curl -fsSL "https://downloads.rclone.org/v${RCLONE_VERSION}/rclone-v${RCLONE_VERSION}-linux-amd64.zip" \
       -o /tmp/rclone.zip \
    && unzip /tmp/rclone.zip -d /tmp \
    && install -m 755 /tmp/rclone-v${RCLONE_VERSION}-linux-amd64/rclone /usr/local/bin/rclone \
    && rm -rf /tmp/rclone* \
    && apt-get purge -y curl unzip && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
COPY app/batch/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

FROM python:3.12-slim AS runner
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates postgresql-client \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /opt/venv /opt/venv
COPY --from=builder /usr/local/bin/rclone /usr/local/bin/rclone
ENV PATH="/opt/venv/bin:$PATH"

COPY app/batch/ ./app/batch/
COPY app/backend/analysis/ ./app/backend/analysis/
COPY scripts/ ./scripts/

RUN useradd -m -u 1000 appuser && chown -R appuser:appuser /app
USER appuser

CMD ["python", "-m", "app.batch.run", "--daily"]
