# Lessons Learned

## 2026-02-28: Supabase JWT uses ES256, not HMAC

**Problem**: `require_auth` was using `SUPABASE_JWT_SECRET` (HMAC shared secret) to verify JWTs, but Supabase signs JWTs with **ES256 (ECDSA)** — an asymmetric algorithm that uses a public/private key pair.

**Symptoms**: `InvalidAlgorithmError: The specified alg value is not allowed` when the backend tried to verify any JWT from Supabase Auth. This caused 401 responses on all `require_auth` endpoints, triggering the frontend's signOut→redirect loop.

**Root cause**: The `SUPABASE_JWT_SECRET` in Supabase Dashboard is the HMAC secret for legacy compatibility. Modern Supabase projects use ES256 by default. The JWT header's `alg` field is `"ES256"`, not `"HS256"`.

**Fix**: Use `PyJWKClient` to fetch the public key from `{SUPABASE_URL}/auth/v1/.well-known/jwks.json` for asymmetric algorithms (ES/RS/PS), with HMAC fallback for HS256.

**Rule**: Always check the JWT header `alg` field before choosing a verification strategy. Never assume HMAC — Supabase (and many identity providers) use asymmetric algorithms by default.

## 2026-02-28: 401 redirect loops need circuit breakers

**Problem**: Frontend SWR fetcher and fetchAPI both had `if (response.status === 401) { signOut(); redirect('/login/') }` without any loop prevention. If the JWT is permanently invalid, every API call triggers signOut+redirect endlessly.

**Fix**: Added module-level `_isRedirecting` flag in `auth-store.ts`. Once a 401 redirect is initiated, further 401s are suppressed until the next successful login sets a new token.

**Rule**: Any automatic redirect triggered by auth failure MUST have a circuit breaker to prevent infinite loops.

## 2026-03-01: セキュリティ修正は段階的にリスクゼロから

**Problem**: 前回の JWT 修正で全認証が壊れた。セキュリティ修正は「正しいこと」を
していても、既存の動作フローを壊すリスクが高い。

**Approach**: 修正をリスクレベルで分類して実装順序を決定:
1. リスクゼロ（情報漏洩防止、ヘッダー追加） → 先に
2. 中リスク（ミドルウェア強化） → 次に
3. 高リスク（認証ロジック変更） → 最後に、最小差分で

**Rule**: セキュリティ修正は「else if 1 ブロック追加」のような最小差分を心がける。
既存のコードパスを変更するのではなく、新しい分岐を追加して拒否する。

## 2026-03-01: 監査レポートの鮮度に注意

**Problem**: 2/28 監査で C2（issuer）と C3（キャッシュキー）を Critical と報告したが、
3/1 の移行時にすでに修正されていた。古い監査結果をそのまま信じて
「修正が必要」と判断すると、不要な変更で壊すリスクがある。

**Rule**: セキュリティ修正前に必ず実コードを読んで現状を確認する。
監査レポートの指摘箇所を実際のコードと照合し、修正済みかどうか判定してから着手。

## 2026-03-21: Confidence/Scoring の初期値はバックテストで検証してから決める

**Problem**: BOS Confidence の NONE grade を base=0.4 に設定したが、バックテストで
NONE trades が win=57.5%, avg=+17.35% と判明。0.4*0.5=0.20 の confidence は
ポジションサイズを80%カットし、最も勝率の高いグループを最も罰していた。

**Fix**: GRADE_SCORE[NONE] を 0.4→0.9 に変更（confidence: 0.20→0.45）。
weighted return が 11.29%→14.15% に改善。

**Rule**: 新しいスコアリングやペナルティ係数を導入するときは、まず「ペナルティなし」で
バックテストし、各カテゴリの実績を確認してから係数を決める。直感で決めない。

## 2026-03-21: OTE/OBは日足では表示専用

**Problem**: OTE zone entry を日足バックテストした結果、avg 19.77%→9.79%、
win% 54.1%→45.1% と大幅悪化。OTEゾーンが広すぎて96.6%の確率でヒットし、
エントリー価格が下がる → ATR Floor が狭まる → ハードストップ増加。

**Rule**: SMC/ICT概念（OTE, OB, FVG）は本来4H/1Hの概念。日足で自動エントリー
調整に使うと逆効果。チャートマーカー（情報表示）としてのみ使用する。

## 2026-03-21: Exit改善は「タイミング調整」が最も効果的

**Problem**: 6つのExit/Entry改善案を個別バックテスト → 組み合わせバックテストした。
構造変更（Trail base変更、新条件追加）より、既存ロジックのタイミング微調整が圧倒的に効果的。

**Findings**:
- Fix1 (ATR Floor Low→Close): ヒゲ貫通の誤発動33%削減。最も単純で最も効果大
- Fix3 (CHoCH 50%利確): 全損回避しつつトレンド継続リターンを維持
- Fix6 (Entry Close→Open): Open平均1.92%安い → 全指標改善。コスト0の改善
- Fix4 (Trail base変更): 逆効果。highest weight増加 → ノイズで早期Exit

