import type { Metadata } from "next";
import { LandingFooter } from "@/components/landing/LandingFooter";

export const metadata: Metadata = { title: "お問い合わせ — Open Regime" };

export default function ContactPage() {
  return (
    <div data-theme="landing" className="light min-h-screen flex flex-col">
      <main className="flex-1 mx-auto max-w-3xl w-full px-6 py-20 text-slate-800">
        <h1 className="text-4xl font-semibold tracking-tight text-slate-900">お問い合わせ</h1>

        <section className="mt-8 space-y-4 leading-relaxed">
          <p>
            ご質問・不具合報告・機能要望は Twitter (X) の DM またはリプライにてお願いします。
          </p>
          <a
            href="https://twitter.com"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center rounded-lg bg-brand-primary px-6 py-3 text-base font-semibold text-white shadow-md hover:opacity-90 transition-opacity"
          >
            Twitter で連絡する
          </a>
        </section>

        <p className="mt-12 text-xs text-slate-400">※ 本ページは仮テキストです。</p>
      </main>
      <LandingFooter variant="light" />
    </div>
  );
}
