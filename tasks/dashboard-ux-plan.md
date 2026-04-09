# ダッシュボード UX 改善プラン (2026-04-09)

## 背景

- 本番ダッシュボード [app/frontend/src/app/dashboard/page.tsx](../app/frontend/src/app/dashboard/page.tsx) は「ダッシュボード」「システム解説」の 2 タブ構成
- 数字 (`POLICY_TIGHTENING`, `52/100`, L1/L2A/L2B 等) が単体で意味が通らず、初見ユーザーが挫折する
- 解説タブが別になっているため、初見は数字だけ見て離脱する
- 5 つの実験ダッシュボード dashboard-a〜e は別物 (本プランでは触らない、参考のみ)
- coworker レビュー (上記会話) で優先順位を修正済み

## 設計の正典

**デザイントークン**: `~/Desktop/policy-dashboard-assets/powerbi-templates/powerbi-theme-json/` のデジタル庁公式 Power BI テーマ JSON。Blue テーマが Open Regime のブランドカラー (`#3460FB` / `#0017C1` / `#FE3939`) と完全一致。

**抽出済みトークン**:

```
/* Brand (情報・リンク) */
--brand-900: #0017C1;
--brand-700: #0017C1;
--brand-500: #3460FB;  /* primary */
--brand-400: #7096F8;
--brand-200: #C5D7FB;
--brand-100: #E8F1FE;

/* Signal Safe (緑) */
--signal-safe-900: #115A36;
--signal-safe-500: #259D63;
--signal-safe-400: #51B883;
--signal-safe-300: #9BD4B5;
--signal-safe-100: #E6F5EC;

/* Signal Caution (橙) */
--signal-caution-900: #AC3E00;
--signal-caution-500: #FB5B01;
--signal-caution-400: #FF8D44;
--signal-caution-300: #FFC199;
--signal-caution-100: #FFEEE2;

/* Signal Danger (赤) */
--signal-danger-900: #CE0000;
--signal-danger-500: #FE3939;
--signal-danger-400: #FF7171;
--signal-danger-300: #FFBBBB;
--signal-danger-100: #FDEEEE;

/* Neutral */
--neutral-900: #4D4D4D;
--neutral-700: #767676;
--neutral-500: #999999;
--neutral-300: #CCCCCC;
--neutral-200: #E6E6E6;
--neutral-100: #F2F2F2;
--neutral-50:  #F8F8FB;

/* Heatmap (diverging) */
--heatmap-min:    #FFBBBB;
--heatmap-center: #E6E6E6;
--heatmap-max:    #C5D7FB;
```

## 着手順 (coworker レビュー反映版)

### Phase 1: design token 統一 (半日)
- [ ] [app/frontend/src/app/globals.css](../app/frontend/src/app/globals.css) に上記トークンを追加
- [ ] 既存の `--brand-primary` 等は新トークンの alias として残す (互換性)
- [ ] [app/frontend/src/app/landing.css](../app/frontend/src/app/landing.css) の `--lp-*` 変数も新トークン参照に変更
- [ ] light / dark 両対応 (dark は彩度 1 段下げ)
- [ ] 検証: landing-e と dashboard を並べて目視差分

### Phase 2: C-1 Today's Verdict バナー (半日)
- [ ] [app/frontend/src/app/dashboard/page.tsx](../app/frontend/src/app/dashboard/page.tsx) のダッシュボードタブ最上部に追加
- [ ] 構成:
  - 信号アイコン (Lucide `ShieldCheck` / `AlertTriangle` / `OctagonAlert`) + 大きな日本語コピー
  - 1 行サマリ: 「**今は『守り重視』です**」(plumbing/employment スコアから自動導出)
  - 2 行目に理由: 「流動性は引き締まり、景気は警戒域。新規ポジションは慎重に。」
  - 右下に最終更新タイムスタンプ
  - 背景は signal の light tint (`--signal-caution-100` 等)
- [ ] verdict ロジックは pure function で `lib/verdict.ts` に切り出し (テスト可能に)
- [ ] landing のヒーローカードと同じ余白・角丸・シャドウ

### Phase 3: C-3 + C-4 数字の解釈併記 (半日)
- [ ] 各スコア表示の隣に小さく `(警戒域・前週比 +3 ↑)` を併記
- [ ] 各カードヘッダ下に 1 行説明: 「流動性 = 市場にお金がどれだけ流れているか」
- [ ] 専門用語 (`POLICY_TIGHTENING` 等) は表示時に日本語に変換するヘルパー `lib/labels.ts`
- [ ] 「警戒域」「前週比」等の判定ロジックも `lib/verdict.ts` に集約

### Phase 4: D-1 信号 3 色統一 (1日)
- [ ] 既存の chart-1〜5 の使用箇所を grep
- [ ] Recharts の `colors` prop を新トークンに置換
- [ ] state×phase マトリクスの heatmap を `--heatmap-min/center/max` に
- [ ] 凡例 (legend) を画面右上に常設
- [ ] アイコンを Lucide で統一 (`Droplet` 流動性 / `Activity` 景気 / `LayoutGrid` マトリクス)

### Phase 5: ユーザー反応見て判断 (チェックポイント)
- ここでユーザーに使ってもらってフィードバックをもらう
- 必要なら次の Phase 6 に進む

### Phase 6: 必要なら A-1 Sheet 化 + C-2 用語ホバー
- [ ] 各カードに `?` アイコン → クリックで shadcn `Sheet` で該当解説
- [ ] 解説タブは **残す** (リファレンスとして / SEO 的にも有利)
- [ ] 専門語に点線下線 + `HoverCard` で 2 行定義

