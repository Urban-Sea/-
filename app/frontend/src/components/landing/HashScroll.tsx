'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

export function HashScroll() {
  const pathname = usePathname();
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const hash = window.location.hash;
    if (!hash) return;
    requestAnimationFrame(() => {
      const el = document.querySelector(hash);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, [pathname]);
  return null;
}
