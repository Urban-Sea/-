'use client';

import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return <div className="w-8 h-8" />;
  }

  const isDark = theme === 'dark';

  return (
    <button
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      className="relative w-8 h-8 rounded-lg flex items-center justify-center transition-all hover:bg-accent"
      aria-label={isDark ? 'ライトモードに切り替え' : 'ダークモードに切り替え'}
    >
      {isDark ? (
        <Sun className="w-4 h-4 text-zinc-400 hover:text-yellow-400 transition-colors" />
      ) : (
        <Moon className="w-4 h-4 text-zinc-500 hover:text-blue-500 transition-colors" />
      )}
    </button>
  );
}
