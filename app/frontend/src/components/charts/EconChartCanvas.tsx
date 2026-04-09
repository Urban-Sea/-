'use client';

import { useEffect, useRef, useCallback } from 'react';

// Read CSS variable from <html> element. Fallback for SSR / first paint.
function cssVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

// Convert #rrggbb → "r,g,b" so we can compose rgba() at runtime.
function hexToRgb(hex: string): string {
  const h = hex.replace('#', '');
  if (h.length !== 6) return '52,96,251'; // brand-500 fallback
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `${r},${g},${b}`;
}

export interface ChartSeries {
  data: Array<{ x: string; y: number | null }>;
  type: 'line' | 'area' | 'bar';
  color: string;
  label: string;
  dashed?: boolean;
  yAxisSide?: 'left' | 'right';
  barNegativeColor?: string;
}

export interface ChartReferenceLine {
  y: number;
  color: string;
  label?: string;
  dashed?: boolean;
}

// Background zone — 2 modes:
//   - Y-axis based: yMin + yMax (e.g. risk score 0-20 = safe band)
//   - X-axis based: xMin + xMax (e.g. recession periods 2007-12 〜 2009-06)
// Specify exactly one mode per zone. Mixing yMin with xMin in the same zone is undefined.
export interface ChartBackgroundZone {
  yMin?: number;
  yMax?: number;
  xMin?: string; // ISO date prefix, e.g. "2020-02" or "2020-02-01"
  xMax?: string;
  color: string;
}

export interface ChartEventMarker {
  date: string;      // "2020-03" or "2020-03-15"
  label: string;
  color?: string;    // default: rgba(255,255,255,0.3)
}

interface EconChartCanvasProps {
  series: ChartSeries[];
  referenceLines?: ChartReferenceLine[];
  backgroundZones?: ChartBackgroundZone[];
  eventMarkers?: ChartEventMarker[];
  yAxisFormat?: (v: number) => string;
  yAxisRightFormat?: (v: number) => string;
  xAxisFormat?: (d: string) => string;
  height?: number;
  initialShowAll?: boolean;
}

const MIN_VISIBLE = 10;
const DEFAULT_VISIBLE = 120;

