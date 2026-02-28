'use client';

import type { ReactNode } from 'react';

export function GlassCard({ children, className = '', stagger = 0 }: {
  children: ReactNode; className?: string; stagger?: number;
}) {
  return (
    <div className={`plumb-glass plumb-glass-hover rounded-xl plumb-animate-in ${stagger > 0 ? `plumb-stagger-${stagger}` : ''} ${className}`}>
      {children}
    </div>
  );
}
