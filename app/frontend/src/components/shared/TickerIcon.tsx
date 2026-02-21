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

export function TickerIcon({ ticker, size = 32 }: { ticker: string; size?: number }) {
  const color = TICKER_COLORS[hashTicker(ticker) % TICKER_COLORS.length];
  const abbr = ticker.length <= 2 ? ticker : ticker.slice(0, 2);
  const fontSize = size <= 24 ? 9 : size <= 32 ? 11 : 14;

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
