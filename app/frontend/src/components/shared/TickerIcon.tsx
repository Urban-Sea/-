'use client';

import { useState } from 'react';

const TICKER_COLORS = [
  '#3b82f6', // blue
  '#8b5cf6', // violet
  '#06b6d4', // cyan
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ef4444', // red
  '#ec4899', // pink
  '#14b8a6', // teal
  '#f97316', // orange
  '#6366f1', // indigo
  '#84cc16', // lime
  '#a855f7', // purple
];

function hashTicker(ticker: string): number {
  let hash = 0;
  for (let i = 0; i < ticker.length; i++) {
    hash = ticker.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash);
}

const LOGO_CDN = 'https://cdn.jsdelivr.net/gh/nvstly/icons/ticker_icons';

export function TickerIcon({ ticker, size = 32 }: { ticker: string; size?: number }) {
  const [logoFailed, setLogoFailed] = useState(false);
  const color = TICKER_COLORS[hashTicker(ticker) % TICKER_COLORS.length];
  const isJP = /^\d+$/.test(ticker);
  const abbr = isJP ? ticker : (ticker.length <= 2 ? ticker : ticker.slice(0, 2));
  const fontSize = isJP
    ? (size <= 24 ? 7 : size <= 32 ? 9 : size <= 48 ? 12 : 14)
    : (size <= 24 ? 9 : size <= 32 ? 12 : 16);
  // Validate ticker before constructing CDN URL (prevent path traversal)
  const safeTicker = /^[A-Z0-9.\-]{1,10}$/i.test(ticker) ? ticker.toUpperCase() : '';
  const logoUrl = safeTicker ? `${LOGO_CDN}/${safeTicker}.png` : '';

  if (!logoFailed && safeTicker) {
    return (
      <div
        className="inline-flex items-center justify-center rounded-lg shrink-0 overflow-hidden"
        style={{
          width: size,
          height: size,
          backgroundColor: '#f4f4f5',
          border: '1px solid rgba(0,0,0,0.1)',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={logoUrl}
          alt={ticker}
          width={size - 4}
          height={size - 4}
          className="object-contain"
          style={{
            filter: 'drop-shadow(0 0 1px rgba(0,0,0,0.4))',
          }}
          onError={() => setLogoFailed(true)}
        />
      </div>
    );
  }

  return (
    <div
      className="inline-flex items-center justify-center rounded-lg font-bold font-mono shrink-0"
      style={{
        width: size,
        height: size,
        backgroundColor: `${color}15`,
        border: `1px solid ${color}35`,
        color: darkenColor(color, 0.25),
        fontSize,
      }}
    >
      {abbr}
    </div>
  );
}

function darkenColor(hex: string, amount: number): string {
  const r = Math.max(0, parseInt(hex.slice(1, 3), 16) * (1 - amount));
  const g = Math.max(0, parseInt(hex.slice(3, 5), 16) * (1 - amount));
  const b = Math.max(0, parseInt(hex.slice(5, 7), 16) * (1 - amount));
  return `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
}
