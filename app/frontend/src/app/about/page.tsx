import type { Metadata } from "next";
import { LandingFooter } from "@/components/landing/LandingFooter";

export const metadata: Metadata = { title: "About — Open Regime" };

export default function AboutPage() {
  return (
    <div data-theme="landing" className="light min-h-screen flex flex-col">
      <main className="flex-1 mx-auto max-w-3xl w-full px-6 py-20 text-slate-800">
        <h1 className="text-4xl font-semibold tracking-tight text-slate-900">About</h1>

        <section className="mt-8 space-y-4 leading-relaxed">
          <p>
            Open Regime は、裁量を排した機械的なテクニカル分析を目的に開発されたツールです。
            Regime / Signal / Exit の 3 つのエンジンを統合し、入口と出口を一貫したロジックで判定します。
          </p>

          <h2 className="text-xl font-semibold tracking-tight text-slate-900 mt-8">技術スタック</h2>
          <ul className="list-disc pl-6 space-y-1">
            <li>フロントエンド: Next.js (App Router), Tailwind CSS, shadcn/ui</li>
            <li>API: Go (Echo) + Python (FastAPI)</li>
            <li>計算エンジン: Python + FastAPI + yfinance</li>
            <li>バッチ: Python (VPS cron)</li>
            <li>監視: Sentry</li>
          </ul>

          <h2 className="text-xl font-semibold tracking-tight text-slate-900 mt-8">開発者</h2>
          <p>個人開発者により運営されています。フィードバックは Twitter までお気軽に。</p>
        </section>

        <p className="mt-12 text-xs text-slate-400">※ 本ページは仮テキストです。</p>
      </main>
      <LandingFooter variant="light" />
    </div>
  );
}
