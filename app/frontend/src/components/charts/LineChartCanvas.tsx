'use client';

import { useEffect, useRef, useCallback } from 'react';

interface LineData {
  date: string;
  close: number;
  volume?: number;
  ema8?: number;
  ema21?: number;
}

interface LineChartCanvasProps {
  data: LineData[];
  ticker?: string;
  showEMA?: boolean;
}

const MIN_VISIBLE = 20;
const DEFAULT_VISIBLE = 120;

export default function LineChartCanvas({
  data,
  ticker,
  showEMA = true,
  initialVisibleCount,
}: LineChartCanvasProps & { initialVisibleCount?: number }) {
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

    const padding = { top: 36, right: 68, bottom: 44, left: 12 };
    const scrollbarH = 6;
    const totalChartHeight = height - padding.top - padding.bottom - scrollbarH - 4;
    const priceChartHeight = totalChartHeight;

    const ccy = ticker && /^\d/.test(ticker) ? '¥' : '$';
    const formatPrice = (val: number) => {
      if (ccy === '¥') return '¥' + Math.round(val).toLocaleString();
      if (val >= 1000) return '$' + val.toFixed(0);
      return '$' + val.toFixed(2);
    };

    const bgColor = '#ffffff';
    const gridColor = 'rgba(0,0,0,0.06)';
    const priceTextColor = '#999';
    const dateTextColor = '#999';
    const legendTextColor = '#666';

    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, width, height);

    // Price range for visible data
    let minPrice = Infinity, maxPrice = -Infinity;
    visibleData.forEach(d => {
      if (d.close < minPrice) minPrice = d.close;
      if (d.close > maxPrice) maxPrice = d.close;
      if (showEMA) {
        if (d.ema8 !== undefined) {
          if (d.ema8 < minPrice) minPrice = d.ema8;
          if (d.ema8 > maxPrice) maxPrice = d.ema8;
        }
        if (d.ema21 !== undefined) {
          if (d.ema21 < minPrice) minPrice = d.ema21;
          if (d.ema21 > maxPrice) maxPrice = d.ema21;
        }
      }
    });
    const priceRange = maxPrice - minPrice;
    minPrice -= priceRange * 0.05;
    maxPrice += priceRange * 0.05;

    const chartWidth = width - padding.left - padding.right;
    const pointSpacing = chartWidth / (visibleData.length - 1 || 1);

    const yScale = (p: number) => padding.top + priceChartHeight * (1 - (p - minPrice) / (maxPrice - minPrice));
    const xScale = (i: number) => padding.left + pointSpacing * i;

    // Grid lines
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

    // Close price line
    ctx.strokeStyle = '#60a5fa';
    ctx.lineWidth = 2;
    ctx.setLineDash([]);
    ctx.beginPath();
    visibleData.forEach((d, i) => {
      const x = xScale(i), y = yScale(d.close);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Fill area under line
    const lastX = xScale(visibleData.length - 1);
    ctx.lineTo(lastX, padding.top + priceChartHeight);
    ctx.lineTo(padding.left, padding.top + priceChartHeight);
    ctx.closePath();
    const gradient = ctx.createLinearGradient(0, padding.top, 0, padding.top + priceChartHeight);
    gradient.addColorStop(0, 'rgba(96,165,250,0.12)');
    gradient.addColorStop(1, 'rgba(96,165,250,0)');
    ctx.fillStyle = gradient;
    ctx.fill();

    // Current price line (last visible)
    if (visibleData.length > 0) {
      const lastClose = visibleData[visibleData.length - 1].close;
      const prevClose = visibleData.length > 1 ? visibleData[visibleData.length - 2].close : lastClose;
      const lastY = yScale(lastClose);
      const isUp = lastClose >= prevClose;
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
      const labelW = 60, labelH = 18;
      roundRect(ctx, width - padding.right + 1, lastY - labelH / 2, labelW, labelH, 3);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 10px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(formatPrice(lastClose), width - padding.right + 1 + labelW / 2, lastY + 3.5);
    }

    // EMA Lines
    if (showEMA) {
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

      ctx.strokeStyle = '#f87171';
      ctx.lineWidth = 1.3;
      ctx.setLineDash([6, 3]);
      ctx.beginPath();
      started = false;
      visibleData.forEach((d, i) => {
        if (d.ema21 === undefined) return;
        const x = xScale(i), y = yScale(d.ema21);
        if (!started) { ctx.moveTo(x, y); started = true; } else { ctx.lineTo(x, y); }
      });
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Date labels
    ctx.fillStyle = dateTextColor;
    ctx.font = '10px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    const labelStep = Math.max(1, Math.ceil(visibleData.length / 10));
    visibleData.forEach((d, i) => {
      if (i % labelStep === 0) {
        const dateLabel = d.date.slice(5).replace('-', '/');
        ctx.fillText(dateLabel, xScale(i), height - padding.bottom - scrollbarH + 10);
      }
    });

    // Legend
    ctx.textAlign = 'left';
    let legendX = padding.left + 4;
    ctx.strokeStyle = '#60a5fa';
    ctx.lineWidth = 2;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(legendX, 16);
    ctx.lineTo(legendX + 14, 16);
    ctx.stroke();
    legendX += 18;
    ctx.fillStyle = legendTextColor;
    ctx.font = '10px -apple-system, sans-serif';
    ctx.fillText('終値', legendX, 20);
    legendX += 28;

    if (showEMA) {
      ctx.fillStyle = '#4ade80';
      ctx.fillRect(legendX, 15, 14, 2);
      legendX += 18;
      ctx.fillStyle = legendTextColor;
      ctx.fillText('EMA8', legendX, 20);
      legendX += 36;
      ctx.strokeStyle = '#f87171';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 2]);
      ctx.beginPath();
      ctx.moveTo(legendX, 16);
      ctx.lineTo(legendX + 14, 16);
      ctx.stroke();
      ctx.setLineDash([]);
      legendX += 18;
      ctx.fillStyle = legendTextColor;
      ctx.fillText('EMA21', legendX, 20);
    }

    // Scrollbar
    if (data.length > MIN_VISIBLE) {
      const sbY = height - scrollbarH - 2;
      const sbWidth = chartWidth;
      const sbX = padding.left;
      // Track
      ctx.fillStyle = 'rgba(0,0,0,0.06)';
      roundRect(ctx, sbX, sbY, sbWidth, scrollbarH, 3);
      ctx.fill();
      // Thumb
      const thumbStart = (start / data.length) * sbWidth;
      const thumbWidth = Math.max(20, ((end - start) / data.length) * sbWidth);
      ctx.fillStyle = 'rgba(0,0,0,0.15)';
      roundRect(ctx, sbX + thumbStart, sbY, thumbWidth, scrollbarH, 3);
      ctx.fill();
    }
  }, [data, ticker, showEMA]);

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
  x: number, y: number, w: number, h: number, r: number
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
