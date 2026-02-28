import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Header } from "@/components/layout/Header";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { UserProvider } from "@/components/providers/UserProvider";
import { SWRProvider } from "@/lib/swr";
import { ChunkErrorHandler } from "@/components/providers/ChunkErrorHandler";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Open Regime - Trading Dashboard",
  description: "V10シグナル分析・マーケットレジーム・保有管理",

};

export const viewport: Viewport = {
  themeColor: "#0a0a0a",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased min-h-screen bg-background`}
      >
        <ChunkErrorHandler />
        <ThemeProvider>
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
        </ThemeProvider>
      </body>
    </html>
  );
}
