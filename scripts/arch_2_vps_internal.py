"""
図2: VPS 内部 — 全コンテナ間の通信
batch は常時起動ではなく cron で起こす
"""
import graphviz

dot = graphviz.Digraph("vps_internal", format="png", engine="dot")
dot.attr(
    rankdir="TB",
    bgcolor="#ffffff",
    fontname="Helvetica Neue",
    fontsize="20",
    pad="0.6",
    nodesep="0.7",
    ranksep="1.0",
    dpi="200",
    label="VPS 内部 — Docker コンテナ構成",
    labelloc="t",
    labeljust="c",
)
dot.attr("node", fontname="Helvetica Neue", fontsize="11", style="filled,rounded", shape="box", margin="0.25,0.15")
dot.attr("edge", fontname="Helvetica Neue", fontsize="9")

# ========================================
# VPS cluster
# ========================================
with dot.subgraph(name="cluster_vps") as v:
    v.attr(
        label="SAKURA VPS 1GB  |  ~582MB / 896MB  |  swap 2GB",
        style="rounded,filled",
        fillcolor="#f1f8e9",
        color="#43a047",
        penwidth="2.5",
        fontsize="14",
        fontname="Helvetica Neue",
    )

    # -- nginx --
    v.node("nginx", "NGINX :80/:443\nnginx:alpine | 32MB | UID 101\n──────────────────\nリバースプロキシ\nHSTS preload | IP直アクセス → 444\nPROXY_SECRET 注入 (CSRF)", fillcolor="#c8e6c9", color="#2e7d32")

    # -- API layer --
    with v.subgraph(name="cluster_api") as a:
        a.attr(label="API Layer", style="rounded,filled", fillcolor="#e3f2fd", color="#64b5f6", fontsize="12")
        a.node("api_go", "api-go :8080\nGo + Echo v4 | 64MB | UID 65532 (distroless)\n──────────────────────\nCRUD 75ep | Google OAuth\nJWT (HttpOnly Cookie) | Admin MFA\nStripe webhook | golang-migrate", fillcolor="#bbdefb", color="#1565c0")
        a.node("api_py", "api-python :8081\nFastAPI + asyncpg | 256MB | UID 1000\n──────────────────────\n/signal /regime /exit /stock\nyfinance リアルタイム計算\nL1 dict(500) → L2 Redis", fillcolor="#bbdefb", color="#1565c0")

    # -- Frontend layer --
    with v.subgraph(name="cluster_fe") as f:
        f.attr(label="Frontend Layer", style="rounded,filled", fillcolor="#fff8e1", color="#ffb74d", fontsize="12")
        f.node("frontend", "frontend :3000\nNext.js 15 SSR | 128MB\n──────────────────\nopen-regime.com\nrecharts / shadcn / SWR\nCookie JWT 認証", fillcolor="#fff3e0", color="#e65100")
        f.node("admin_fe", "admin :3002\nNext.js 15 SSR | 96MB\n──────────────────\nadmin.open-regime.com\nCF Access + JWT + MFA", fillcolor="#fff3e0", color="#e65100")

    # -- Data layer --
    with v.subgraph(name="cluster_data") as d:
        d.attr(label="Data Layer", style="rounded,filled", fillcolor="#f3e5f5", color="#ba68c8", fontsize="12")
        d.node("pg", "PostgreSQL 16 :5432\n256MB | 16 tables\nshared_buffers 64MB\nmax_connections 30", fillcolor="#e1bee7", color="#7b1fa2")
        d.node("redis", "Redis 7 :6379\n48MB LRU | appendonly\nrequirepass\nOAuth state + L2 cache", fillcolor="#e1bee7", color="#7b1fa2")

    # -- Batch (cron, not always-on) --
    v.node("batch", "BATCH (常時起動ではない — cron で都度起動)\nPython 3.11 + yfinance + FRED | 256MB | UID 1000\n────────────────────────────────\n日次 07:30 JST: Yahoo Finance + FRED + SRF\n週次 金 08:00 JST: FRB BS + MMF + 雇用統計\nR2 バックアップ 09:00 JST: pg_dump + ログ tar.gz → rclone → R2\nウォームアップ: regime + employment → Redis 充填", fillcolor="#b2dfdb", color="#00897b")

    # -- Logs --
    v.node("logs", "JSON 構造化ログ → /var/log/open-regime/\nnginx(101) | api-go(65532) | api-python(1000) | batch(1000)\nbind mount | UID 別 chown | logrotate (nginx + batch cron のみ)", fillcolor="#f5f5f5", color="#9e9e9e")

    # -- cron --
    v.node("cron", "CRON (ホスト OS)\ndeploy ユーザーの crontab\n3 スケジュール", shape="ellipse", fillcolor="#eceff1", color="#78909c")

# Rank constraints removed — let graphviz auto-layout within clusters

# ========================================
# Edges
# ========================================

# cron -> batch
dot.edge("cron", "batch", label="docker compose run --rm", color="#00897b", style="bold", penwidth="1.5")

# nginx -> API
dot.edge("nginx", "api_py", label="/api/signal,regime\n/api/exit,stock", color="#1565c0", penwidth="1.3")
dot.edge("nginx", "api_go", label="/api/* (CRUD)", color="#1565c0", penwidth="1.3")

# nginx -> Frontend
dot.edge("nginx", "frontend", label="/ catch-all", color="#e65100", penwidth="1.3")
dot.edge("nginx", "admin_fe", label="admin.* /", color="#e65100", style="dashed", penwidth="1.3")

# API -> Data
dot.edge("api_go", "pg", label="pgx", color="#7b1fa2")
dot.edge("api_go", "redis", label="L2 cache", color="#c62828", style="dashed")
dot.edge("api_py", "pg", label="asyncpg", color="#7b1fa2")
dot.edge("api_py", "redis", label="L1→L2", color="#c62828", style="dashed")

# Batch -> Data
dot.edge("batch", "pg", label="psycopg2\npg_dump", color="#7b1fa2")
dot.edge("batch", "redis", label="warmup SET", color="#c62828", style="dashed")

# All -> Logs
for src in ["nginx", "api_go", "api_py", "batch"]:
    dot.edge(src, "logs", color="#bdbdbd", style="dotted", arrowhead="none")

out = dot.render("/Users/ryu/Desktop/投資/open-regime/arch_2_vps_internal", cleanup=True)
print(f"Done: {out}")
