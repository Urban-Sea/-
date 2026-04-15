"""
図1: 概念レベル — Human → Cloudflare → VPS → External
テキストのみ、アイコンなし
"""
import graphviz

dot = graphviz.Digraph("concept", format="png", engine="dot")
dot.attr(
    rankdir="LR",
    bgcolor="#ffffff",
    fontname="Helvetica Neue",
    fontsize="20",
    pad="0.6",
    nodesep="1.2",
    ranksep="1.8",
    dpi="200",
    label="Open Regime — Request Flow (概念図)",
    labelloc="t",
    labeljust="c",
)
dot.attr("node", fontname="Helvetica Neue", fontsize="14", style="filled,rounded", shape="box", margin="0.3,0.2")
dot.attr("edge", fontname="Helvetica Neue", fontsize="11")

# Nodes
dot.node("user", "ユーザー\n(ブラウザ)", fillcolor="#e3f2fd", color="#1565c0", penwidth="2")
dot.node("cf", "CLOUDFLARE\n\nDNS Proxy / WAF / DDoS\nSSL Full (Strict)\nCF Access (admin)", fillcolor="#fff3e0", color="#f57c00", penwidth="2")
dot.node("vps", "SAKURA VPS 1GB\n\n7 Docker コンテナ\nNGINX → API → DB\nBatch (cron)", fillcolor="#e8f5e9", color="#2e7d32", penwidth="2.5", shape="box3d")
dot.node("ext", "外部サービス\n\nGoogle OAuth\nCloudflare R2 (Backup)\nStripe (scaffold)", fillcolor="#fce4ec", color="#c62828", penwidth="2")
dot.node("mkt", "マーケットデータ\n\nYahoo Finance (yfinance)\nFRED API (Fed データ)", fillcolor="#e0f7fa", color="#00838f", penwidth="2")
dot.node("cicd", "GITHUB ACTIONS\n\ndocker save → SCP\nヘルスチェック\n自動ロールバック", fillcolor="#eceff1", color="#546e7a", penwidth="1.5")

# Edges
dot.edge("user", "cf", label="HTTPS", color="#f57c00", penwidth="2.5", style="bold")
dot.edge("cf", "vps", label="Origin Cert :443", color="#2e7d32", penwidth="2.5", style="bold")
dot.edge("vps", "ext", label="OAuth / Backup", color="#c62828", penwidth="1.5", style="dashed")
dot.edge("vps", "mkt", label="株価 / 経済指標", color="#00838f", penwidth="1.5", style="dashed")
dot.edge("cicd", "vps", label="SCP deploy", color="#546e7a", penwidth="1.5", style="dashed")

out = dot.render("/Users/ryu/Desktop/投資/open-regime/arch_1_concept", cleanup=True)
print(f"Done: {out}")