**Rule**: Exit改善はまず「判定価格の変更」「部分Exit」「エントリータイミング」を検討する。
新しい条件追加やパラメータ構造変更は複雑性に見合う効果が出にくい。

## 2026-03-21: 組み合わせバックテストで相互作用を必ず検証

**Problem**: 個別テストでは Fix1 が最優秀だったが、Fix1+Fix6 (PatA) より
Fix1+Fix3+Fix6 (PatB) の方が win% +13.6, PF +4.48, MaxDD -42% と大幅改善。
個別では微小だった Fix3 が Fix1 と組み合わせると相乗効果を発揮。

**Rule**: 改善案が複数あるときは、個別テスト結果だけで採否を決めず、
有望な組み合わせのバックテストを必ず実施する。相互作用で結果が大きく変わる。

## 2026-04-09: UX改善は「最小工数で最大インパクト」を最初に置く

**Problem**: ダッシュボード UI 改善の優先順位を「A-1 解説タブ廃止 + Sheet 化」を 1 番目に
置いてしまった。coworker レビューで「順番が逆。C-1 (Today's Verdict バナー) を最初に」と
指摘された。

**Why it was wrong**:
- A-1 は構造リファクタで工数大、効果が出るまで時間がかかる
- C-1 はバナー 1 個追加で 5 秒で「今どうすべきか」が伝わる最大インパクト
- C-1 を入れれば A-1 が本当に必要か判断できる
- 大規模リファクタを先に入れると後戻りができない

**Rule**: UX/UI 改善案を並べるときは「**工数 / インパクト** 比」で並べ、最小工数で
最大効果が出る案を必ず 1 番目に置く。構造リファクタは「小さい改善で 7 割解決した後で
残り 3 割のために必要か」を判断してから着手する。

## 2026-04-09: モーダル/ツアーは最終手段、まず情報設計で解決

**Problem**: 初見ユーザーオンボーディングとして「ウェルカムモーダル 5 ステップ」「ガイドツアー
(driver.js)」「3 モード切替」を提案したが、coworker から「全部やらない方がいい」と却下された。

**Why it was wrong**:
- モーダルは現代 SaaS で嫌われ気味、5 ステップは長すぎて逆効果
- ツアー系は依存追加コスト・保守コストが高く、リターン低い
- モード切替は「機能を隠す系」で保守コスト大、使われない可能性大
- 同じ目的は **情報設計** (バナー + 用語併記 + 1 行説明) で 95% 達成できる

**Rule**: オンボーディングを設計するとき、まず「画面そのものを自己説明的にする」を試す
(バナー、併記、ツールチップ)。それで足りない場合だけモーダル/ツアーを検討する。
最初からモーダル/ツアーを提案しない。

## 2026-04-09: 親プロジェクトの design token を必ず先に抽出する

**Problem**: ダッシュボードの色を提案するとき、いきなり「緑/黄/赤の信号 3 色を CSS 変数化」と
言った。coworker から「landing-e のトークンに揃えるのが本質」と指摘された。さらに
ユーザーから「Desktop の policy-dashboard-assets を見て」と教えられ、デジタル庁の
公式デザイントークンが手元にあったことが発覚。

**Why it was wrong**:
- landing.css と globals.css の重複・整合性確認をしないまま色を提案した
- プロジェクト外の参考リソース (Desktop/policy-dashboard-assets) の存在を確認しなかった

**Rule**: 色やトークンを提案する前に必ず:
1. 既存の `*.css` ファイルから現状のトークンを grep
2. プロジェクト外でも `Desktop/`, `~/.config/` 等にデザインリソースがないか聞く
3. 親ブランド (landing) と子画面 (dashboard) のトークンを統一する設計を提案する

## 2026-03-21: サイズ調整は新ベースラインで必ず再検証する

**Problem**: V10ベースラインではBOS Confidence（NONEのサイズカット）が「理論的に正しく」
見えたが、PatB（V12）ベースラインで再検証したところ逆効果だった。
- Fix3（部分Mirror）がREVERSALの大勝ち振れ幅を抑えた結果、REVERSAL vs NONEの優位性が薄まった
- NONEの勝率(69.5%)がREVERSAL(65.6%)を上回り、サイズカットが純粋にリターンを削るだけに
- weighted avg -5.53%, PF変化なし(+0.09) → 逆効果

**Fix**: Confidenceによるサイズ調整を無効化。BOS Gradeは情報表示のみに変更。

**Rule**: Entry/Exitロジックを変更したら、その上に乗るサイズ調整・スコアリングを
必ず新ベースラインで再検証する。旧ベースラインでの検証結果は無効になりうる。
