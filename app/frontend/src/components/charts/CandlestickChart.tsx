'use client';

import { useEffect, useRef, useCallback } from 'react';
import type { BOSMarker, CHoCHMarker, FVGMarker, OrderBlockMarker, OTEZoneMarker, PremiumDiscountZone } from '@/types';

interface CandleData {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  ema8?: number;
  ema21?: number;
}

interface CandlestickChartProps {
  data: CandleData[];
  ticker?: string;
  showEMA?: boolean;
  showBOS?: boolean;
  showCHoCH?: boolean;
  showFVG?: boolean;
  showOB?: boolean;
  showOTE?: boolean;
  showPD?: boolean;
  bosMarkers?: BOSMarker[];
  chochMarkers?: CHoCHMarker[];
  fvgMarkers?: FVGMarker[];
  obMarkers?: OrderBlockMarker[];
  oteMarkers?: OTEZoneMarker[];
  pdZone?: PremiumDiscountZone | null;
}

const MIN_VISIBLE = 20;
const DEFAULT_VISIBLE = 120;

export default function CandlestickChart({
  data,
  ticker,
  showEMA = true,
  showBOS = false,
  showCHoCH = false,
  showFVG = false,
  showOB = false,
  showOTE = false,
  showPD = false,
  bosMarkers = [],
  chochMarkers = [],
  fvgMarkers = [],
  obMarkers = [],
  oteMarkers = [],
  pdZone = null,
  initialVisibleCount,
}: CandlestickChartProps & { initialVisibleCount?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Viewport state (refs to avoid re-render on every pan)
  const viewRef = useRef({ start: 0, end: 0 });
  const dragRef = useRef({ active: false, startX: 0, startViewStart: 0, startViewEnd: 0 });

  // Initialize viewport when data changes
  useEffect(() => {
    if (!data || data.length === 0) return;
    const visible = Math.min(data.length, initialVisibleCount ?? DEFAULT_VISIBLE);
    viewRef.current = { start: data.length - visible, end: data.length };
  }, [data, initialVisibleCount]);

  const draw = useCallback(() => {
    if (!data || data.length === 0) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const container = canvas.parentElement;
    if (!container) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = container.clientWidth;
    const height = container.clientHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    ctx.scale(dpr, dpr);

    const { start, end } = viewRef.current;
    const visibleData = data.slice(start, end);
    if (visibleData.length === 0) return;

    // Layout: price chart top 78%, volume bottom 18%, gap 4%
    const hasVolume = visibleData.some(c => c.volume && c.volume > 0);
    const subRatio = hasVolume ? 0.18 : 0;
    const gapRatio = hasVolume ? 0.04 : 0;
    const priceRatio = 1 - subRatio - gapRatio;

    const padding = { top: 36, right: 68, bottom: 44, left: 12 };
    const scrollbarH = 6;
    const totalChartHeight = height - padding.top - padding.bottom - scrollbarH - 4;
    const priceChartHeight = totalChartHeight * priceRatio;
    const subChartTop = padding.top + priceChartHeight + totalChartHeight * gapRatio;
    const subChartHeight = totalChartHeight * subRatio;

    // Create date to visible-index map for markers
    const dateIndexMap = new Map<string, number>();
    visibleData.forEach((d, i) => {
      dateIndexMap.set(d.date, i);
    });

    const ccy = ticker && /^\d/.test(ticker) ? '¥' : '$';
    const formatPrice = (val: number) => {
      if (ccy === '¥') return '¥' + Math.round(val).toLocaleString();
      if (val >= 1000) return '$' + val.toFixed(0);
      return '$' + val.toFixed(2);
    };

    // Theme colors
    const bgColor = '#ffffff';
    const gridColor = 'rgba(0,0,0,0.06)';
    const priceTextColor = '#999';
    const dateTextColor = '#999';
    const legendTextColor = '#666';
    const volSepColor = 'rgba(0,0,0,0.08)';
    const volLabelColor = '#aaa';

    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, width, height);

    // Calculate price range for visible data
    let minPrice = Infinity, maxPrice = -Infinity;
    visibleData.forEach(c => {
      if (c.low < minPrice) minPrice = c.low;
      if (c.high > maxPrice) maxPrice = c.high;
      if (showEMA) {
        if (c.ema8 !== undefined) {
          if (c.ema8 < minPrice) minPrice = c.ema8;
          if (c.ema8 > maxPrice) maxPrice = c.ema8;
        }
        if (c.ema21 !== undefined) {
          if (c.ema21 < minPrice) minPrice = c.ema21;
          if (c.ema21 > maxPrice) maxPrice = c.ema21;
        }
      }
    });
    const priceRange = maxPrice - minPrice;
    minPrice -= priceRange * 0.05;
    maxPrice += priceRange * 0.05;

    const chartWidth = width - padding.left - padding.right;
    const candleWidth = Math.max(1, Math.min(12, (chartWidth / visibleData.length) * 0.65));
    const candleSpacing = chartWidth / visibleData.length;

    const yScale = (p: number) => padding.top + priceChartHeight * (1 - (p - minPrice) / (maxPrice - minPrice));
    const xScale = (i: number) => padding.left + candleSpacing * i + candleSpacing / 2;

    // Grid lines (price area only)
    const gridLines = 6;
    for (let i = 0; i <= gridLines; i++) {
      const y = padding.top + (priceChartHeight / gridLines) * i;
      ctx.strokeStyle = gridColor;
      ctx.lineWidth = 0.5;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(width - padding.right, y);
      ctx.stroke();
      ctx.setLineDash([]);
      const price = maxPrice - (maxPrice - minPrice) * (i / gridLines);
      ctx.fillStyle = priceTextColor;
      ctx.font = '10px -apple-system, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(formatPrice(price), width - padding.right + 6, y + 3);
    }

    // Premium/Discount Zone (background layer)
    if (showPD && pdZone) {
      const yHigh = yScale(pdZone.swing_high);
      const yLow = yScale(pdZone.swing_low);
      const yEq = yScale(pdZone.equilibrium);
      const xLeft = padding.left;
      const xRight = width - padding.right;
      const chartTop = padding.top;
      const chartBottom = padding.top + priceChartHeight;
      // Always show EQ line if it's within visible price range
      if (yEq > chartTop && yEq < chartBottom) {
        // Premium tint (clipped to chart area)
        const tintTop = Math.max(yHigh, chartTop);
        const tintMid = Math.min(Math.max(yEq, chartTop), chartBottom);
        if (tintTop < tintMid) {
          ctx.fillStyle = 'rgba(244,63,94,0.03)';
          ctx.fillRect(xLeft, tintTop, xRight - xLeft, tintMid - tintTop);
        }
        // Discount tint (clipped to chart area)
        const tintBottom = Math.min(yLow, chartBottom);
        if (tintMid < tintBottom) {
          ctx.fillStyle = 'rgba(34,197,94,0.03)';
          ctx.fillRect(xLeft, tintMid, xRight - xLeft, tintBottom - tintMid);
        }
        // EQ line
        ctx.strokeStyle = 'rgba(244,63,94,0.35)';
        ctx.lineWidth = 1;
        ctx.setLineDash([6, 4]);
        ctx.beginPath(); ctx.moveTo(xLeft, yEq); ctx.lineTo(xRight, yEq); ctx.stroke();
        ctx.setLineDash([]);
        // Swing bounds (only if visible)
        ctx.strokeStyle = 'rgba(150,150,150,0.15)';
        ctx.lineWidth = 0.5;
        ctx.setLineDash([2, 4]);
        if (yHigh > chartTop && yHigh < chartBottom) {
          ctx.beginPath(); ctx.moveTo(xLeft, yHigh); ctx.lineTo(xRight, yHigh); ctx.stroke();
        }
        if (yLow > chartTop && yLow < chartBottom) {
          ctx.beginPath(); ctx.moveTo(xLeft, yLow); ctx.lineTo(xRight, yLow); ctx.stroke();
        }
        ctx.setLineDash([]);
        // Labels
        ctx.font = '9px -apple-system, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillStyle = 'rgba(244,63,94,0.5)';
        ctx.fillText(`EQ ${formatPrice(pdZone.equilibrium)}`, xLeft + 4, yEq - 4);
        const zoneColor = pdZone.zone === 'PREMIUM' ? 'rgba(244,63,94,0.5)'
                         : pdZone.zone === 'DISCOUNT' ? 'rgba(34,197,94,0.5)'
                         : 'rgba(150,150,150,0.5)';
        ctx.fillStyle = zoneColor;
        ctx.font = 'bold 8px -apple-system, sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(pdZone.zone, xRight - 4, yEq + (pdZone.zone === 'PREMIUM' ? -8 : 12));
      }
    }

    // OTE Zone (background band) — show up to 3 active zones
    if (showOTE && oteMarkers.length > 0) {
      const activeOtes = oteMarkers.filter(m => m.status === 'ACTIVE').slice(-3);
      activeOtes.forEach(ote => {
        const yFib62 = yScale(ote.fib_62);
        const yFib79 = yScale(ote.fib_79);
        const xLeft = padding.left;
        const xRight = width - padding.right;
        ctx.fillStyle = 'rgba(59,130,246,0.06)';
        ctx.fillRect(xLeft, yFib79, xRight - xLeft, yFib62 - yFib79);
        ctx.strokeStyle = 'rgba(59,130,246,0.45)';
        ctx.lineWidth = 0.8;
        ctx.setLineDash([]);
        ctx.beginPath(); ctx.moveTo(xLeft, yFib62); ctx.lineTo(xRight, yFib62); ctx.stroke();
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(xLeft, yFib79); ctx.lineTo(xRight, yFib79); ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = '9px -apple-system, sans-serif';
        ctx.fillStyle = 'rgba(59,130,246,0.6)';
        ctx.textAlign = 'right';
        ctx.fillText('0.618', xRight - 2, yFib62 - 3);
        ctx.fillText('0.786', xRight - 2, yFib79 - 3);
        ctx.font = 'bold 8px -apple-system, sans-serif';
        ctx.fillText('OTE', xRight - 2, (yFib62 + yFib79) / 2 + 3);
      });
    }

    // FVG Zones
    if (showFVG && fvgMarkers.length > 0) {
      fvgMarkers.forEach(fvg => {
        const idx = dateIndexMap.get(fvg.date);
        if (idx === undefined || idx < 0 || idx >= visibleData.length) return;
        const gapTop = yScale(fvg.top);
        const gapBottom = yScale(fvg.bottom);
        const xStart = xScale(idx);
        const maxExtend = Math.min(idx + 30, visibleData.length - 1);
        const xEnd = xScale(maxExtend);
        const fvgColor = 'rgba(192,132,252,0.15)';
        const fvgBorder = 'rgba(192,132,252,0.45)';
        const fvgGrad = ctx.createLinearGradient(xStart, 0, xEnd, 0);
        fvgGrad.addColorStop(0, fvgColor);
        fvgGrad.addColorStop(1, 'transparent');
        ctx.fillStyle = fvgGrad;
        ctx.fillRect(xStart, gapTop, xEnd - xStart, gapBottom - gapTop);
        ctx.strokeStyle = fvgBorder;
        ctx.lineWidth = 0.8;
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.moveTo(xStart, gapTop); ctx.lineTo(xEnd, gapTop);
        ctx.moveTo(xStart, gapBottom); ctx.lineTo(xEnd, gapBottom);
        ctx.stroke();
        ctx.setLineDash([]);
      });
    }

    // Order Block Zones
    if (showOB && obMarkers.length > 0) {
      obMarkers.forEach(ob => {
        if (ob.status !== 'ACTIVE') return;
        const idx = dateIndexMap.get(ob.start_date);
        if (idx === undefined) return;
        const y1 = yScale(ob.zone_high);
        const y2 = yScale(ob.zone_low);
        const xStart = xScale(idx);
        const xEnd = xScale(visibleData.length - 1);
        const isBull = ob.direction === 'BULLISH';
        const baseColor = isBull ? '34,211,238' : '251,113,133';
        const alpha = 0.06 + ob.freshness * 0.12;
        const grad = ctx.createLinearGradient(xStart, 0, xEnd, 0);
        grad.addColorStop(0, `rgba(${baseColor},${alpha})`);
        grad.addColorStop(1, 'transparent');
        ctx.fillStyle = grad;
        ctx.fillRect(xStart, y1, xEnd - xStart, y2 - y1);
        ctx.strokeStyle = `rgba(${baseColor},0.4)`;
        ctx.lineWidth = 0.8;
        ctx.setLineDash(ob.cisd_confirmed ? [] : [2, 2]);
        ctx.beginPath();
        ctx.moveTo(xStart, y1); ctx.lineTo(xEnd, y1);
        ctx.moveTo(xStart, y2); ctx.lineTo(xEnd, y2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = 'bold 7px -apple-system, sans-serif';
        ctx.fillStyle = `rgba(${baseColor},0.7)`;
        ctx.textAlign = 'left';
        ctx.fillText('OB', xStart + 3, y1 + 9);
      });
    }

    // Candlesticks
    visibleData.forEach((c, i) => {
      const x = xScale(i);
      const openY = yScale(c.open);
      const closeY = yScale(c.close);
      const highY = yScale(c.high);
      const lowY = yScale(c.low);
      const isUp = c.close >= c.open;
      const bodyColor = isUp ? '#26a69a' : '#ef5350';
      const wickColor = isUp ? 'rgba(38,166,154,0.6)' : 'rgba(239,83,80,0.6)';

      // Wick
      ctx.strokeStyle = wickColor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, highY); ctx.lineTo(x, lowY);
      ctx.stroke();

      // Body
      const bodyTop = Math.min(openY, closeY);
      const bodyHeight = Math.max(Math.abs(closeY - openY), 1);
      ctx.fillStyle = bodyColor;
      if (candleWidth >= 3) {
        const r = Math.min(1.5, candleWidth * 0.15);
        roundRect(ctx, x - candleWidth / 2, bodyTop, candleWidth, bodyHeight, r);
        ctx.fill();
      } else {
        ctx.fillRect(x - candleWidth / 2, bodyTop, candleWidth, bodyHeight);
      }
    });

    // Current price line (last visible candle)
    if (visibleData.length > 0) {
      const lastCandle = visibleData[visibleData.length - 1];
      const lastY = yScale(lastCandle.close);
      const isUp = lastCandle.close >= lastCandle.open;
      const lineColor = isUp ? '#26a69a' : '#ef5350';
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 0.8;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(padding.left, lastY);
      ctx.lineTo(width - padding.right, lastY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = lineColor;
      const labelW = 60;
      const labelH = 18;
      roundRect(ctx, width - padding.right + 1, lastY - labelH / 2, labelW, labelH, 3);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 10px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(formatPrice(lastCandle.close), width - padding.right + 1 + labelW / 2, lastY + 3.5);
    }

    // EMA Lines
    if (showEMA) {
      const ema8Data = visibleData.map(d => d.ema8).filter((v): v is number => v !== undefined);
      if (ema8Data.length > 0) {
        ctx.strokeStyle = '#4ade80';
        ctx.lineWidth = 1.3;
        ctx.setLineDash([]);
        ctx.beginPath();
        let started = false;
        visibleData.forEach((d, i) => {
          if (d.ema8 === undefined) return;
          const x = xScale(i), y = yScale(d.ema8);
          if (!started) { ctx.moveTo(x, y); started = true; } else { ctx.lineTo(x, y); }
        });
        ctx.stroke();
      }
      const ema21Data = visibleData.map(d => d.ema21).filter((v): v is number => v !== undefined);
      if (ema21Data.length > 0) {
        ctx.strokeStyle = '#f87171';
        ctx.lineWidth = 1.3;
        ctx.setLineDash([6, 3]);
        ctx.beginPath();
        let started = false;
        visibleData.forEach((d, i) => {
          if (d.ema21 === undefined) return;
          const x = xScale(i), y = yScale(d.ema21);
          if (!started) { ctx.moveTo(x, y); started = true; } else { ctx.lineTo(x, y); }
        });
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // BOS Markers
    if (showBOS && bosMarkers.length > 0) {
      bosMarkers.forEach(bos => {
        const idx = dateIndexMap.get(bos.date);
        if (idx === undefined || idx < 0 || idx >= visibleData.length) return;
        const x = xScale(idx), y = yScale(bos.price);
        const color = 'rgba(251,191,36,0.35)';
        ctx.font = 'bold 8px -apple-system, sans-serif';
        const tw = ctx.measureText('BOS').width;
        ctx.fillStyle = color;
        roundRect(ctx, x - tw / 2 - 3, y - 17, tw + 6, 12, 3);
        ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.textAlign = 'center';
        ctx.fillText('BOS', x, y - 8);
        const maxExt = Math.min(idx + 12, visibleData.length - 1);
        ctx.strokeStyle = 'rgba(251,191,36,0.2)';
        ctx.lineWidth = 0.8;
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.moveTo(x, y); ctx.lineTo(xScale(maxExt), y);
        ctx.stroke();
        ctx.setLineDash([]);
      });
    }

    // CHoCH Markers
    if (showCHoCH && chochMarkers.length > 0) {
      chochMarkers.forEach(choch => {
        const idx = dateIndexMap.get(choch.date);
        if (idx === undefined || idx < 0 || idx >= visibleData.length) return;
        const x = xScale(idx), y = yScale(choch.price);
        const color = 'rgba(168,85,247,0.35)';
        ctx.font = 'bold 8px -apple-system, sans-serif';
        const tw = ctx.measureText('CHoCH').width;
        ctx.fillStyle = color;
        roundRect(ctx, x - tw / 2 - 3, y - 17, tw + 6, 12, 3);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.textAlign = 'center';
        ctx.fillText('CHoCH', x, y - 8);
        const sIdx = Math.max(0, idx - 5);
        const eIdx = Math.min(visibleData.length - 1, idx + 10);
        ctx.strokeStyle = 'rgba(168,85,247,0.2)';
        ctx.lineWidth = 0.8;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(xScale(sIdx), y); ctx.lineTo(xScale(eIdx), y);
        ctx.stroke();
        ctx.setLineDash([]);
      });
    }

    // Volume bars
    if (hasVolume) {
      ctx.strokeStyle = volSepColor;
      ctx.lineWidth = 0.5;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(padding.left, subChartTop - 2);
      ctx.lineTo(width - padding.right, subChartTop - 2);
      ctx.stroke();

      ctx.fillStyle = volLabelColor;
      ctx.font = '9px -apple-system, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('Vol', padding.left + 2, subChartTop + 10);

      const maxVol = Math.max(...visibleData.map(c => c.volume || 0));
      if (maxVol > 0) {
        const volBarW = Math.max(1, candleWidth * 0.85);
        visibleData.forEach((c, i) => {
          if (!c.volume) return;
          const x = xScale(i);
          const barH = (c.volume / maxVol) * (subChartHeight - 4);
          const barY = subChartTop + subChartHeight - barH;
          const isUp = c.close >= c.open;
          ctx.fillStyle = isUp ? 'rgba(38,166,154,0.35)' : 'rgba(239,83,80,0.35)';
          ctx.fillRect(x - volBarW / 2, barY, volBarW, barH);
        });

        const volLabel = maxVol >= 1e9 ? (maxVol / 1e9).toFixed(1) + 'B'
          : maxVol >= 1e6 ? (maxVol / 1e6).toFixed(0) + 'M'
          : maxVol >= 1e3 ? (maxVol / 1e3).toFixed(0) + 'K'
          : maxVol.toString();
        ctx.fillStyle = volLabelColor;
        ctx.font = '9px -apple-system, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(volLabel, width - padding.right + 6, subChartTop + 10);
      }
    }

    // Date labels
    ctx.fillStyle = dateTextColor;
    ctx.font = '10px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    const labelStep = Math.max(1, Math.ceil(visibleData.length / 10));
    visibleData.forEach((c, i) => {
      if (i % labelStep === 0) {
        const dateLabel = c.date.slice(5).replace('-', '/');
        ctx.fillText(dateLabel, xScale(i), height - padding.bottom - scrollbarH + 10);
      }
    });

    // Legend
    let titleX = padding.left + 4;
    if (showEMA) {
      ctx.fillStyle = '#4ade80';
      ctx.fillRect(titleX, 15, 14, 2);
      titleX += 18;
      ctx.fillStyle = legendTextColor;
      ctx.font = '10px -apple-system, sans-serif';
      ctx.fillText('EMA8', titleX, 20);
      titleX += 36;
      ctx.fillStyle = '#f87171';
      ctx.setLineDash([4, 2]);
      ctx.strokeStyle = '#f87171';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(titleX, 16); ctx.lineTo(titleX + 14, 16); ctx.stroke();
      ctx.setLineDash([]);
      titleX += 18;
      ctx.fillStyle = legendTextColor;
      ctx.fillText('EMA21', titleX, 20);
      titleX += 42;
    }
    ctx.font = '10px -apple-system, sans-serif';
    if (showFVG) {
      const visibleFvg = fvgMarkers.filter(m => dateIndexMap.has(m.date)).length;
      ctx.fillStyle = 'rgba(192,132,252,0.5)';
      ctx.fillText(`FVG:${visibleFvg}`, titleX, 20);
      titleX += 45;
    }
    if (showBOS) {
      const visibleBos = bosMarkers.filter(m => dateIndexMap.has(m.date)).length;
      ctx.fillStyle = 'rgba(251,191,36,0.5)';
      ctx.fillText(`BOS:${visibleBos}`, titleX, 20);
      titleX += 45;
    }
    if (showCHoCH) {
      const visibleChoch = chochMarkers.filter(m => dateIndexMap.has(m.date)).length;
      ctx.fillStyle = 'rgba(168,85,247,0.5)';
      ctx.fillText(`CHoCH:${visibleChoch}`, titleX, 20);
      titleX += 55;
    }
    if (showOB) {
      const visibleOb = obMarkers.filter(m => dateIndexMap.has(m.start_date)).length;
      ctx.fillStyle = 'rgba(34,211,238,0.5)';
      ctx.fillText(`OB:${visibleOb}`, titleX, 20);
      titleX += 40;
    }
    if (showOTE) {
      const activeOte = oteMarkers.filter(m => m.status === 'ACTIVE').length;
      ctx.fillStyle = 'rgba(59,130,246,0.5)';
      ctx.fillText(`OTE:${activeOte}`, titleX, 20);
      titleX += 45;
    }
    if (showPD && pdZone) {
      ctx.fillStyle = 'rgba(244,63,94,0.5)';
      ctx.fillText(`P/D:${pdZone.zone}`, titleX, 20);
    }

    // Scrollbar
    if (data.length > MIN_VISIBLE) {
      const sbY = height - scrollbarH - 2;
      const sbWidth = chartWidth;
      const sbX = padding.left;
      ctx.fillStyle = 'rgba(0,0,0,0.06)';
      roundRect(ctx, sbX, sbY, sbWidth, scrollbarH, 3);
      ctx.fill();
      const thumbStart = (start / data.length) * sbWidth;
      const thumbWidth = Math.max(20, ((end - start) / data.length) * sbWidth);
      ctx.fillStyle = 'rgba(0,0,0,0.15)';
      roundRect(ctx, sbX + thumbStart, sbY, thumbWidth, scrollbarH, 3);
      ctx.fill();
    }
  }, [data, ticker, showEMA, showBOS, showCHoCH, showFVG, showOB, showOTE, showPD, bosMarkers, chochMarkers, fvgMarkers, obMarkers, oteMarkers, pdZone]);

  // Draw on data/options change
  useEffect(() => {
    draw();
  }, [draw]);

  // Mouse/wheel handlers for pan & zoom
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data || data.length <= MIN_VISIBLE) return;

    const container = canvas.parentElement;
    if (!container) return;
    const chartWidth = container.clientWidth - 12 - 68; // padding.left + padding.right

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { start, end } = viewRef.current;
      const visible = end - start;
      const rect = canvas.getBoundingClientRect();
      const mouseRatio = (e.clientX - rect.left - 12) / chartWidth;
      const zoomFactor = e.deltaY > 0 ? 1.15 : 0.87;
      const newVisible = Math.max(MIN_VISIBLE, Math.min(data.length, Math.round(visible * zoomFactor)));
      const pivot = start + visible * mouseRatio;
      let newStart = Math.round(pivot - newVisible * mouseRatio);
      let newEnd = newStart + newVisible;
      if (newStart < 0) { newStart = 0; newEnd = newVisible; }
      if (newEnd > data.length) { newEnd = data.length; newStart = data.length - newVisible; }
      viewRef.current = { start: Math.max(0, newStart), end: Math.min(data.length, newEnd) };
      draw();
    };

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      dragRef.current = {
        active: true,
        startX: e.clientX,
        startViewStart: viewRef.current.start,
        startViewEnd: viewRef.current.end,
      };
      canvas.style.cursor = 'grabbing';
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!dragRef.current.active) return;
      const dx = e.clientX - dragRef.current.startX;
      const visible = dragRef.current.startViewEnd - dragRef.current.startViewStart;
      const pixelsPerPoint = chartWidth / visible;
      const shift = Math.round(-dx / pixelsPerPoint);
      let newStart = dragRef.current.startViewStart + shift;
      let newEnd = newStart + visible;
      if (newStart < 0) { newStart = 0; newEnd = visible; }
      if (newEnd > data.length) { newEnd = data.length; newStart = data.length - visible; }
      viewRef.current = { start: Math.max(0, newStart), end: Math.min(data.length, newEnd) };
      draw();
    };

    const onMouseUp = () => {
      dragRef.current.active = false;
      canvas.style.cursor = 'grab';
    };

    canvas.style.cursor = 'grab';
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    return () => {
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [data, draw]);

  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        データがありません
      </div>
    );
  }

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full"
      style={{ display: 'block' }}
    />
  );
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
