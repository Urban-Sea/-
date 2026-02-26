export interface GlossaryTerm {
  term: string;
  reading?: string;
  definition: string;
  category: 'liquidity' | 'employment' | 'signals' | 'general';
}

export const glossaryTerms: GlossaryTerm[] = [
  // Liquidity / Plumbing
  { term: 'Layer 1 (L1)', category: 'liquidity',
    definition: 'FRBの政策流動性。SOMA残高、準備預金、RRP、TGAの4指標からストレスを算出。' },
  { term: 'Layer 2A (L2A)', category: 'liquidity',
    definition: '銀行システムの健全性。銀行準備預金、KRE（地銀ETF）、SRF利用状況、IG格付けスプレッドを監視。' },
  { term: 'Layer 2B (L2B)', category: 'liquidity',
    definition: '市場レバレッジ。マージンデット（信用取引残高）の2年変化率でバブルリスクを測定。' },
  { term: 'SOMA', category: 'liquidity',
    definition: 'System Open Market Account。FRBが保有する国債・MBSの総額。QE/QTの主要指標。' },
  { term: 'RRP', reading: 'リバース・レポ', category: 'liquidity',
    definition: '金融機関がFRBに資金を預ける仕組み。残高減少は市場への資金流入を示唆。' },
  { term: 'TGA', reading: '財務省一般勘定', category: 'liquidity',
    definition: '米財務省のFRB口座残高。増加は市場から資金を吸収、減少は放出。' },
  { term: 'QE / QT', category: 'liquidity',
    definition: '量的緩和(QE)=FRBが国債購入で資金供給。量的引き締め(QT)=FRBが保有資産を縮小。' },
  { term: 'SRF', reading: 'Standing Repo Facility', category: 'liquidity',
    definition: 'FRBが銀行に短期資金を供給する常設枠。利用増加は銀行の資金逼迫を示す。' },
  { term: 'IG スプレッド', category: 'liquidity',
    definition: '投資適格社債と国債の利回り差。拡大はクレジットリスクの上昇を示す。' },

  // Employment / Economic
  { term: 'サームルール', reading: 'Sahm Rule', category: 'employment',
    definition: '失業率の3ヶ月移動平均が過去12ヶ月の最低値から0.5%以上上昇するとリセッションを示唆。' },
  { term: 'NFP', reading: '非農業部門雇用者数', category: 'employment',
    definition: 'Non-Farm Payrolls。毎月第1金曜日発表。米国の雇用状況を示す最重要指標。' },
  { term: 'JOLTS', reading: '求人労働異動調査', category: 'employment',
    definition: '求人件数と離職率から労働市場の逼迫度を測定。求人/失業者比率が重要。' },
  { term: 'U3 / U6', category: 'employment',
    definition: 'U3=標準失業率。U6=不完全雇用を含む広義失業率。差の拡大は労働市場悪化。' },
  { term: 'ミシガン消費者信頼感', reading: 'UMCSENT', category: 'employment',
    definition: 'ミシガン大学が毎月発表。消費者のセンチメントを数値化。低下は消費減退を示唆。' },
  { term: '実質個人消費支出', reading: 'W875RX1', category: 'employment',
    definition: 'インフレ調整済みの個人消費。前年比で消費の実質的な伸びを評価。' },

  // Signals / Technical
  { term: 'BOS', reading: 'Break of Structure', category: 'signals',
    definition: '直近の高値/安値を更新した構造変化。トレンド継続のシグナル。' },
  { term: 'CHoCH', reading: 'Change of Character', category: 'signals',
    definition: 'トレンド転換シグナル。上昇中に安値割れ、または下落中に高値更新。' },
  { term: 'FVG', reading: 'Fair Value Gap', category: 'signals',
    definition: '3本のローソク足で形成される価格ギャップ。将来の反発・支持帯の候補。' },
  { term: 'EMA', reading: '指数移動平均', category: 'signals',
    definition: '直近の価格に重みを置く移動平均。8EMAと21EMAのクロスでトレンド判断。' },
  { term: 'RS', reading: 'Relative Strength', category: 'signals',
    definition: '個別銘柄のパフォーマンスをS&P500と比較。低下は市場平均を下回る弱さを示す。' },
  { term: 'OB', reading: 'Order Block', category: 'signals',
    definition: '大口注文が集中した価格帯。将来の反発ポイントとして機能しやすい。' },

  // General
  { term: 'レジーム', reading: 'Regime', category: 'general',
    definition: '流動性と景気の組み合わせから判定される市場環境。5段階で分類。' },
  { term: 'ストレススコア', category: 'general',
    definition: '各指標の異常度を0-100で数値化。0=正常、100=極度の異常。' },
  { term: 'リスクスコア', category: 'general',
    definition: '雇用(50点)+消費者(25点)+構造(25点)=100点満点の景気リスク評価。' },
  { term: 'フェーズ', category: 'general',
    definition: 'EXPANSION(0-20), SLOWDOWN(21-40), CAUTION(41-60), CONTRACTION(61-80), CRISIS(81-100)の5段階。' },
];

export const pageGlossaryMap: Record<string, string[]> = {
  '/':           ['general', 'liquidity', 'employment'],
  '/liquidity':  ['liquidity', 'general'],
  '/employment': ['employment', 'general'],
  '/signals':    ['signals', 'general'],
  '/holdings':   ['general'],
  '/settings':   ['general'],
};
