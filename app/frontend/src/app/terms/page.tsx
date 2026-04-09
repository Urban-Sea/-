import type { Metadata } from "next";
import { LandingFooter } from "@/components/landing/LandingFooter";

export const metadata: Metadata = { title: "利用規約 — Open Regime" };

export default function TermsPage() {
  return (
    <div data-theme="landing" className="light min-h-screen flex flex-col">
      <main className="flex-1 mx-auto max-w-3xl w-full px-6 py-20 text-slate-800">
        <h1 className="text-4xl font-semibold tracking-tight text-slate-900">利用規約</h1>
        <p className="mt-2 text-sm text-slate-500">最終更新: 2026-04-08 (仮版)</p>

        <section className="mt-8 space-y-4 leading-relaxed">
          <h2 className="text-xl font-semibold tracking-tight text-slate-900">第 1 条 (本サービスについて)</h2>
          <p>
            Open Regime (以下「本サービス」) は、株価および各種マクロ経済指標を分析・可視化する
            情報提供ツールです。本サービスは投資助言業に該当する個別の投資推奨を行うものではなく、
            すべての投資判断および結果はご利用者ご自身の責任に帰属します。
          </p>

          <h2 className="text-xl font-semibold tracking-tight text-slate-900">第 2 条 (免責事項)</h2>
          <p>
            本サービスが表示するデータ・分析結果・シグナルの正確性、完全性、有用性について、
            運営者は一切の保証を行いません。本サービスの利用により生じた損害について、
            運営者は責任を負いません。
          </p>

          <h2 className="text-xl font-semibold tracking-tight text-slate-900">第 3 条 (禁止事項)</h2>
          <p>
            リバースエンジニアリング、自動スクレイピング、本サービスの不正利用、
            および法令または公序良俗に反する一切の行為を禁止します。
          </p>

          <h2 className="text-xl font-semibold tracking-tight text-slate-900">第 4 条 (規約の変更)</h2>
          <p>
            運営者は本規約を随時変更できるものとします。重要な変更については本ページに掲示します。
          </p>
        </section>

        <p className="mt-12 text-xs text-slate-400">
          ※ 本ページは仮テキストです。正式版は別途公開します。
        </p>
      </main>
      <LandingFooter variant="light" />
    </div>
  );
}
