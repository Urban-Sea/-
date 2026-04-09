'use client';

import { useEffect, useRef, useCallback } from 'react';

export interface DonutSegment {
  label: string;
  value: number;
  color: string;
}

export interface DonutChartProps {
  segments: DonutSegment[];
  height?: number;
  innerRadiusRatio?: number;
  centerLabel?: string;
  centerValue?: string;
  valueFormat?: (v: number) => string;
  maxSegments?: number;
  showLegend?: boolean;
}

const GAP_RAD = (1 * Math.PI) / 180; // 1-degree gap between segments

export default function DonutChart({
  segments,
  height = 260,
  innerRadiusRatio = 0.55,
  centerLabel,
  centerValue,
  valueFormat = (v) => v.toLocaleString(),
  maxSegments = 8,
  showLegend = true,
}: DonutChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouseRef = useRef({ x: -1, y: -1, active: false });
  const hoverRef = useRef(-1);

  // Consolidate small segments into "Other"
  const prepared = (() => {
    if (segments.length <= maxSegments) return segments;
    const sorted = [...segments].sort((a, b) => b.value - a.value);
    const top = sorted.slice(0, maxSegments - 1);
    const rest = sorted.slice(maxSegments - 1);
    const otherVal = rest.reduce((s, r) => s + r.value, 0);
    return [...top, { label: 'その他', value: otherVal, color: '#71717a' }];
  })();

  const total = prepared.reduce((s, seg) => s + seg.value, 0);

  const draw = useCallback(() => {
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

    // Clear
    ctx.clearRect(0, 0, width, h);

    if (total === 0 || prepared.length === 0) {
      ctx.fillStyle = '#999';
      ctx.font = '13px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('データなし', width / 2, h / 2);
      return;
    }

    // Layout: chart on left, legend on right (or chart centered if no legend)
    const legendW = showLegend ? Math.min(160, width * 0.4) : 0;
    const chartAreaW = width - legendW;
    const cx = chartAreaW / 2;
    const cy = h / 2;
    const outerR = Math.min(chartAreaW, h) / 2 - 16;
    const innerR = outerR * innerRadiusRatio;

    const { x: mx, y: my, active: mouseActive } = mouseRef.current;

    // Determine hover segment by angle from center
    let hoveredIdx = -1;
    if (mouseActive && total > 0) {
      const dx = mx - cx;
      const dy = my - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist >= innerR - 4 && dist <= outerR + 10) {
        let angle = Math.atan2(dy, dx);
        if (angle < -Math.PI / 2) angle += 2 * Math.PI;
        // Shift so 0 is at top (-PI/2)
        let normalAngle = angle + Math.PI / 2;
        if (normalAngle < 0) normalAngle += 2 * Math.PI;

        const totalGap = GAP_RAD * prepared.length;
        const availableAngle = 2 * Math.PI - totalGap;
        let cumAngle = 0;
        for (let i = 0; i < prepared.length; i++) {
          const segAngle = (prepared[i].value / total) * availableAngle;
          if (normalAngle >= cumAngle && normalAngle < cumAngle + segAngle + GAP_RAD) {
            hoveredIdx = i;
            break;
          }
          cumAngle += segAngle + GAP_RAD;
        }
      }
    }
    hoverRef.current = hoveredIdx;

    // Draw arcs
    const totalGap = GAP_RAD * prepared.length;
    const availableAngle = 2 * Math.PI - totalGap;
    let startAngle = -Math.PI / 2; // start from top

    for (let i = 0; i < prepared.length; i++) {
      const seg = prepared[i];
      const segAngle = (seg.value / total) * availableAngle;
      const isHovered = i === hoveredIdx;
      const r = isHovered ? outerR + 6 : outerR;
      const ir = isHovered ? innerR - 2 : innerR;

      ctx.beginPath();
      ctx.arc(cx, cy, r, startAngle, startAngle + segAngle);
      ctx.arc(cx, cy, ir, startAngle + segAngle, startAngle, true);
      ctx.closePath();

      ctx.fillStyle = seg.color;
      if (isHovered) {
        ctx.globalAlpha = 1;
      } else if (hoveredIdx >= 0) {
        ctx.globalAlpha = 0.5;
      } else {
        ctx.globalAlpha = 0.85;
      }
      ctx.fill();
      ctx.globalAlpha = 1;

      startAngle += segAngle + GAP_RAD;
    }

    // Center hole fill (for clean inner circle)
    ctx.beginPath();
    ctx.arc(cx, cy, innerR - 1, 0, 2 * Math.PI);
    ctx.fillStyle = '#ffffff';
    ctx.globalAlpha = 0.01; // nearly invisible, just to cover anti-aliasing
    ctx.fill();
    ctx.globalAlpha = 1;

    // Center text
    if (centerValue) {
      ctx.fillStyle = '#18181b';
      ctx.font = 'bold 18px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(centerValue, cx, centerLabel ? cy - 8 : cy);
    }
    if (centerLabel) {
      ctx.fillStyle = '#71717a';
      ctx.font = '11px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(centerLabel, cx, centerValue ? cy + 12 : cy);
    }

    // Tooltip on hover
    if (hoveredIdx >= 0) {
      const seg = prepared[hoveredIdx];
      const pct = ((seg.value / total) * 100).toFixed(1);
      const line1 = seg.label;
      const line2 = `${valueFormat(seg.value)}  (${pct}%)`;

      ctx.font = 'bold 12px -apple-system, BlinkMacSystemFont, sans-serif';
      const w1 = ctx.measureText(line1).width;
      ctx.font = '11px "SF Mono", "Menlo", monospace';
      const w2 = ctx.measureText(line2).width;
      const boxW = Math.max(w1, w2) + 20;
      const boxH = 44;

      let tx = mx + 14;
      let ty = my - boxH - 6;
      if (tx + boxW > width) tx = mx - boxW - 14;
      if (ty < 0) ty = my + 14;

      // Tooltip background
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.strokeStyle = 'rgba(0,0,0,0.1)';
      ctx.lineWidth = 1;
      const cornerR = 6;
      ctx.beginPath();
      ctx.moveTo(tx + cornerR, ty);
      ctx.lineTo(tx + boxW - cornerR, ty);
      ctx.quadraticCurveTo(tx + boxW, ty, tx + boxW, ty + cornerR);
      ctx.lineTo(tx + boxW, ty + boxH - cornerR);
      ctx.quadraticCurveTo(tx + boxW, ty + boxH, tx + boxW - cornerR, ty + boxH);
      ctx.lineTo(tx + cornerR, ty + boxH);
      ctx.quadraticCurveTo(tx, ty + boxH, tx, ty + boxH - cornerR);
      ctx.lineTo(tx, ty + cornerR);
      ctx.quadraticCurveTo(tx, ty, tx + cornerR, ty);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Color dot
      ctx.beginPath();
      ctx.arc(tx + 12, ty + 16, 4, 0, 2 * Math.PI);
      ctx.fillStyle = seg.color;
      ctx.fill();

      // Label
      ctx.fillStyle = '#18181b';
      ctx.font = 'bold 12px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(line1, tx + 22, ty + 16);

      // Value
      ctx.fillStyle = '#52525b';
      ctx.font = '11px "SF Mono", "Menlo", monospace';
      ctx.fillText(line2, tx + 10, ty + 32);
    }

    // Legend
    if (showLegend && legendW > 0) {
      const legendX = chartAreaW + 8;
      const legendItemH = 22;
      const legendStartY = Math.max(12, cy - (prepared.length * legendItemH) / 2);

      for (let i = 0; i < prepared.length; i++) {
        const seg = prepared[i];
        const pct = ((seg.value / total) * 100).toFixed(1);
        const y = legendStartY + i * legendItemH;
        const isHoveredLeg = i === hoveredIdx;

        // Color dot
        ctx.beginPath();
        ctx.arc(legendX + 6, y + 7, 5, 0, 2 * Math.PI);
        ctx.fillStyle = seg.color;
        ctx.globalAlpha = isHoveredLeg || hoveredIdx < 0 ? 1 : 0.4;
        ctx.fill();
        ctx.globalAlpha = 1;

        // Label
        ctx.fillStyle = isHoveredLeg ? '#000' : '#52525b';
        ctx.font = '11px -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(seg.label, legendX + 16, y + 7);

        // Percentage
        ctx.fillStyle = '#a1a1aa';
        ctx.font = '10px "SF Mono", "Menlo", monospace';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${pct}%`, width - 6, y + 7);
      }
    }
  }, [prepared, total, height, innerRadiusRatio, centerLabel, centerValue, valueFormat, showLegend, maxSegments]);

  // Redraw on state/theme change
  useEffect(() => {
    draw();
  }, [draw]);

  // ResizeObserver
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas?.parentElement) return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(canvas.parentElement);
    return () => ro.disconnect();
  }, [draw]);

  // Mouse events
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouseRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top, active: true };
      draw();
    };
    const onLeave = () => {
      mouseRef.current = { x: -1, y: -1, active: false };
      hoverRef.current = -1;
      draw();
    };

    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('mouseleave', onLeave);
    return () => {
      canvas.removeEventListener('mousemove', onMove);
      canvas.removeEventListener('mouseleave', onLeave);
    };
  }, [draw]);

  return (
    <div className="w-full" style={{ height }}>
      <canvas ref={canvasRef} className="w-full h-full" />
    </div>
  );
}
