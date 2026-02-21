'use client';

import { useEffect, useRef } from 'react';
import type { BOSMarker, CHoCHMarker, FVGMarker } from '@/types';

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
  showEMA?: boolean;
  showBOS?: boolean;
  showCHoCH?: boolean;
  showFVG?: boolean;
  bosMarkers?: BOSMarker[];
  chochMarkers?: CHoCHMarker[];
  fvgMarkers?: FVGMarker[];
}

export default function CandlestickChart({
  data,
  showEMA = true,
  showBOS = false,
  showCHoCH = false,
  showFVG = false,
  bosMarkers = [],
  chochMarkers = [],
  fvgMarkers = [],
}: CandlestickChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!data || data.length === 0) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const container = canvas.parentElement;
    if (!container) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // High DPI support
    const dpr = window.devicePixelRatio || 1;
    const width = container.clientWidth;
    const height = container.clientHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    ctx.scale(dpr, dpr);

    // Layout: price chart top 78%, volume bottom 18%, gap 4%
    const hasVolume = data.some(c => c.volume && c.volume > 0);
    const subRatio = hasVolume ? 0.18 : 0;
    const gapRatio = hasVolume ? 0.04 : 0;
    const priceRatio = 1 - subRatio - gapRatio;

    const padding = { top: 36, right: 68, bottom: 44, left: 12 };
    const totalChartHeight = height - padding.top - padding.bottom;
    const priceChartHeight = totalChartHeight * priceRatio;
    const subChartTop = padding.top + priceChartHeight + totalChartHeight * gapRatio;
    const subChartHeight = totalChartHeight * subRatio;

    // Create date to index map for markers
    const dateIndexMap = new Map<string, number>();
    data.forEach((d, i) => {
      dateIndexMap.set(d.date, i);
    });

    // Format price
    const formatPrice = (val: number) => {
      if (val >= 1000) return '$' + val.toFixed(0);
      return '$' + val.toFixed(2);
    };

    // Background
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, width, height);

    // Calculate price range
    let minPrice = Infinity, maxPrice = -Infinity;
    data.forEach(c => {
      if (c.low < minPrice) minPrice = c.low;
      if (c.high > maxPrice) maxPrice = c.high;
    });
    const priceRange = maxPrice - minPrice;
    minPrice -= priceRange * 0.05;
    maxPrice += priceRange * 0.05;

    const chartWidth = width - padding.left - padding.right;
    const candleWidth = Math.max(1, Math.min(12, (chartWidth / data.length) * 0.65));
    const candleSpacing = chartWidth / data.length;

    const yScale = (p: number) => padding.top + priceChartHeight * (1 - (p - minPrice) / (maxPrice - minPrice));
    const xScale = (i: number) => padding.left + candleSpacing * i + candleSpacing / 2;

    // Grid lines (price area only)
    const gridLines = 6;
    for (let i = 0; i <= gridLines; i++) {
      const y = padding.top + (priceChartHeight / gridLines) * i;
      ctx.strokeStyle = 'rgba(255,255,255,0.04)';
      ctx.lineWidth = 0.5;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(width - padding.right, y);
      ctx.stroke();
      ctx.setLineDash([]);
      const price = maxPrice - (maxPrice - minPrice) * (i / gridLines);
      ctx.fillStyle = '#555';
      ctx.font = '10px -apple-system, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(formatPrice(price), width - padding.right + 6, y + 3);
    }

    // FVG Zones
    if (showFVG && fvgMarkers.length > 0) {
      fvgMarkers.forEach(fvg => {
        const idx = dateIndexMap.get(fvg.date);
        if (idx === undefined || idx < 0 || idx >= data.length) return;
        const gapTop = yScale(fvg.top);
        const gapBottom = yScale(fvg.bottom);
        const xStart = xScale(idx);
        const maxExtend = Math.min(idx + 30, data.length - 1);
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

    // Candlesticks
    data.forEach((c, i) => {
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

    // Current price line
    if (data.length > 0) {
      const lastCandle = data[data.length - 1];
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
      const ema8Data = data.map(d => d.ema8).filter((v): v is number => v !== undefined);
      if (ema8Data.length > 0) {
        ctx.strokeStyle = '#4ade80';
        ctx.lineWidth = 1.3;
        ctx.setLineDash([]);
        ctx.beginPath();
        let started = false;
        data.forEach((d, i) => {
          if (d.ema8 === undefined) return;
          const x = xScale(i), y = yScale(d.ema8);
          if (!started) { ctx.moveTo(x, y); started = true; } else { ctx.lineTo(x, y); }
        });
        ctx.stroke();
      }
      const ema21Data = data.map(d => d.ema21).filter((v): v is number => v !== undefined);
      if (ema21Data.length > 0) {
        ctx.strokeStyle = '#f87171';
        ctx.lineWidth = 1.3;
        ctx.setLineDash([6, 3]);
        ctx.beginPath();
        let started = false;
        data.forEach((d, i) => {
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
        if (idx === undefined || idx < 0 || idx >= data.length) return;
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
        const maxExt = Math.min(idx + 12, data.length - 1);
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
        if (idx === undefined || idx < 0 || idx >= data.length) return;
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
        const eIdx = Math.min(data.length - 1, idx + 10);
        ctx.strokeStyle = 'rgba(168,85,247,0.2)';
        ctx.lineWidth = 0.8;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(xScale(sIdx), y); ctx.lineTo(xScale(eIdx), y);
        ctx.stroke();
        ctx.setLineDash([]);
      });
    }

    // ── Volume bars ──
    if (hasVolume) {
      // Separator line
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 0.5;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(padding.left, subChartTop - 2);
      ctx.lineTo(width - padding.right, subChartTop - 2);
      ctx.stroke();

      // Volume label
      ctx.fillStyle = '#444';
      ctx.font = '9px -apple-system, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('Vol', padding.left + 2, subChartTop + 10);

      const maxVol = Math.max(...data.map(c => c.volume || 0));
      if (maxVol > 0) {
        const volBarW = Math.max(1, candleWidth * 0.85);
        data.forEach((c, i) => {
          if (!c.volume) return;
          const x = xScale(i);
          const barH = (c.volume / maxVol) * (subChartHeight - 4);
          const barY = subChartTop + subChartHeight - barH;
          const isUp = c.close >= c.open;
          ctx.fillStyle = isUp ? 'rgba(38,166,154,0.35)' : 'rgba(239,83,80,0.35)';
          ctx.fillRect(x - volBarW / 2, barY, volBarW, barH);
        });

        // Volume scale label
        const volLabel = maxVol >= 1e9 ? (maxVol / 1e9).toFixed(1) + 'B'
          : maxVol >= 1e6 ? (maxVol / 1e6).toFixed(0) + 'M'
          : maxVol >= 1e3 ? (maxVol / 1e3).toFixed(0) + 'K'
          : maxVol.toString();
        ctx.fillStyle = '#444';
        ctx.font = '9px -apple-system, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(volLabel, width - padding.right + 6, subChartTop + 10);
      }
    }

    // Date labels
    ctx.fillStyle = '#606060';
    ctx.font = '10px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    const labelStep = Math.ceil(data.length / 10);
    data.forEach((c, i) => {
      if (i % labelStep === 0) {
        const dateLabel = c.date.slice(5).replace('-', '/');
        ctx.fillText(dateLabel, xScale(i), height - padding.bottom + 14);
      }
    });

    // Title & Legend
    ctx.fillStyle = '#e0e0e0';
    ctx.font = 'bold 12px -apple-system, sans-serif';
    ctx.textAlign = 'left';
    let titleX = padding.left + 4;
    if (showEMA) {
      ctx.fillStyle = '#4ade80';
      ctx.fillRect(titleX, 15, 14, 2);
      titleX += 18;
      ctx.fillStyle = '#808080';
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
      ctx.fillStyle = '#808080';
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
    }

  }, [data, showEMA, showBOS, showCHoCH, showFVG, bosMarkers, chochMarkers, fvgMarkers]);

  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-[#808080]">
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
