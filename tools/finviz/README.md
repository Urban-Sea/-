# tools/finviz/ — open-regime Discovery Phase A

全米株 ~7000 銘柄から「優秀な候補」を毎日スクリーニングして JSON で保存する
ローカル専用ツール。open-regime の構造シグナル (BOS/CHoCH/OB/OTE) に流す
ファネルの第一段。

> **重要**: このツールは **ローカル専用**。VPS では動かしません。
> 詳細: [tasks/finviz-discovery-plan.md](../../tasks/finviz-discovery-plan.md)

## なぜ tools/ 配下か

`scripts/` は `.github/workflows/deploy-vps.yml` の paths-filter で本番 VPS に
SCP される production ops 専用ディレクトリです。`tools/` は paths-filter 対象外
なので、ここに置いたファイルは git で管理されつつ VPS には一切デプロイされません。

## セットアップ (初回のみ)

```bash
cd ~/Desktop/投資/open-regime

# venv 作成 (標準ライブラリ、追加ツール不要)
python3 -m venv tools/finviz/.venv

# アクティベート
source tools/finviz/.venv/bin/activate

# 依存 install
pip install -r tools/finviz/requirements.txt
```

`.venv/` は root の `.gitignore` でカバー済 (`venv/`, `.venv/`)。

## 毎朝の実行

```bash
source tools/finviz/.venv/bin/activate
python tools/finviz/finviz-scan.py
```

→ `tools/finviz/output/YYYY-MM-DD.json` に保存される (gitignored)。
ターミナルに上位 15 銘柄が表で表示される。

## CLI オプション

| フラグ | デフォルト | 説明 |
|---|---|---|
| `--preset NAME` | `all` | `momentum` / `pullback` / `quality` / `breakout` / `sustained` / `all` |
| `--top N` | `50` | グローバル top N で件数キャップ |
| `--threshold FLOAT` | `1.5` | `finviz_score >=` の閾値 |
| `--output PATH` | `output/YYYY-MM-DD.json` | 出力 JSON のパス |
| `--dry-run` | off | ターミナル表示のみ、JSON 保存しない |
| `--verbose` | off | finviz の進捗バー + DEBUG ログ |
| `--quiet` | off | WARNING/ERROR 以外抑制 (将来 GH Actions 用) |
| `--presets-file PATH` | `presets.yml` | プリセット定義 YAML の場所 |

引数は全て **環境変数でも渡せます** (`FINVIZ_PRESET`, `FINVIZ_TOP`,
`FINVIZ_THRESHOLD`)。Phase D で GH Actions に移す際にコード変更不要にするため。

### よく使うパターン

```bash
# 全プリセット、JSON 保存 (毎朝の標準)
python tools/finviz/finviz-scan.py

# Discount Zone 候補だけ確認 (Phase A の磨き込み中)
python tools/finviz/finviz-scan.py --preset pullback --dry-run

# トップ 10 だけ
python tools/finviz/finviz-scan.py --top 10 --dry-run

# 閾値を厳しく
python tools/finviz/finviz-scan.py --threshold 2.0
```

## ファイル構成

```
tools/finviz/
├── finviz-scan.py     # CLI エントリポイント
├── presets.yml        # 4 プリセット定義 + スコアリング重み (調整はここ)
├── _parsers.py        # finviz 文字列 → float 変換 (一番壊れやすい層)
├── _scanner.py        # finvizfinance ラッパー (Phase B でも再利用)
├── _scorer.py         # スコアリング + 件数キャップ (top 50 + Discount floor)
├── _output.py         # JSON 書き出し + ターミナル表示
├── requirements.txt   # 依存 (finvizfinance==1.3.0 ピン留め)
├── README.md          # このファイル
└── output/            # スキャン結果 (JSON / log は gitignored)
    ├── .gitkeep
    └── .gitignore
```

## スコアリング

```
finviz_score = 1.0 * in_uptrend          (SMA200 上)
             + 0.8 * near_52w_high       (52W High からの距離 0-10% 線形)
             + 0.6 * (rel_volume > 1.5)
             + 0.5 * rsi_pullback        (30 < RSI < 50)
             + 0.4 * quality_fundament   (ROE > 15% かつ Debt/Eq < 1.0)
             + 0.7 * sustained_uptrend   (SMA20>50>200 整列 0.6 + 半年+30% 0.4)
# 0.00 - 4.00 の連続値
```

重みは [presets.yml](presets.yml) の `scoring.weights` で上書き可。
プリセットによって取れるカラムが違う(technical では SMA/RSI、financial では
ROE/ROA)ので、欠損カラムは **0 加点として扱う** (None ペナルティではない)。
これにより複数プリセットにヒットした銘柄ほどスコアが上がる仕組み。

## 件数管理

