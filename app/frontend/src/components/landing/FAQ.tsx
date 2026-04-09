type Props = { variant?: "A" | "B" | "C" };

const ITEMS = [
  {
    q: "これは投資助言ですか?",
    a: "いいえ。Open Regime は分析ツールです。投資判断と結果はすべてご自身の責任になります。投資助言業に該当する個別推奨は行いません。",
  },
  {
    q: "対応銘柄は?",
    a: "日米合計 5,000 銘柄以上に対応。S&P500 / NASDAQ100 / TOPIX500 を含む主要指数銘柄を網羅しています。",
  },
  {
    q: "データ更新頻度は?",
    a: "マクロ指標 (FRB / 雇用統計) は公式発表後 1 時間以内、株価データは日次バッチ (NY 市場クローズ後) で更新します。",
  },
  {
    q: "無料と有料の違いは?",
    a: "無料版はマクロ分析と銘柄一覧のみ。有料版は Signal/Exit シグナル、通知、ポートフォリオ管理が利用できます。",
  },
  {
    q: "対応ブラウザは?",
    a: "Chrome / Edge / Safari / Firefox の最新 2 バージョンに対応。スマートフォンでも閲覧できます。",
  },
  {
    q: "判定ロジックの根拠は?",
    a: "全ロジックは過去 10 年のヒストリカルデータでバックテスト済み。検証結果と仕様は About ページから参照できます。",
  },
];

export function FAQ({ variant = "A" }: Props) {
  const isDark = variant === "C";
  return (
    <section className="py-24">
      <div className="mx-auto max-w-6xl px-6">
        <h2
          className={[
            "text-3xl md:text-4xl font-bold text-center",
            isDark ? "text-white" : "text-slate-900",
          ].join(" ")}
        >
          よくある質問
        </h2>
        <div className="mt-10 space-y-3">
          {ITEMS.map((it) => (
            <details
              key={it.q}
              className={[
                "group rounded-xl border p-5 transition-colors",
                isDark
                  ? "border-white/10 bg-white/[0.02] open:border-[var(--lp-primary)]/40"
                  : "border-slate-200 bg-white open:border-[var(--lp-primary)]/40",
              ].join(" ")}
            >
              <summary
                className={[
                  "flex items-center justify-between cursor-pointer list-none font-semibold",
                  isDark ? "text-white" : "text-slate-900",
                ].join(" ")}
              >
                {it.q}
                <span className="ml-4 transition-transform group-open:rotate-45 text-xl text-[var(--lp-primary)]">+</span>
              </summary>
              <p className={["mt-3 text-sm leading-relaxed", isDark ? "text-slate-400" : "text-slate-600"].join(" ")}>
                {it.a}
              </p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
