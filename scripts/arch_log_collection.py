"""
Open Regime — ログ収集 → R2 バックアップの流れ
mansion/log.png スタイル: フラットノード + invisible edge で段制御
"""
import graphviz

dot = graphviz.Digraph("log", format="png", engine="dot")
dot.attr(
    rankdir="TB",
    bgcolor="#ffffff",
    fontname="Helvetica Neue",
    fontsize="22",
    pad="0.8",
    nodesep="0.5",
    ranksep="1.0",
    dpi="200",
    label="ログ・バックアップ → R2 の流れ",
    labelloc="t",
    labeljust="c",
)
dot.attr("node", fontname="Helvetica Neue", fontsize="10", style="filled,rounded", shape="box", margin="0.2,0.12")
dot.attr("edge", fontname="Helvetica Neue", fontsize="9")

# ============================================================
# Row 0: ① CRON
# ============================================================
dot.node("h1", "①  CRON に設定された実行時間に達する", shape="plaintext", fontsize="13", fontname="Helvetica Neue Bold")

# ============================================================
# Row 1: 常時起動コンテナ (3つ横並び)
# ============================================================
dot.node("h2", "②  常時起動コンテナ → ホスト OS にログ出力 (mount)", shape="plaintext", fontsize="13", fontname="Helvetica Neue Bold")

dot.node("nx", "NGINX\nUID 101 | 32MB", fillcolor="#bbdefb", color="#1565c0")
dot.node("go", "api-go\nUID 65532 | 64MB", fillcolor="#bbdefb", color="#1565c0")
dot.node("py", "api-python\nUID 1000 | 256MB", fillcolor="#bbdefb", color="#1565c0")

# ============================================================
# Row 2: ホスト OS ログ (4つ横並び)
# ============================================================
dot.node("lnx", "/nginx/\naccess.log (JSON)\nerror.log\n───────────\nlogrotate\n(日付ベース)", fillcolor="#f5f5f5", color="#78909c")
dot.node("lgo", "/api-go/\napp.log (JSON)\n───────────\nlumberjack 自前\n50MB×3 / 7日 / gzip", fillcolor="#f5f5f5", color="#78909c")
dot.node("lpy", "/api-python/\napp.log (JSON)\nuvicorn.log\n───────────\nRotatingFileHandler\n自前ローテ", fillcolor="#f5f5f5", color="#78909c")
dot.node("lbt", "/batch/\napp.log (JSON)\ncron.log\nbackup.log\n───────────\nlogrotate\n(日付ベース)", fillcolor="#f5f5f5", color="#78909c")

dot.node("host_label", "ホスト OS  /var/log/open-regime/", shape="plaintext", fontsize="12", fontname="Helvetica Neue Bold", fontcolor="#616161")

# ============================================================
# Row 3: ③ batch + PostgreSQL
# ============================================================
dot.node("h3", "③  cron → docker compose run --rm batch", shape="plaintext", fontsize="13", fontname="Helvetica Neue Bold")

dot.node("cron", "CRON\n(ホスト OS)\ndeploy crontab", shape="ellipse", fillcolor="#eceff1", color="#546e7a")

dot.node("batch", "BATCH (一時起動 --rm)\n─────────────────\nログ mount → tar.gz 圧縮\npg_dump → sql.gz 圧縮\nrclone で R2 へ送信\n7 日超を自動削除", fillcolor="#b2dfdb", color="#00897b")

dot.node("pg", "POSTGRESQL 16\n:5432", fillcolor="#e1bee7", color="#7b1fa2")

# ============================================================
# Row 4: ④ R2
# ============================================================
dot.node("h4", "④  batch → R2 アップロード", shape="plaintext", fontsize="13", fontname="Helvetica Neue Bold")

dot.node("r2", "CLOUDFLARE R2\nopen-regime-backup\n─────────────────\ndb/   → *_db_*.sql.gz\nlogs/ → *_logs_*.tar.gz\n─────────────────\n7 日保持 → 自動削除", fillcolor="#ffcdd2", color="#c62828")

# ============================================================
# Row 5: 注意 + 凡例
# ============================================================
dot.node("warn", "⚠ 二重ローテ防止\nnginx, batch cron → logrotate (ホスト)\napi-go → lumberjack (アプリ)\napi-python → RotatingFileHandler (アプリ)\n同じファイルに両方 → ログ消失", fillcolor="#fff9c4", color="#f9a825", shape="note", fontsize="9")

# ============================================================
# Rank 制御 (段を揃える)
# ============================================================
# Row 1: コンテナ横並び
with dot.subgraph() as r:
    r.attr(rank="same")
    r.node("nx"); r.node("go"); r.node("py")

# Row 2: ログ横並び
with dot.subgraph() as r:
    r.attr(rank="same")
    r.node("lnx"); r.node("lgo"); r.node("lpy"); r.node("lbt"); r.node("host_label")

# Row 3: batch + pg + cron
with dot.subgraph() as r:
    r.attr(rank="same")
    r.node("cron"); r.node("batch"); r.node("pg")

# ============================================================
# Edges
# ============================================================

# 段の順序 (invisible)
dot.edge("h1", "h2", style="invis")
dot.edge("h2", "nx", style="invis")
dot.edge("lnx", "h3", style="invis")
dot.edge("h3", "batch", style="invis")
dot.edge("batch", "h4", style="invis")
dot.edge("h4", "r2", style="invis")
dot.edge("r2", "warn", style="invis")

# コンテナ → ログ (mount)
dot.edge("nx", "lnx", label="mount", color="#1565c0", penwidth="1.5")
dot.edge("go", "lgo", label="mount", color="#1565c0", penwidth="1.5")
dot.edge("py", "lpy", label="mount", color="#1565c0", penwidth="1.5")

# cron → batch
dot.edge("cron", "batch", label="docker compose\nrun --rm batch", color="#00897b", penwidth="2", style="bold")

# batch → ログ読取り
dot.edge("batch", "lnx", label="読取", color="#00897b", style="dashed", constraint="false")
dot.edge("batch", "lgo", label="読取", color="#00897b", style="dashed", constraint="false")
dot.edge("batch", "lpy", label="読取", color="#00897b", style="dashed", constraint="false")
dot.edge("batch", "lbt", label="mount", color="#00897b", style="dashed", constraint="false")

# batch → pg
dot.edge("batch", "pg", label="pg_dump\n(Docker network)", color="#7b1fa2", style="dashed")

# batch → R2
dot.edge("batch", "r2", label="rclone copy\ntar.gz + sql.gz", color="#c62828", penwidth="2", style="bold")

out = dot.render("/Users/ryu/Desktop/投資/open-regime/arch_log_collection", cleanup=True)
print(f"Done: {out}")
