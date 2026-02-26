'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { ThemeToggle } from '@/components/shared/ThemeToggle';
import { GlossaryButton } from '@/components/onboarding/GlossaryPanel';
import { UserMenu } from './UserMenu';

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

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border bg-card">
      <div className="flex h-14 items-center px-4">
        <Link href="/" className="mr-8 flex items-center gap-2 shrink-0">
          <Image src="/icon.png" alt="" width={28} height={28} className="rounded-md" />
          <span className="text-lg font-bold tracking-tight text-foreground">Open Regime</span>
        </Link>
        <nav className="flex items-center space-x-1 flex-1 justify-center">
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
        <div className="flex items-center gap-1 shrink-0">
          <GlossaryButton />
          <ThemeToggle />
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