```
1. 4プリセット並列実行 → UNION → unique ticker 集合
2. finviz_score 計算
3. threshold (1.5) でフィルタ
4. スコア降順ソート
5. グローバル top 50 を取る
6. top 50 内の pullback (Discount) 由来が 5 未満なら、
   top 50 外の pullback 上位を入れて、top 50 の最下位 (非pullback) を追い出す
   → "Discount floor" は床 (5件保証) であって枠ではない
```

`--top N` で `N < 5` を指定した場合、Discount floor は無効化されます (warning)。

## トラブルシューティング

### `pip install -r requirements.txt` でエラー

Python 3.9 以上が必要です (`python3 --version` で確認)。

### exit code 2 で終了する

データ品質チェック失敗 (全件 0 か全プリセット失敗)。原因の可能性:
- FinViz の HTML が変更された → `pip install -U finvizfinance` で復旧を試す
- ネットワーク障害 / FinViz レート制限 → 数分待ってリトライ
- プリセット定義の typo → `--verbose` で具体的なエラーを確認

詳細は `tools/finviz/output/scan.log` を確認。

### `tools/finviz/output/scan.log` が肥大化

5MB × 3 世代で自動ローテします。手動削除は不要。

## Phase B 以降との接続点

このツールが書き出す JSON は、Phase B で実装する
`POST /api/admin/discovery/upsert` の HTTP body と同じ形です:

```json
{
  "scan_date": "2026-04-10",
  "tickers": [
    {"ticker": "PVH", "presets": ["momentum", "breakout"], "finviz_score": 2.4, "fundament": {...}}
  ]
}
```

将来的には:
- **Phase B**: `tools/finviz/finviz-publish.py` を追加 (`_scanner.py` を再利用) ✅
- **Phase C**: open-regime frontend に Discovery タブ
- **Phase D**: GitHub Actions cron で自動化 (CLI と環境変数でそのまま動く設計) ✅

詳細: [tasks/finviz-discovery-plan.md](../../tasks/finviz-discovery-plan.md)

## GitHub Actions 自動実行 (Phase D, 2026-04-15 稼働開始)

`.github/workflows/daily-finviz.yml` が JST 7:30 (UTC 22:30) 月〜金 に自動実行し、
全 5 プリセットをスキャン → VPS (`https://open-regime.com/api/discovery/upsert`)
に POST して `discovered_stocks` テーブルを更新します。

### なぜ VPS ではなく GitHub Actions なのか

- Finviz の ToS はスクレイピング禁止 → IP BAN リスクがある
- VPS 固定 IP だと BAN 後の復旧が面倒 (IP 変更、プロキシ設定)
- GitHub Actions は毎回異なる IP なので BAN されにくく、仮にされても即復活
- VPS (Sakura 1GB) のメモリを消費しない

### 必要な GitHub Secrets

```bash
gh secret set OPEN_REGIME_API_URL        -b 'https://open-regime.com'
gh secret set OPEN_REGIME_PUBLISH_TOKEN  -b '<VPS /opt/open-regime/.env の PUBLISH_TOKEN>'
# CF Access service token は現在不要 (api.open-regime.com は bypass 設定済み)
# 必要になったら:
# gh secret set CF_ACCESS_CLIENT_ID     -b '<service token client id>'
# gh secret set CF_ACCESS_CLIENT_SECRET -b '<service token client secret>'
```

### 手動トリガー

```bash
# dry-run (publish スキップ、JSON 生成のみ) — 初回テスト用
gh workflow run daily-finviz.yml -f dry_run=true

# 実 publish (デフォルト)
gh workflow run daily-finviz.yml

# パラメータ上書き
gh workflow run daily-finviz.yml -f top=100 -f threshold=1.8
```

### 結果の確認

```bash
# artifact (JSON) ダウンロード
gh run list --workflow=daily-finviz.yml --limit 1
gh run download <RUN_ID> --dir /tmp/finviz-test

# VPS 側で受信確認
curl -s -H 'X-Requested-With: XMLHttpRequest' \
  https://open-regime.com/api/discovery/today | jq '.scan_date, (.tickers | length)'
```

### CSRF ヘッダー注意

`api-go/internal/middleware/csrf.go` が POST に `X-Requested-With` を要求します。
`finviz-publish.py` は自動で付けますが、curl で手動テストする時は必須:

```bash
curl -H 'X-Requested-With: XMLHttpRequest' ...
```

## ライセンス / 帰属

このツール自体は open-regime プロジェクトの一部 (リポのライセンスに従う)。
依存している `finvizfinance` は **lit26 (Tianning Li)** 作の MIT ライブラリで、
PyPI から配布されています:
- PyPI: https://pypi.org/project/finvizfinance/
- GitHub: https://github.com/lit26/finvizfinance
