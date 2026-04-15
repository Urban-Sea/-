"""
図3: 詳細全体図 — 概念 + VPS内部 + 外部を横に繋げた1枚
LR レイアウトで左から右に流れる
"""
import graphviz

dot = graphviz.Digraph("detailed", format="png", engine="dot")
dot.attr(
    rankdir="LR",
    bgcolor="#ffffff",
    fontname="Helvetica Neue",
    fontsize="22",
    pad="0.5",
    nodesep="0.5",
    ranksep="1.0",
    dpi="200",
    label="Open Regime — Detailed Architecture",
    labelloc="t",
    labeljust="c",
    size="28,16",
)
dot.attr("node", fontname="Helvetica Neue", fontsize="10", style="filled,rounded", shape="box", margin="0.2,0.12")
dot.attr("edge", fontname="Helvetica Neue", fontsize="8")

# ============================================================
# 左: ユーザー + Cloudflare + CI/CD
# ============================================================
with dot.subgraph(name="cluster_ingress") as ing:
    ing.attr(
        label="Ingress",
        style="rounded,filled",
        fillcolor="#fff3e0",
        color="#f57c00",
        penwidth="2",
        fontsize="14",
    )
    ing.node("user", "ユーザー\n(ブラウザ)", shape="ellipse", fillcolor="#e3f2fd", color="#1565c0", fontsize="12")
    ing.node("cf", "CLOUDFLARE\nDNS Proxy / WAF\nSSL Full(Strict)\nOrigin Cert 15yr", fillcolor="#fff3e0", color="#f57c00")
    ing.node("cf_access", "CF ACCESS\nZero Trust\n(admin のみ)", fillcolor="#fff3e0", color="#f57c00")
    ing.node("gh", "GITHUB ACTIONS\npaths-filter\ndocker save → SCP\nヘルスチェック x30\n自動ロールバック", fillcolor="#eceff1", color="#78909c")

# ============================================================
# 中央: VPS
# ============================================================
with dot.subgraph(name="cluster_vps") as v:
    v.attr(
        label="SAKURA VPS 1GB  |  Ubuntu 24.04  |  ~582MB / 896MB",
        style="rounded,filled",
        fillcolor="#f1f8e9",
        color="#43a047",
        penwidth="2.5",
        fontsize="13",
    )

    v.node("nginx", "NGINX\n:80/:443 | 32MB\nリバースプロキシ\nHSTS | CSRF 注入\nIP直 → 444", fillcolor="#c8e6c9", color="#2e7d32")

    with v.subgraph(name="cluster_api") as a:
        a.attr(label="API", style="rounded,filled", fillcolor="#e3f2fd", color="#64b5f6", fontsize="11")
        a.node("api_go", "api-go :8080\nGo Echo v4 | 64MB\nCRUD 75ep\nOAuth / JWT / MFA\nStripe", fillcolor="#bbdefb", color="#1565c0")
        a.node("api_py", "api-python :8081\nFastAPI | 256MB\nSignal / Regime\nExit / Stock\nyfinance 計算", fillcolor="#bbdefb", color="#1565c0")

    with v.subgraph(name="cluster_fe") as f:
        f.attr(label="Frontend", style="rounded,filled", fillcolor="#fff8e1", color="#ffb74d", fontsize="11")
        f.node("fe", "frontend :3000\nNext.js 15 SSR\n128MB", fillcolor="#fff3e0", color="#e65100")
        f.node("admin", "admin :3002\nNext.js 15 SSR\n96MB", fillcolor="#fff3e0", color="#e65100")

    with v.subgraph(name="cluster_data") as d:
        d.attr(label="Data", style="rounded,filled", fillcolor="#f3e5f5", color="#ba68c8", fontsize="11")
        d.node("pg", "PostgreSQL 16\n:5432 | 256MB\n16 tables", fillcolor="#e1bee7", color="#7b1fa2")
        d.node("redis", "Redis 7\n:6379 | 48MB\nLRU + appendonly", fillcolor="#e1bee7", color="#7b1fa2")

    v.node("cron", "CRON\n(ホスト OS)", shape="ellipse", fillcolor="#eceff1", color="#78909c", fontsize="9")
    v.node("batch", "BATCH (常駐しない — cron 起動)\n日次 / 週次 / R2 バックアップ\nウォームアップ → Redis", fillcolor="#b2dfdb", color="#00897b")
    v.node("logs", "JSON ログ\n/var/log/open-regime/\nbind mount\n→ R2 バックアップ", fillcolor="#f5f5f5", color="#9e9e9e", fontsize="9")

