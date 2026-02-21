'use client';

import { useEffect, useRef } from 'react';

interface LineData {
  date: string;
  close: number;
  volume?: number;
  ema8?: number;
  ema21?: number;
}

interface LineChartCanvasProps {
  data: LineData[];
  showEMA?: boolean;
}

export default function LineChartCanvas({
  data,
  showEMA = true,
}: LineChartCanvasProps) {
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

    const padding = { top: 36, right: 68, bottom: 44, left: 12 };
    const totalChartHeight = height - padding.top - padding.bottom;
    const priceChartHeight = totalChartHeight;

    // Format price
    const formatPrice = (val: number) => {
      if (val >= 1000) return '$' + val.toFixed(0);
      return '$' + val.toFixed(2);
    };

    // Background
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, width, height);

    // Calculate price range (include EMA values)
    let minPrice = Infinity, maxPrice = -Infinity;
    data.forEach(d => {
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
    const pointSpacing = chartWidth / (data.length - 1 || 1);

    const yScale = (p: number) => padding.top + priceChartHeight * (1 - (p - minPrice) / (maxPrice - minPrice));
    const xScale = (i: number) => padding.left + pointSpacing * i;

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

    // Close price line - blue smooth line
    ctx.strokeStyle = '#60a5fa';
    ctx.lineWidth = 2;
    ctx.setLineDash([]);
    ctx.beginPath();
    data.forEach((d, i) => {
      const x = xScale(i), y = yScale(d.close);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Fill area under line
    const lastX = xScale(data.length - 1);
    ctx.lineTo(lastX, padding.top + priceChartHeight);
    ctx.lineTo(padding.left, padding.top + priceChartHeight);
    ctx.closePath();
    const gradient = ctx.createLinearGradient(0, padding.top, 0, padding.top + priceChartHeight);
    gradient.addColorStop(0, 'rgba(96,165,250,0.12)');
    gradient.addColorStop(1, 'rgba(96,165,250,0)');
    ctx.fillStyle = gradient;
    ctx.fill();

    // Current price line
    if (data.length > 0) {
      const lastClose = data[data.length - 1].close;
      const prevClose = data.length > 1 ? data[data.length - 2].close : lastClose;
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
      const labelW = 60;
      const labelH = 18;
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
      data.forEach((d, i) => {
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
      data.forEach((d, i) => {
        if (d.ema21 === undefined) return;
        const x = xScale(i), y = yScale(d.ema21);
        if (!started) { ctx.moveTo(x, y); started = true; } else { ctx.lineTo(x, y); }
      });
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Date labels
    ctx.fillStyle = '#606060';
    ctx.font = '10px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    const labelStep = Math.ceil(data.length / 10);
    data.forEach((d, i) => {
      if (i % labelStep === 0) {
        const dateLabel = d.date.slice(5).replace('-', '/');
        ctx.fillText(dateLabel, xScale(i), height - padding.bottom + 14);
      }
    });

    // Legend (top-left)
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
    ctx.fillStyle = '#808080';
    ctx.font = '10px -apple-system, sans-serif';
    ctx.fillText('終値', legendX, 20);
    legendX += 28;

    if (showEMA) {
      ctx.fillStyle = '#4ade80';
      ctx.fillRect(legendX, 15, 14, 2);
      legendX += 18;
      ctx.fillStyle = '#808080';
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
      ctx.fillStyle = '#808080';
      ctx.fillText('EMA21', legendX, 20);
    }

  }, [data, showEMA]);

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