export default function EconChartCanvas({
  series,
  referenceLines,
  backgroundZones,
  eventMarkers,
  yAxisFormat = (v) => v.toLocaleString(),
  yAxisRightFormat,
  xAxisFormat = (d) => d.length >= 7 ? `${d.substring(0, 4)}/${d.substring(5, 7)}` : d,
  height = 400,
  initialShowAll = false,
}: EconChartCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const viewRef = useRef({ start: 0, end: 0 });
  const dragRef = useRef({ active: false, startX: 0, startViewStart: 0, startViewEnd: 0 });
  const mouseRef = useRef({ x: -1, y: -1, active: false });

  // Total data length = max length among all series
  const totalLen = series.reduce((max, s) => Math.max(max, s.data.length), 0);

  // Initialize viewport
  useEffect(() => {
    if (totalLen === 0) return;
    if (initialShowAll) {
      viewRef.current = { start: 0, end: totalLen };
    } else {
      const visible = Math.min(totalLen, DEFAULT_VISIBLE);
      viewRef.current = { start: totalLen - visible, end: totalLen };
    }
  }, [totalLen, initialShowAll]);

  const draw = useCallback(() => {
    if (totalLen === 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const container = canvas.parentElement;
    if (!container) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = container.clientWidth;
    const h = height;
    canvas.width = width * dpr;
    canvas.height = h * dpr;
    canvas.style.width = width + 'px';
    canvas.style.height = h + 'px';
    ctx.scale(dpr, dpr);

    const { start, end } = viewRef.current;
    const visibleCount = end - start;
    if (visibleCount <= 0) return;

    const hasRightAxis = series.some((s) => s.yAxisSide === 'right');
    const hasEvents = eventMarkers && eventMarkers.length > 0;
    const isMobile = width < 500;
    // Bottom layout (top→bottom): chart, dateLabels(14), eventLabels?(14), legend(18), scrollbar(8)
    const padding = {
      top: 16,
      right: hasRightAxis ? (isMobile ? 56 : 72) : 20,
      bottom: hasEvents ? 76 : 60,
      left: isMobile ? 52 : 72,
    };
    const axisFont = isMobile
      ? '10px Arial, "Helvetica Neue", sans-serif'
      : '11px Arial, "Helvetica Neue", sans-serif';
    const labelFont = '11px Arial, "Helvetica Neue", sans-serif';
    const scrollbarH = 6;
    const chartHeight = h - padding.top - padding.bottom - scrollbarH - 4;
    const chartWidth = width - padding.left - padding.right;
    const pointSpacing = chartWidth / (visibleCount - 1 || 1);

    // Digital Agency tokens (light only — dark mode は廃止)
    const bgColor = cssVar('--background', '#ffffff');
    const gridColor = cssVar('--neutral-200', '#E6E6E6');
    const textColor = cssVar('--neutral-700', '#767676');
    const labelColor = cssVar('--neutral-900', '#4D4D4D');
    const legendColor = cssVar('--neutral-900', '#4D4D4D');
    const cardColor = cssVar('--card', '#ffffff');
    const borderColor = cssVar('--neutral-200', '#E6E6E6');

    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, width, h);

    // Compute Y ranges for left and right axes
    let leftMin = Infinity, leftMax = -Infinity;
    let rightMin = Infinity, rightMax = -Infinity;

    for (const s of series) {
      const sliced = s.data.slice(start, end);
      for (const pt of sliced) {
        if (pt.y == null) continue;
        if (s.yAxisSide === 'right') {
          if (pt.y < rightMin) rightMin = pt.y;
          if (pt.y > rightMax) rightMax = pt.y;
        } else {
          if (pt.y < leftMin) leftMin = pt.y;
          if (pt.y > leftMax) leftMax = pt.y;
        }
      }
    }

    // Ensure zero is included in Y range for bar series
    for (const s of series) {
      if (s.type === 'bar') {
        if (s.yAxisSide === 'right') {
          if (rightMin > 0) rightMin = 0;
          if (rightMax < 0) rightMax = 0;
        } else {
          if (leftMin > 0) leftMin = 0;
          if (leftMax < 0) leftMax = 0;
        }
      }
    }

    // Include reference lines in left axis range
    if (referenceLines) {
      for (const rl of referenceLines) {
        if (rl.y < leftMin) leftMin = rl.y;
        if (rl.y > leftMax) leftMax = rl.y;
      }
    }

    // Add 5% padding
    const addPadding = (min: number, max: number): [number, number] => {
      const range = max - min || 1;
      return [min - range * 0.05, max + range * 0.05];
    };

    if (leftMin === Infinity) { leftMin = 0; leftMax = 100; }
    [leftMin, leftMax] = addPadding(leftMin, leftMax);
    if (rightMin === Infinity) { rightMin = 0; rightMax = 100; }
    [rightMin, rightMax] = addPadding(rightMin, rightMax);

    const yScaleLeft = (v: number) => padding.top + chartHeight * (1 - (v - leftMin) / (leftMax - leftMin));
    const yScaleRight = (v: number) => padding.top + chartHeight * (1 - (v - rightMin) / (rightMax - rightMin));
    const xScale = (i: number) => padding.left + pointSpacing * i;

    // Background zones (behind grid) — supports both Y-axis (yMin/yMax) and X-axis (xMin/xMax) bands
    if (backgroundZones) {
      const primaryDataForZones = series[0]?.data;
      const slicedForZones = primaryDataForZones ? primaryDataForZones.slice(start, end) : null;

      for (const zone of backgroundZones) {
        if (zone.xMin != null && zone.xMax != null) {
          // X-axis based zone (e.g. recession band).
          // Find first index >= xMin, last index <= xMax in the visible slice.
          if (!slicedForZones || slicedForZones.length === 0) continue;
          const xMin = zone.xMin;
          const xMax = zone.xMax;
          // Find startIdx: first data point whose x >= xMin.
          // Use string comparison since x is ISO date prefix.
          let startIdx = -1;
          for (let i = 0; i < slicedForZones.length; i++) {
            if (slicedForZones[i].x >= xMin) { startIdx = i; break; }
          }
          // Find endIdx: last data point whose x <= xMax.
          let endIdx = -1;
          for (let i = slicedForZones.length - 1; i >= 0; i--) {
            if (slicedForZones[i].x <= xMax) { endIdx = i; break; }
          }
          // Skip if zone is entirely outside the visible range.
          if (startIdx < 0 || endIdx < 0 || endIdx < startIdx) continue;
          const x1 = xScale(startIdx);
          const x2 = xScale(endIdx);
          if (x2 > x1) {
            ctx.fillStyle = zone.color;
            ctx.fillRect(x1, padding.top, x2 - x1, chartHeight);
          }
        } else if (zone.yMin != null && zone.yMax != null) {
          // Y-axis based zone (e.g. risk score band).
          const y1 = yScaleLeft(Math.min(zone.yMax, leftMax));
          const y2 = yScaleLeft(Math.max(zone.yMin, leftMin));
          if (y2 > y1) {
            ctx.fillStyle = zone.color;
            ctx.fillRect(padding.left, y1, chartWidth, y2 - y1);
          }
        }
      }
    }

    // Grid lines — DA テンプレ準拠: solid 1px の薄い罫線, 横のみ
    const gridLines = 5;
    ctx.font = axisFont;
    for (let i = 0; i <= gridLines; i++) {
      const y = Math.round(padding.top + (chartHeight / gridLines) * i) + 0.5;
      ctx.strokeStyle = gridColor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(width - padding.right, y);
      ctx.stroke();

      // Left axis labels
      const leftVal = leftMax - (leftMax - leftMin) * (i / gridLines);
      ctx.fillStyle = labelColor;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(yAxisFormat(leftVal), padding.left - 8, y);

      // Right axis labels
      if (hasRightAxis) {
        const rightVal = rightMax - (rightMax - rightMin) * (i / gridLines);
        ctx.textAlign = 'left';
        ctx.fillText((yAxisRightFormat || yAxisFormat)(rightVal), width - padding.right + 8, y);
      }
    }
    ctx.textBaseline = 'alphabetic';

    // Vertical axis line (left edge of plot area)
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(Math.round(padding.left) + 0.5, padding.top);
    ctx.lineTo(Math.round(padding.left) + 0.5, padding.top + chartHeight);
    ctx.stroke();
    if (hasRightAxis) {
      ctx.beginPath();
      ctx.moveTo(Math.round(width - padding.right) - 0.5, padding.top);
      ctx.lineTo(Math.round(width - padding.right) - 0.5, padding.top + chartHeight);
      ctx.stroke();
    }

    // Reference lines
    if (referenceLines) {
      for (const rl of referenceLines) {
        const y = yScaleLeft(rl.y);
        if (y < padding.top || y > padding.top + chartHeight) continue;
        ctx.strokeStyle = rl.color;
        ctx.lineWidth = 1;
        ctx.setLineDash(rl.dashed !== false ? [5, 4] : []);
        ctx.beginPath();
        ctx.moveTo(padding.left, Math.round(y) + 0.5);
        ctx.lineTo(width - padding.right, Math.round(y) + 0.5);
        ctx.stroke();
        ctx.setLineDash([]);

        if (rl.label) {
          ctx.fillStyle = rl.color;
          ctx.font = `bold ${axisFont}`;
          ctx.textAlign = 'right';
          ctx.fillText(rl.label, width - padding.right - 6, y - 5);
        }
      }
    }

    // Clip chart area so bars/lines don't overlap axis labels
    ctx.save();
    ctx.beginPath();
    ctx.rect(padding.left, padding.top, chartWidth, chartHeight);
    ctx.clip();

    // Draw series
    for (const s of series) {
      const sliced = s.data.slice(start, end);
      const yFn = s.yAxisSide === 'right' ? yScaleRight : yScaleLeft;

      if (s.type === 'bar') {
        const barW = Math.max(1, pointSpacing * 0.62);
        const rgb = hexToRgb(s.color);
        for (let i = 0; i < sliced.length; i++) {
          if (sliced[i].y == null) continue;
          const val = sliced[i].y!;
          const x = xScale(i) - barW / 2;
          const zeroY = yFn(0);
          const valY = yFn(val);
          // Honor explicit color but apply consistent opacity
          const barColor = val >= 0
            ? (s.barNegativeColor ? s.color : `rgba(${rgb},0.78)`)
            : (s.barNegativeColor || `rgba(${hexToRgb('#FE3939')},0.78)`);
          ctx.fillStyle = barColor;
          const top = Math.min(zeroY, valY);
          const barH = Math.abs(zeroY - valY) || 1;
          roundRect(ctx, x, top, barW, barH, 1.5);
          ctx.fill();
        }
      } else {
        // line or area
        ctx.strokeStyle = s.color;
        ctx.lineWidth = s.type === 'area' ? 2 : 2.25;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.setLineDash(s.dashed ? [6, 3] : []);
        ctx.beginPath();
        let started = false;
        const points: Array<{ x: number; y: number }> = [];
        for (let i = 0; i < sliced.length; i++) {
          if (sliced[i].y == null) continue;
          const px = xScale(i);
          const py = yFn(sliced[i].y!);
          points.push({ x: px, y: py });
          if (!started) { ctx.moveTo(px, py); started = true; }
          else { ctx.lineTo(px, py); }
        }
        ctx.stroke();
        ctx.setLineDash([]);

        // Area fill — softer gradient, DA palette friendly
        if (s.type === 'area' && points.length > 1) {
          const lastPt = points[points.length - 1];
          const firstPt = points[0];
          ctx.lineTo(lastPt.x, padding.top + chartHeight);
          ctx.lineTo(firstPt.x, padding.top + chartHeight);
          ctx.closePath();
          const rgb = hexToRgb(s.color);
          const grad = ctx.createLinearGradient(0, padding.top, 0, padding.top + chartHeight);
          grad.addColorStop(0, `rgba(${rgb},0.22)`);
          grad.addColorStop(0.6, `rgba(${rgb},0.08)`);
          grad.addColorStop(1, `rgba(${rgb},0)`);
          ctx.fillStyle = grad;
          ctx.fill();
        }
      }
    }

    // Restore full canvas for overlays (crosshair, labels, scrollbar)
    ctx.restore();

    // Event markers (vertical lines with subtle band)
    if (eventMarkers && eventMarkers.length > 0) {
      const primaryData = series[0]?.data;
      if (primaryData) {
        const slicedData = primaryData.slice(start, end);
        for (const marker of eventMarkers) {
          const idx = slicedData.findIndex((d) => d.x.startsWith(marker.date) || marker.date.startsWith(d.x));
          if (idx < 0) continue;
          const mx = xScale(idx);
          const markerColor = marker.color || cssVar('--neutral-500', '#999999');

          // Vertical dashed line
          ctx.strokeStyle = markerColor;
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.moveTo(Math.round(mx) + 0.5, padding.top);
          ctx.lineTo(Math.round(mx) + 0.5, padding.top + chartHeight);
          ctx.stroke();
          ctx.setLineDash([]);

          // Small triangle mark at the top
          ctx.fillStyle = markerColor;
          ctx.beginPath();
          ctx.moveTo(mx - 4, padding.top);
          ctx.lineTo(mx + 4, padding.top);
          ctx.lineTo(mx, padding.top + 5);
          ctx.closePath();
          ctx.fill();
        }
      }
    }

    // Date labels (use first left-axis series for x labels)
    const primarySeries = series[0];
    const dateY = padding.top + chartHeight + 16;
    if (primarySeries) {
      const sliced = primarySeries.data.slice(start, end);
      ctx.fillStyle = textColor;
      ctx.font = axisFont;
      ctx.textAlign = 'center';
      const labelStep = Math.max(1, Math.ceil(sliced.length / 8));
      for (let i = 0; i < sliced.length; i++) {
        if (i % labelStep === 0) {
          ctx.fillText(xAxisFormat(sliced[i].x), xScale(i), dateY);
        }
      }

      // Event labels below date labels
      if (eventMarkers && eventMarkers.length > 0) {
        const eventY = dateY + 14;
        ctx.font = `bold ${axisFont}`;
        ctx.textAlign = 'center';
        for (const marker of eventMarkers) {
          const idx = sliced.findIndex((d) => d.x.startsWith(marker.date) || marker.date.startsWith(d.x));
          if (idx < 0) continue;
          const mx = xScale(idx);
          ctx.fillStyle = marker.color || labelColor;
          ctx.fillText(marker.label, mx, eventY);
        }
      }
    }

    // Crosshair + tooltip pill
    if (mouseRef.current.active && mouseRef.current.x >= padding.left && mouseRef.current.x <= width - padding.right) {
      const mx = mouseRef.current.x;
      // Vertical line — solid 1px in brand-700
      ctx.strokeStyle = cssVar('--neutral-300', '#CCCCCC');
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(mx) + 0.5, padding.top);
      ctx.lineTo(Math.round(mx) + 0.5, padding.top + chartHeight);
      ctx.stroke();

      // Find nearest data index
      const nearestIdx = Math.round((mx - padding.left) / pointSpacing);
      if (nearestIdx >= 0 && nearestIdx < visibleCount) {
        ctx.font = labelFont;
        ctx.textBaseline = 'alphabetic';

        // Build tooltip rows
        const primarySliced = series[0]?.data.slice(start, end);
        const dateLabel = primarySliced?.[nearestIdx]?.x ?? '';
        type Row = { label: string; value: string; color: string };
        const rows: Row[] = [];
        for (const s of series) {
          const sliced = s.data.slice(start, end);
          const val = sliced[nearestIdx]?.y;
          if (val == null) continue;
          const fmt = s.yAxisSide === 'right' ? (yAxisRightFormat || yAxisFormat) : yAxisFormat;
          rows.push({ label: s.label, value: fmt(val), color: s.color });
        }

        if (rows.length > 0) {
          // Measure widest row
          ctx.font = `bold ${labelFont}`;
          let maxLabelW = 0;
          for (const r of rows) maxLabelW = Math.max(maxLabelW, ctx.measureText(r.label).width);
          ctx.font = labelFont;
          let maxValW = 0;
          for (const r of rows) maxValW = Math.max(maxValW, ctx.measureText(r.value).width);
          const dateW = ctx.measureText(dateLabel).width;

          const padX = 12;
          const padY = 10;
          const rowH = 16;
          const swatchW = 10;
          const gap = 16;
          const innerW = Math.max(dateW, swatchW + 8 + maxLabelW + gap + maxValW);
          const tooltipW = innerW + padX * 2;
          const tooltipH = padY * 2 + 18 + rows.length * rowH;

          // Position: prefer right side of cursor; flip if overflow
          let tooltipX = mx + 14;
          if (tooltipX + tooltipW > width - padding.right) {
            tooltipX = mx - 14 - tooltipW;
          }
          if (tooltipX < padding.left) tooltipX = padding.left + 4;
          const tooltipY = padding.top + 8;

          // Background pill
          ctx.fillStyle = cardColor;
          ctx.strokeStyle = borderColor;
          ctx.lineWidth = 1;
          roundRect(ctx, tooltipX, tooltipY, tooltipW, tooltipH, 6);
          ctx.fill();
          // Subtle shadow
          ctx.save();
          ctx.shadowColor = 'rgba(0,0,0,0.08)';
          ctx.shadowBlur = 12;
          ctx.shadowOffsetY = 2;
          ctx.fill();
          ctx.restore();
          ctx.stroke();

          // Date header
          ctx.fillStyle = textColor;
          ctx.font = `${axisFont}`;
          ctx.textAlign = 'left';
          ctx.fillText(dateLabel, tooltipX + padX, tooltipY + padY + 10);

          // Rows
          let ry = tooltipY + padY + 10 + 18;
          for (const r of rows) {
            // swatch
            ctx.fillStyle = r.color;
            ctx.fillRect(tooltipX + padX, ry - 9, swatchW, 10);
            // label
            ctx.fillStyle = labelColor;
            ctx.font = labelFont;
            ctx.fillText(r.label, tooltipX + padX + swatchW + 8, ry);
            // value (right aligned)
            ctx.font = `bold ${labelFont}`;
            ctx.textAlign = 'right';
            ctx.fillText(r.value, tooltipX + tooltipW - padX, ry);
            ctx.textAlign = 'left';
            ry += rowH;
          }

          // Dots on each line at cursor
          for (const s of series) {
            const sliced = s.data.slice(start, end);
            const val = sliced[nearestIdx]?.y;
            if (val == null) continue;
            const yFn = s.yAxisSide === 'right' ? yScaleRight : yScaleLeft;
            const dotY = yFn(val);
            const dotX = xScale(nearestIdx);
            // Outer ring (background color) for contrast
            ctx.beginPath();
            ctx.arc(dotX, dotY, 4.5, 0, Math.PI * 2);
            ctx.fillStyle = bgColor;
            ctx.fill();
            ctx.beginPath();
            ctx.arc(dotX, dotY, 3, 0, Math.PI * 2);
            ctx.fillStyle = s.color;
            ctx.fill();
          }
        }
      }
    }

    // Legend — DA テンプレ準拠で chart 下に配置
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const legendY = h - scrollbarH - 14;
    let legendX = padding.left;
    ctx.font = labelFont;
    for (const s of series) {
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 2.25;
      ctx.setLineDash(s.dashed ? [5, 2] : []);
      if (s.type === 'bar') {
        ctx.fillStyle = s.color;
        ctx.fillRect(legendX, legendY - 4, 12, 8);
      } else {
        ctx.beginPath();
        ctx.moveTo(legendX, legendY);
        ctx.lineTo(legendX + 16, legendY);
        ctx.stroke();
        // dot at center
        ctx.beginPath();
        ctx.arc(legendX + 8, legendY, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = s.color;
        ctx.fill();
      }
      ctx.setLineDash([]);
      legendX += 22;
      ctx.fillStyle = legendColor;
      ctx.fillText(s.label, legendX, legendY);
      legendX += ctx.measureText(s.label).width + 18;
    }
    ctx.textBaseline = 'alphabetic';

    // Scrollbar
    if (totalLen > MIN_VISIBLE) {
      const sbY = h - scrollbarH - 2;
      ctx.fillStyle = 'rgba(0,0,0,0.06)';
      roundRect(ctx, padding.left, sbY, chartWidth, scrollbarH, 3);
      ctx.fill();
      const thumbStart = (start / totalLen) * chartWidth;
      const thumbWidth = Math.max(20, ((end - start) / totalLen) * chartWidth);
      ctx.fillStyle = 'rgba(0,0,0,0.15)';
      roundRect(ctx, padding.left + thumbStart, sbY, thumbWidth, scrollbarH, 3);
      ctx.fill();
    }
  }, [series, totalLen, height, referenceLines, backgroundZones, eventMarkers, yAxisFormat, yAxisRightFormat, xAxisFormat]);

  useEffect(() => { draw(); }, [draw]);

  // Resize observer
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas?.parentElement) return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(canvas.parentElement);
    return () => ro.disconnect();
  }, [draw]);

  // Mouse/wheel handlers
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || totalLen <= MIN_VISIBLE) return;
    const container = canvas.parentElement;
    if (!container) return;

    const hasRightAxis = series.some((s) => s.yAxisSide === 'right');
    const padRight = hasRightAxis ? 68 : 16;
    const chartWidth = container.clientWidth - 68 - padRight;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { start, end } = viewRef.current;
      const visible = end - start;
      const rect = canvas.getBoundingClientRect();
      const mouseRatio = (e.clientX - rect.left - 68) / chartWidth;
      const zoomFactor = e.deltaY > 0 ? 1.15 : 0.87;
      const newVisible = Math.max(MIN_VISIBLE, Math.min(totalLen, Math.round(visible * zoomFactor)));
      const pivot = start + visible * mouseRatio;
      let newStart = Math.round(pivot - newVisible * mouseRatio);
      let newEnd = newStart + newVisible;
      if (newStart < 0) { newStart = 0; newEnd = newVisible; }
      if (newEnd > totalLen) { newEnd = totalLen; newStart = totalLen - newVisible; }
      viewRef.current = { start: Math.max(0, newStart), end: Math.min(totalLen, newEnd) };
      draw();
    };

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      dragRef.current = { active: true, startX: e.clientX, startViewStart: viewRef.current.start, startViewEnd: viewRef.current.end };
      canvas.style.cursor = 'grabbing';
    };

    const onMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouseRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top, active: true };

      if (dragRef.current.active) {
        const dx = e.clientX - dragRef.current.startX;
        const visible = dragRef.current.startViewEnd - dragRef.current.startViewStart;
        const pixelsPerPoint = chartWidth / visible;
        const shift = Math.round(-dx / pixelsPerPoint);
        let newStart = dragRef.current.startViewStart + shift;
        let newEnd = newStart + visible;
        if (newStart < 0) { newStart = 0; newEnd = visible; }
        if (newEnd > totalLen) { newEnd = totalLen; newStart = totalLen - visible; }
        viewRef.current = { start: Math.max(0, newStart), end: Math.min(totalLen, newEnd) };
      }
      draw();
    };

    const onMouseUp = () => {
      dragRef.current.active = false;
      canvas.style.cursor = 'grab';
    };

    const onMouseLeave = () => {
      mouseRef.current.active = false;
      dragRef.current.active = false;
      canvas.style.cursor = 'grab';
      draw();
    };

    canvas.style.cursor = 'grab';
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mouseleave', onMouseLeave);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    return () => {
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('mousedown', onMouseDown);
      canvas.removeEventListener('mouseleave', onMouseLeave);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [totalLen, series, draw]);

  // Public method: reset zoom
  const resetZoom = useCallback(() => {
    if (initialShowAll) {
      viewRef.current = { start: 0, end: totalLen };
    } else {
      const visible = Math.min(totalLen, DEFAULT_VISIBLE);
      viewRef.current = { start: totalLen - visible, end: totalLen };
    }
    draw();
  }, [totalLen, initialShowAll, draw]);

  // Set viewport to specific date range
  const setViewport = useCallback((startDate: string, endDate: string) => {
    const primaryData = series[0]?.data;
    if (!primaryData) return;
    let si = primaryData.findIndex((d) => d.x >= startDate);
    let ei = primaryData.findIndex((d) => d.x > endDate);
    if (si < 0) si = 0;
    if (ei < 0) ei = primaryData.length;
    viewRef.current = { start: si, end: ei };
    draw();
  }, [series, draw]);

  // Expose methods via ref (for parent component)
  const methodsRef = useRef({ resetZoom, setViewport });
  methodsRef.current = { resetZoom, setViewport };

  if (totalLen === 0) {
    return (
      <div className="flex items-center justify-center text-muted-foreground" style={{ height }}>
        データがありません
      </div>
    );
  }

  return (
    <div style={{ height, position: 'relative' }}>
      <canvas ref={canvasRef} className="w-full h-full" style={{ display: 'block' }} />
      {/* Expose control methods via data attributes for parent */}
      <button
        className="hidden"
        data-chart-reset
        onClick={resetZoom}
      />
      <button
        className="hidden"
        data-chart-viewport
        onClick={(e) => {
          const btn = e.currentTarget;
          const s = btn.getAttribute('data-start') || '';
          const ed = btn.getAttribute('data-end') || '';
          if (s && ed) methodsRef.current.setViewport(s, ed);
        }}
        data-start=""
        data-end=""
      />
    </div>
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
