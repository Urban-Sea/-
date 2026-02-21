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
  const abbr = ticker.length <= 2 ? ticker : ticker.slice(0, 2);
  const fontSize = size <= 24 ? 9 : size <= 32 ? 11 : 14;
  const logoUrl = `${LOGO_CDN}/${ticker.toUpperCase()}.png`;

  if (!logoFailed) {
    return (
      <div
        className="inline-flex items-center justify-center rounded-lg shrink-0 overflow-hidden"
        style={{
          width: size,
          height: size,
          backgroundColor: `${color}08`,
          border: `1px solid ${color}20`,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={logoUrl}
          alt={ticker}
          width={size - 4}
          height={size - 4}
          className="object-contain"
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
        border: `1px solid ${color}30`,
        color: color,
        fontSize,
      }}
    >
      {abbr}
    </div>
  );
}