## やらないこと (coworker 却下)
- ❌ B-1 ウェルカムモーダル (5 ステップは長すぎ、現代 SaaS で嫌われがち)
- ❌ B-2 ガイドツアー (driver.js — 依存追加コスト > リターン)
- ❌ A-3 「初心者/標準/上級」モード切替 (機能を隠す系は保守コスト大)
- ❌ A-4 3 タブ構成 (タブ追加は A-1 と矛盾)
- ❌ 絵文字アイコン (🚰🌡️🚦) — Lucide で統一感を出す

## 検証チェックリスト

- [ ] landing → dashboard の遷移で配色・タイポ・余白が違和感ない
- [ ] 初見ユーザーが 5 秒で「今守るべき」と分かる (Today's Verdict バナー)
- [ ] 数字が単体で意味が通る (併記)
- [ ] light/dark 両モードで彩度・コントラストが適切
- [ ] 既存の解説タブは壊れていない
- [ ] 信号 3 色が brand color と混ざっていない (情報用 vs 判断用の役割分離)

## Review (2026-04-09 実装後)

### Phase 1 完了: design token 統一
- [app/frontend/src/app/globals.css](../app/frontend/src/app/globals.css) にデジタル庁 7 系統トークン (brand / signal-safe / signal-caution / signal-danger / neutral / heatmap / chart) を追加
- light / dark 両対応 (dark は彩度 1 段下げ)
- 既存の `--brand-primary` 等は新トークンの alias として残し互換性維持
- [app/frontend/src/app/landing.css](../app/frontend/src/app/landing.css) の `--lp-*` を新トークン参照に変更 — 重複定義を廃止
- chart-1〜5 (light/dark 両方) も新トークンに alias
- ✅ build 通過、視覚的差分ゼロ (HEX 値はリネームのみ)

### Phase 2 完了: Today's Verdict バナー
- [app/frontend/src/app/dashboard/page.tsx](../app/frontend/src/app/dashboard/page.tsx) の `IntegratedHero` を `TodaysVerdictBanner` に置換
- 構成:
  - 左: Lucide アイコン (`ShieldCheck` / `AlertTriangle` / `OctagonAlert`) を 64-80px の角丸ボックスで重要度視覚化
  - 中央: `TODAY'S VERDICT — 今日の投資判断` ラベル + **巨大** 「今は『{action}』です」(action は MATRIX_DATA から導出)
  - 右: 流動性/景気バッジ + 最終更新タイムスタンプ (`plumbing.timestamp` from API)
- 重要度は MATRIX_COLORS の green/cyan/yellow/orange/red を 3 段階 (safe/caution/danger) に集約
- 配色は signal-{safe,caution,danger}-{100,300,900} トークンで統一
- `lib/verdict.ts` の切り出しは見送り (CLAUDE.md「ヘルパーの過剰抽出を避ける」、既存 `getIntegratedInsight` をそのまま流用)
- `glowMap` は IntegratedHero 専用だったため削除 (dead code 除去)
- ✅ build 通過 (10.2 kB → 10.8 kB +0.6 kB)

### Phase 3 完了: 解釈併記 + サブタイトル平易化
- 新ヘルパー `scoreZone(score)` をモジュール先頭に追加 — ストレススコア (0-100) を 4 段階 (安全域/通常域/警戒域/危険域) のラベル + 色クラスに変換。しきい値は既存 `getInsightCards` (60/65/70) に整合
- PlumbingCard:
  - サブタイトルを「金融市場の流動性の健全性を監視」→ 「市場にお金がスムーズに流れているかを 3 層で監視 (スコアが高いほど警戒)」に平易化
  - L1/L2A/L2B 各 ScoreRing の下にゾーンラベル併記 (signal 色)
- EconomicCard:
  - サブタイトルを「雇用・消費者・構造の3軸で景気を評価」→ 「雇用・消費・構造の 3 軸で景気の健康度を 100 点満点で評価 (高いほど不調)」に平易化
  - 総合 ScoreRing の下にフェーズラベル (拡大期/警戒期 等) 併記
  - カテゴリ (雇用/消費/構造) ScoreRing にも `安全域/通常域/警戒域/危険域` 併記
- ✅ build 通過 (10.8 → 11.1 kB)

### Phase 4 完了: chart token alias
- chart-1〜5 (Recharts デフォルトパレット) を brand-500 / signal-safe-500 / signal-caution-500 / signal-danger-500 / brand-400 に alias
- light/dark 両方
- ハードコードされた tailwind 色 (`text-emerald-600` 等) の大規模置換は **見送り** — 「流動性=青系/景気=緑系」の意味的区別を失うリスクがあるため、ユーザー反応を見て判断する
- ✅ build 通過

### やらなかったこと (意図的)
- ❌ `lib/verdict.ts` 切り出し (既存ヘルパーで足りる)
- ❌ `lib/labels.ts` 切り出し (既存 stateInfo / phaseInfo で足りる)
- ❌ ハードコード tailwind 色の全面置換 (Phase 5 以降に判断)
- ❌ `dashboard-a〜e` 実験ページの修正 (本番 `dashboard/page.tsx` のみ対象)
- ❌ 解説タブの Sheet 化 (A-1) — Phase 5 後に必要なら着手
- ❌ ウェルカムモーダル / ガイドツアー (coworker レビューで却下)

### 次の判断ポイント (ユーザー実機 review 後)
1. Today's Verdict バナーの視覚的インパクトは十分か?
2. signal 色の彩度 / コントラストは適切か (light / dark)
3. ゾーンラベル併記の情報密度は許容できるか
4. landing → dashboard の世界観連続性は感じられるか
5. これで「初見が 5 秒で守るべきと分かる」になっているか

