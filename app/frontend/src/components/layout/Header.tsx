'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { ThemeToggle } from '@/components/shared/ThemeToggle';
import { GlossaryButton } from '@/components/onboarding/GlossaryPanel';
import { UserMenu } from './UserMenu';

const navItems = [
  { href: '/', label: '統合システム' },
  { href: '/liquidity', label: '流動性配管システム' },
  { href: '/employment', label: '米国景気警戒システム' },
  { href: '/signals', label: '個別シグナル分析' },
  { href: '/holdings', label: '保有・取引管理' },
  { href: '/about', label: '概要' },
];

export function Header() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border bg-card">
      <div className="flex h-14 items-center px-4">
        <Link href="/" className="mr-8 flex items-center gap-2 shrink-0">
          <Image
            src="/logo.png"
            alt="Open Regime"
            width={174}
            height={100}
            className="h-10 w-auto"
            priority
          />
        </Link>
        <nav className="flex items-center space-x-1 flex-1 justify-center">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'px-4 py-2 text-sm font-medium transition-colors rounded-md',
                pathname === item.href
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent'
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
