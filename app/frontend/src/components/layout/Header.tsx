'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const navItems = [
  { href: '/', label: '統合' },
  { href: '/liquidity', label: '配管' },
  { href: '/employment', label: '米国景気' },
  { href: '/signals', label: 'シグナル' },
  { href: '/holdings', label: '保有' },
];

export function Header() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border bg-card">
      <div className="flex h-14 items-center justify-center px-4">
        <Link href="/" className="mr-8 flex items-center gap-2 shrink-0">
          <Image
            src="/logo.png"
            alt="Open Regime"
            width={140}
            height={80}
            className="h-9 w-auto"
            priority
          />
        </Link>
        <nav className="flex items-center space-x-1">
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
      </div>
    </header>
  );
}
