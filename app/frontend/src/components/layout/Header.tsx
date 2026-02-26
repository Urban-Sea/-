'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { ThemeToggle } from '@/components/shared/ThemeToggle';
import { GlossaryButton } from '@/components/onboarding/GlossaryPanel';
import { UserMenu } from './UserMenu';
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';

const navItems = [
  { href: '/', label: 'ホーム' },
  { href: '/dashboard', label: 'ダッシュボード' },
  { href: '/liquidity', label: '米国金融流動性' },
  { href: '/employment', label: '米国景気リスク' },
  { href: '/signals', label: '銘柄分析' },
  { href: '/holdings', label: 'ポートフォリオ' },
];

export function Header() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border bg-card">
      <div className="flex h-14 items-center px-4">
        <Link href="/" className="mr-8 flex items-center gap-2 shrink-0">
          <Image src="/icon.png" alt="" width={28} height={28} className="rounded-md" />
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
          <ThemeToggle />
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
            <SheetContent side="right" className="w-72 bg-card border-border">
              <SheetTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">
                ナビゲーション
              </SheetTitle>
              <nav className="flex flex-col gap-1">
                {navItems.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className={cn(
                      'px-4 py-3 text-sm font-medium transition-colors rounded-lg',
                      pathname === item.href
                        ? 'bg-blue-500/15 text-blue-700 dark:text-blue-300 border border-blue-500/20'
                        : 'text-muted-foreground hover:text-foreground hover:bg-blue-500/5'
                    )}
                  >
                    {item.label}
                  </Link>
                ))}
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
