-- 事前計算結果テーブル
-- バッチ処理で計算した結果をJSONBで保存し、APIは単純なDB読み取りで返す
CREATE TABLE IF NOT EXISTS precomputed_results (
  key TEXT PRIMARY KEY,
  result JSONB NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 初期行を挿入（upsert用なので空でもOK）
-- キー: risk_score, plumbing_summary, market_events, policy_regime
