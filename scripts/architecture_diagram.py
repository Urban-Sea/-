"""
Open Regime — 全体アーキテクチャ図 (発表用)
diagrams ライブラリで生成
pip install diagrams / brew install graphviz
"""

from diagrams import Diagram, Cluster, Edge
from diagrams.onprem.client import Users
from diagrams.onprem.network import Nginx
from diagrams.onprem.compute import Server
from diagrams.onprem.database import PostgreSQL
from diagrams.onprem.inmemory import Redis
from diagrams.onprem.container import Docker
from diagrams.programming.language import Go
from diagrams.onprem.ci import GithubActions
from diagrams.programming.framework import FastAPI, React
from diagrams.saas.cdn import Cloudflare
from diagrams.generic.storage import Storage
from diagrams.generic.compute import Rack
import os

OUTPUT_DIR = "/Users/ryu/Desktop/投資/open-regime"
FILENAME = "open_regime_architecture"

graph_attr = {
    "fontsize": "24",
    "fontname": "Helvetica Neue",
    "bgcolor": "#fafafa",
    "pad": "0.8",
    "nodesep": "0.6",
    "ranksep": "1.0",
    "dpi": "200",
    "label": "Open Regime — Production Architecture (2026-04-10)",
    "labelloc": "t",
    "labeljust": "c",
}

node_attr = {
    "fontsize": "12",
    "fontname": "Helvetica Neue",
}

edge_attr = {
    "fontsize": "10",
    "fontname": "Helvetica Neue",
}