# ============================================================
# 右: External
# ============================================================
with dot.subgraph(name="cluster_ext") as ext:
    ext.attr(
        label="外部サービス",
        style="rounded,filled",
        fillcolor="#fce4ec",
        color="#ef9a9a",
        penwidth="2",
        fontsize="14",
    )
    ext.node("google", "Google\nOAuth 2.0", fillcolor="#ffcdd2", color="#c62828")
    ext.node("r2", "Cloudflare R2\nDB + ログ バックアップ\n7 日保持", fillcolor="#ffcdd2", color="#c62828")
    ext.node("stripe", "Stripe\n(準備中)", fillcolor="#ffcdd2", color="#c62828")

with dot.subgraph(name="cluster_mkt") as mkt:
    mkt.attr(
        label="マーケットデータ",
        style="rounded,filled",
        fillcolor="#e0f7fa",
        color="#00bcd4",
        penwidth="2",
        fontsize="14",
    )
    mkt.node("yf", "Yahoo Finance\nyfinance\n7000+ 銘柄", fillcolor="#b2ebf2", color="#00838f")
    mkt.node("fred", "FRED API\nFed データ\n雇用 / 金利", fillcolor="#b2ebf2", color="#00838f")

# ============================================================
# Edges
# ============================================================

# Ingress
dot.edge("user", "cf", label="HTTPS", color="#f57c00", penwidth="2", style="bold")
dot.edge("user", "cf_access", label="admin", color="#f57c00", style="dashed")
dot.edge("cf", "nginx", label=":443", color="#2e7d32", penwidth="2", style="bold")
dot.edge("cf_access", "nginx", label=":443", color="#2e7d32", style="dashed")
dot.edge("gh", "nginx", label="SCP", color="#78909c", style="dashed")

# nginx routing
dot.edge("nginx", "api_py", label="signal/regime\nexit/stock", color="#1565c0")
dot.edge("nginx", "api_go", label="/api/* CRUD", color="#1565c0")
dot.edge("nginx", "fe", label="/ catch-all", color="#e65100")
dot.edge("nginx", "admin", label="admin.*", color="#e65100", style="dashed")

# API -> Data
dot.edge("api_go", "pg", color="#7b1fa2")
dot.edge("api_go", "redis", color="#c62828", style="dashed")
dot.edge("api_py", "pg", color="#7b1fa2")
dot.edge("api_py", "redis", color="#c62828", style="dashed")

# Batch
dot.edge("cron", "batch", label="run --rm", color="#00897b", style="bold")
dot.edge("batch", "pg", label="pg_dump\nINSERT", color="#7b1fa2")
dot.edge("batch", "redis", label="warmup", color="#c62828", style="dashed")

# VPS -> External
dot.edge("api_go", "google", label="OAuth", color="#c62828", style="dashed")
dot.edge("api_go", "stripe", label="webhook", color="#c62828", style="dashed")
dot.edge("batch", "r2", label="rclone", color="#c62828", style="dashed")
dot.edge("logs", "r2", label="tar.gz", color="#c62828", style="dotted")

# VPS -> Market
dot.edge("api_py", "yf", label="realtime", color="#00838f", style="dashed")
dot.edge("batch", "yf", label="OHLCV", color="#00838f", style="dashed")
dot.edge("batch", "fred", label="econ", color="#00838f", style="dashed")

# Logs (dotted, subtle)
for src in ["nginx", "api_go", "api_py", "batch"]:
    dot.edge(src, "logs", color="#e0e0e0", style="dotted", arrowhead="none")

out = dot.render("/Users/ryu/Desktop/投資/open-regime/arch_3_detailed", cleanup=True)
print(f"Done: {out}")
