'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { GlossaryButton } from '@/components/onboarding/GlossaryPanel';
import { UserMenu } from './UserMenu';
import { useUser } from '@/components/providers/UserProvider';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import {
  Home,
  LayoutDashboard,
  Droplets,
  ShieldAlert,
  BarChart3,
  Search,
  Briefcase,
  X,
  type LucideIcon,
} from 'lucide-react';

const navItems: { href: string; label: string; icon: LucideIcon }[] = [
  { href: '/', label: 'ホーム', icon: Home },
  { href: '/dashboard', label: 'ダッシュボード', icon: LayoutDashboard },
  { href: '/liquidity', label: '米国金融流動性', icon: Droplets },
  { href: '/employment', label: '米国景気リスク', icon: ShieldAlert },
  { href: '/discovery', label: '銘柄発掘', icon: Search },
  { href: '/signals', label: '銘柄分析', icon: BarChart3 },
  { href: '/holdings', label: 'ポートフォリオ', icon: Briefcase },
];

const LANDING_NAV: { href: string; label: string }[] = [
  { href: '/#features', label: '機能' },
  { href: '/#validated', label: '検証実績' },
  { href: '/about', label: 'About' },
];

export function Header() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const { isAuthenticated, isLoading } = useUser();

  // 認証中: 高さ確保の空ヘッダーを返す (チラつき防止)
  if (isLoading) {
    return (
      <header className="sticky top-0 z-50 w-full h-14 border-b border-border bg-card" />
    );
  }

  // 未認証: ランディング用ヘッダー
  if (!isAuthenticated) {
    return (
      <header className="sticky top-0 z-50 w-full backdrop-blur-md bg-white/80 border-b border-slate-200/70">
        <div className="mx-auto max-w-6xl px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <Image src="/icon.png" alt="Open Regime" width={36} height={36} className="rounded-md" />
            <span className="font-bold tracking-tight text-lg text-slate-900">Open Regime</span>
          </Link>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-7 text-sm">
            {LANDING_NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className="text-slate-600 hover:text-slate-900 transition-colors"
              >
                {n.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            <Link
              href="/login/"
              className="hidden md:inline text-sm text-slate-600 hover:text-slate-900"
            >
              ログイン
            </Link>
            <Link
              href="/login/"
              className="hidden md:inline-flex items-center rounded-lg bg-brand-primary px-4 py-2 text-sm font-semibold text-white shadow-sm hover:opacity-90 transition-opacity"
            >
              はじめる
            </Link>

            {/* Mobile hamburger */}
            <Sheet open={open} onOpenChange={setOpen}>
              <SheetTrigger asChild>
                <button className="md:hidden ml-1 p-2 rounded-md hover:bg-slate-100 text-slate-600 hover:text-slate-900 transition-colors">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
                  </svg>
                </button>
              </SheetTrigger>
              <SheetContent
                side="right"
                showCloseButton={false}
                className="w-72 border-l border-slate-200 bg-white p-0"
              >
                <div className="flex items-center gap-2.5 px-5 pt-5 pb-4 border-b border-slate-200">
                  <Image src="/icon.png" alt="" width={24} height={24} className="rounded-md" />
                  <SheetTitle className="text-base font-bold tracking-tight text-slate-900">
                    Open Regime
                  </SheetTitle>
                  <SheetClose className="ml-auto rounded-md p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">
                    <X className="w-4 h-4" />
                  </SheetClose>
                </div>

                <nav className="flex flex-col gap-1 px-3 py-4">
                  {LANDING_NAV.map((n) => (
                    <Link
                      key={n.href}
                      href={n.href}
                      onClick={() => setOpen(false)}
                      className="px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-100 hover:text-slate-900 rounded-lg transition-colors"
                    >
                      {n.label}
                    </Link>
                  ))}
                  <div className="mt-3 pt-3 border-t border-slate-200 flex flex-col gap-2">
                    <Link
                      href="/login/"
                      onClick={() => setOpen(false)}
                      className="px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-100 hover:text-slate-900 rounded-lg transition-colors"
                    >
                      ログイン
                    </Link>
                    <Link
                      href="/login/"
                      onClick={() => setOpen(false)}
                      className="mx-1 inline-flex items-center justify-center rounded-lg bg-brand-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:opacity-90 transition-opacity"
                    >
                      はじめる
                    </Link>
                  </div>
                </nav>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </header>
    );
  }

  // 認証済み: 既存ダッシュボードヘッダー
  return (
    <header className="sticky top-0 z-50 w-full border-b border-border bg-card">
      <div className="flex h-14 items-center px-4">
        <Link href="/" className="mr-8 flex items-center gap-2.5 shrink-0">
          <Image src="/icon.png" alt="" width={36} height={36} className="rounded-md" />
          <span className="text-lg font-bold tracking-tight text-foreground">Open Regime</span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden lg:flex items-center space-x-1 flex-1 justify-center">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'px-4 py-2 text-sm font-medium transition-colors rounded-md',
                pathname === item.href
                  ? 'bg-blue-500/10 text-blue-700 dark:text-blue-300'
                  : 'text-muted-foreground hover:text-foreground hover:bg-blue-500/5'
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        {/* Spacer for mobile */}
        <div className="flex-1 lg:hidden" />

        <div className="flex items-center gap-1 shrink-0">
          <GlossaryButton />
          <UserMenu />

          {/* Mobile hamburger */}
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <button className="lg:hidden ml-1 p-2 rounded-md hover:bg-blue-500/10 text-muted-foreground hover:text-foreground transition-colors">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
                </svg>
              </button>
            </SheetTrigger>
            <SheetContent
              side="right"
              showCloseButton={false}
              className="w-72 border-l border-blue-400/15 bg-gradient-to-b from-blue-950 via-slate-900 to-slate-950 backdrop-blur-xl p-0"
            >
              {/* Header */}
              <div className="flex items-center gap-2.5 px-5 pt-5 pb-4 border-b border-blue-400/10">
                <Image src="/icon.png" alt="" width={24} height={24} className="rounded-md" />
                <SheetTitle className="text-base font-bold tracking-tight text-blue-100">
                  Open Regime
                </SheetTitle>
                <SheetClose className="ml-auto rounded-md p-1 text-blue-300/50 hover:text-blue-200 hover:bg-blue-500/10 transition-colors">
                  <X className="w-4 h-4" />
                </SheetClose>
              </div>

              {/* Nav links */}
              <nav className="flex flex-col gap-1 px-3 py-4">
                {navItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = pathname === item.href;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setOpen(false)}
                      className={cn(
                        'group flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-lg transition-all duration-150',
                        isActive
                          ? 'bg-blue-500/20 text-blue-200 shadow-[inset_0_0_0_1px_rgba(96,165,250,0.25)]'
                          : 'text-blue-200/60 hover:text-blue-100 hover:bg-blue-500/10'
                      )}
                    >
                      <Icon className={cn(
                        'w-[18px] h-[18px] shrink-0 transition-colors',
                        isActive ? 'text-blue-400' : 'text-blue-400/40 group-hover:text-blue-400/70'
                      )} />
                      {item.label}
                    </Link>
                  );
                })}
              </nav>

              {/* Footer accent line */}
              <div className="mt-auto border-t border-blue-400/10 px-5 py-4">
                <p className="text-[11px] text-blue-300/30 font-medium tracking-wider uppercase">Market Intelligence</p>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