with Diagram(
    "",
    filename=os.path.join(OUTPUT_DIR, FILENAME),
    outformat="png",
    direction="TB",
    show=False,
    graph_attr=graph_attr,
    node_attr=node_attr,
    edge_attr=edge_attr,
):
    # ---- External: Users ----
    users = Users("Browser")

    # ---- Cloudflare Edge ----
    with Cluster("Cloudflare Edge", graph_attr={
        "bgcolor": "#fff3e0",
        "style": "rounded",
        "penwidth": "2",
        "pencolor": "#f57c00",
        "fontsize": "15",
        "fontcolor": "#e65100",
    }):
        cf = Cloudflare("DNS Proxy + WAF\nSSL Full(Strict)\nOrigin Cert")
        cf_access = Cloudflare("CF Access\nZero Trust (admin)")

    # ---- CI/CD ----
    github = GithubActions("GitHub Actions\ndocker save\n-> SCP -> load\n+ rollback")

    # ============================================
    # VPS
    # ============================================
    with Cluster(
        "Sakura VPS 1GB  |  Ubuntu 24.04  |  ~582MB / 896MB  |  swap 2GB  |  ~1,000 yen/mo",
        graph_attr={
            "bgcolor": "#e8f5e9",
            "style": "rounded",
            "penwidth": "3",
            "pencolor": "#2e7d32",
            "fontsize": "16",
            "fontcolor": "#1b5e20",
        },
    ):
        # -- nginx --
        nginx = Nginx("nginx :80/:443\nReverse Proxy\nHSTS / CSRF inject\nIP direct -> 444")

        # -- API Layer --
        with Cluster("API Layer", graph_attr={
            "bgcolor": "#e3f2fd",
            "style": "rounded",
            "penwidth": "1.5",
            "pencolor": "#1565c0",
            "fontsize": "13",
            "fontcolor": "#0d47a1",
        }):
            api_go = Go("api-go :8080\nEcho v4 / 75ep CRUD\nOAuth / JWT / MFA\ndistroless 64MB")
            api_py = FastAPI("api-python :8081\nFastAPI + yfinance\nSignal / Regime / Exit\n256MB")

        # -- Frontend Layer --
        with Cluster("Frontend Layer", graph_attr={
            "bgcolor": "#fff8e1",
            "style": "rounded",
            "penwidth": "1.5",
            "pencolor": "#f9a825",
            "fontsize": "13",
            "fontcolor": "#f57f17",
        }):
            frontend = React("frontend :3000\nNext.js 15 SSR\nopen-regime.com")
            admin = React("admin :3002\nNext.js 15 SSR\nadmin.open-regime.com")

        # -- Data Layer --
        with Cluster("Data Layer", graph_attr={
            "bgcolor": "#f3e5f5",
            "style": "rounded",
            "penwidth": "1.5",
            "pencolor": "#7b1fa2",
            "fontsize": "13",
            "fontcolor": "#4a148c",
        }):
            pg = PostgreSQL("PostgreSQL 16\n:5432 / 256MB\n16 tables")
            redis = Redis("Redis 7\n:6379 / 48MB\nLRU + appendonly")

        # -- Batch --
        batch = Docker("batch (cron)\nDaily: yfinance + FRED\nWeekly: FRB BS + Employment\nR2 backup: pg_dump + logs")

        # -- Logs --
        logs = Storage("JSON Logs\n/var/log/open-regime/\nnginx / api-go\napi-python / batch")

    # ---- External Services ----
    with Cluster("External Services", graph_attr={
        "bgcolor": "#fce4ec",
        "style": "rounded",
        "penwidth": "2",
        "pencolor": "#c62828",
        "fontsize": "15",
        "fontcolor": "#b71c1c",
    }):
        google = Server("Google\nOAuth 2.0")
        r2 = Cloudflare("CF R2\nBackup\n7 day retention")
        stripe = Rack("Stripe\n(scaffold)")

    # ---- Market Data ----
    with Cluster("Market Data", graph_attr={
        "bgcolor": "#e0f7fa",
        "style": "rounded",
        "penwidth": "2",
        "pencolor": "#00838f",
        "fontsize": "15",
        "fontcolor": "#006064",
    }):
        yfinance = Server("Yahoo Finance\nyfinance\n7000+ tickers")
        fred = Server("FRED API\nFed data\nEmployment")

    # ==============================
    # Edges
    # ==============================

    # -- Ingress: Browser -> CF -> nginx --
    users >> Edge(label="HTTPS", color="#f57c00", style="bold") >> cf
    users >> Edge(label="admin HTTPS", color="#f57c00", style="dashed") >> cf_access
    cf >> Edge(label="Origin :443", color="#2e7d32", style="bold") >> nginx
    cf_access >> Edge(label="Origin :443", color="#2e7d32", style="dashed") >> nginx

    # -- CI/CD -> VPS --
    github >> Edge(label="SCP deploy", color="#546e7a", style="dashed") >> nginx

    # -- nginx routing --
    nginx >> Edge(label="/api/signal,regime\n/api/exit,stock", color="#1565c0") >> api_py
    nginx >> Edge(label="/api/* CRUD", color="#1565c0") >> api_go
    nginx >> Edge(label="/ catch-all", color="#f9a825") >> frontend
    nginx >> Edge(label="admin.*", color="#f9a825", style="dashed") >> admin

    # -- API -> Data --
    api_go >> Edge(color="#7b1fa2") >> pg
    api_go >> Edge(color="#e53935", style="dashed") >> redis
    api_py >> Edge(color="#7b1fa2") >> pg
    api_py >> Edge(color="#e53935", style="dashed") >> redis

    # -- Batch -> Data --
    batch >> Edge(label="pg_dump / INSERT", color="#7b1fa2") >> pg
    batch >> Edge(label="cache warmup", color="#e53935", style="dashed") >> redis

    # -- Batch -> External --
    batch >> Edge(label="rclone", color="#c62828") >> r2
    batch >> Edge(label="OHLCV", color="#00838f") >> yfinance
    batch >> Edge(label="econ data", color="#00838f") >> fred

    # -- API -> External --
    api_go >> Edge(label="OAuth", color="#c62828", style="dashed") >> google
    api_go >> Edge(label="webhook", color="#c62828", style="dashed") >> stripe
    api_py >> Edge(label="realtime", color="#00838f", style="dashed") >> yfinance

    # -- Logs (all containers -> logs storage) --
    nginx >> Edge(color="#bdbdbd", style="dotted") >> logs
    api_go >> Edge(color="#bdbdbd", style="dotted") >> logs
    api_py >> Edge(color="#bdbdbd", style="dotted") >> logs
    batch >> Edge(color="#bdbdbd", style="dotted") >> logs
    logs >> Edge(label="tar.gz -> R2", color="#c62828", style="dashed") >> r2
