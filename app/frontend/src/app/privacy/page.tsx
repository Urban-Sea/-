import type { Metadata } from "next";
import { LandingFooter } from "@/components/landing/LandingFooter";

export const metadata: Metadata = { title: "プライバシーポリシー — Open Regime" };

export default function PrivacyPage() {
  return (
    <div data-theme="landing" className="light min-h-screen flex flex-col">
      <main className="flex-1 mx-auto max-w-3xl w-full px-6 py-20 text-slate-800">
        <h1 className="text-4xl font-semibold tracking-tight text-slate-900">プライバシーポリシー</h1>
        <p className="mt-2 text-sm text-slate-500">最終更新: 2026-04-08 (仮版)</p>

        <section className="mt-8 space-y-4 leading-relaxed">
          <h2 className="text-xl font-semibold tracking-tight text-slate-900">取得する情報</h2>
          <ul className="list-disc pl-6 space-y-1">
            <li>Google アカウント認証経由のメールアドレス・表示名・プロフィール画像</li>
            <li>セッション維持のための Cookie</li>
            <li>アクセスログ (IP アドレス、User-Agent、参照元 URL)</li>
          </ul>

          <h2 className="text-xl font-semibold tracking-tight text-slate-900">利用目的</h2>
          <ul className="list-disc pl-6 space-y-1">
            <li>本サービスの提供および利用者認証</li>
            <li>不正アクセスおよび障害対応</li>
            <li>サービス改善のための統計分析</li>
          </ul>

          <h2 className="text-xl font-semibold tracking-tight text-slate-900">第三者提供</h2>
          <p>
            法令に基づく場合を除き、取得した個人情報を第三者に提供することはありません。
          </p>

          <h2 className="text-xl font-semibold tracking-tight text-slate-900">外部サービス</h2>
          <p>
            認証に Google OAuth、エラー監視に Sentry を利用しています。
            これらのサービスのプライバシーポリシーは各サービスの公式ページをご確認ください。
          </p>

          <h2 className="text-xl font-semibold tracking-tight text-slate-900">お問い合わせ</h2>
          <p>本ポリシーに関するお問い合わせは Twitter までお願いします。</p>
        </section>

        <p className="mt-12 text-xs text-slate-400">
          ※ 本ページは仮テキストです。正式版は別途公開します。
        </p>
      </main>
      <LandingFooter variant="light" />
    </div>
  );
}
