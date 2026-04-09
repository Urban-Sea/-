import '@/lib/sentry';
import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import { Header } from "@/components/layout/Header";
import { TooltipProvider } from "@/components/ui/tooltip";
import { UserProvider } from "@/components/providers/UserProvider";
import { SWRProvider } from "@/lib/swr";
import { ChunkErrorHandler } from "@/components/providers/ChunkErrorHandler";
import "./globals.css";
import "./landing.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Open Regime - 市場レジーム分析プラットフォーム",
  description: "流動性ストレス、雇用リスク、SMC シグナルを統合した投資判断ツール",
  openGraph: {
    title: "Open Regime",
    description: "流動性ストレス、雇用リスク、SMC シグナルを統合した投資判断ツール",
    url: "https://open-regime.com",
    siteName: "Open Regime",
    locale: "ja_JP",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Open Regime",
    description: "流動性ストレス、雇用リスク、SMC シグナルを統合した投資判断ツール",
  },
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased min-h-screen bg-background`}
      >
        {process.env.NEXT_PUBLIC_GA_ID && (
          <>
            <Script
              src={`https://www.googletagmanager.com/gtag/js?id=${process.env.NEXT_PUBLIC_GA_ID}`}
              strategy="afterInteractive"
            />
            <Script id="ga4" strategy="afterInteractive">
              {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${process.env.NEXT_PUBLIC_GA_ID}');`}
            </Script>
          </>
        )}
        <ChunkErrorHandler />
        <SWRProvider>
          <UserProvider>
            <TooltipProvider>
              <Header />
              <main className="w-full py-6">
                {children}
              </main>
            </TooltipProvider>
          </UserProvider>
        </SWRProvider>
      </body>
    </html>
  );
}
