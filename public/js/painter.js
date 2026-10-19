// Draws a whole board onto a canvas — used for home-screen thumbnails, image export and print.
import { buildItems, computeProgress, contentBounds } from './layout.js';

const LIGHT = {
  bg: '#ECECEE', block: 'rgba(30,32,40,0.06)', paper: '#FFFFFF', ink: '#1F2024', mute: '#77787F',
  line: 'rgba(30,32,40,0.16)', moss: '#F08C7B', mossInk: '#3A1D17', brass: '#B5893A', brassSoft: '#F1E6CC',
};

function rr(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrap(ctx, text, maxW, maxLines) {
  const words = text.split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (ctx.measureText(t).width <= maxW || !cur) cur = t;
    else { lines.push(cur); cur = w; }
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && cur) lines.push(cur);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    let last = lines[maxLines - 1];
    while (last.length > 1 && ctx.measureText(last + '…').width > maxW) last = last.slice(0, -1);
    lines[maxLines - 1] = last + '…';
  }
  return lines;
}

export function paintBoard(canvas, board, { mode = 'nested', size = 1600, pad = 0.04, background = true, depthPx, showEmpty = false } = {}) {
  const dpr = canvas === null ? 1 : 1;
  const c = canvas;
  c.width = size * dpr;
  c.height = size * dpr;
  const ctx = c.getContext('2d');
  ctx.scale(dpr, dpr);
  const css = getComputedStyle(document.documentElement);
  const C = { ...LIGHT, moss: css.getPropertyValue('--moss').trim() || LIGHT.moss, mossInk: css.getPropertyValue('--moss-ink').trim() || LIGHT.mossInk };
  const progress = computeProgress(board);
  const fit = contentBounds(board, mode, null);
  const scale = (size * (1 - pad * 2)) / fit.s;
  const cam = { cx: fit.x, cy: fit.y, scale, vw: size, vh: size, ox: size / 2, oy: size / 2, T: depthPx ?? Math.max(60, size * 0.12) };
  const items = buildItems(board, cam, mode, 1.5);
  if (background) { ctx.fillStyle = C.bg; ctx.fillRect(0, 0, size, size); }
  const font = getComputedStyle(document.documentElement).getPropertyValue('--font').trim() || 'system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const it of items) {
    if ((it.opacity ?? 1) < 0.5) continue;
    const px = it.size * scale;
    const x0 = (it.x - cam.cx) * scale + cam.ox - px / 2;
    const y0 = (it.y - cam.cy) * scale + cam.oy - px / 2;
    if (it.kind === 'block') {
      const g = Math.min(6, px * 0.012);
      ctx.fillStyle = C.block;
      rr(ctx, x0 + g, y0 + g, px - 2 * g, px - 2 * g, Math.min(px * 0.05, 22));
      ctx.fill();
      continue;
    }
    if (it.kind === 'frame') {
      const g = Math.min(4, px * 0.008);
      ctx.strokeStyle = C.line;
      ctx.lineWidth = Math.max(0.5, px * 0.003);
      rr(ctx, x0 + g, y0 + g, px - 2 * g, px - 2 * g, Math.min(px * 0.05, 22));
      ctx.stroke();
      continue;
    }
    const g = Math.min(7, Math.max(0.5, px * 0.045));
    const x = x0 + g, y = y0 + g, w = px - 2 * g;
    const r = Math.min(w * 0.14, 16);
    if (it.kind === 'blob') {
      const p = progress[it.nodeId] || 0;
      ctx.fillStyle = p >= 1 ? C.brass : C.paper;
      ctx.globalAlpha = 0.5 + p * 0.5;
      rr(ctx, x, y, w, w, r); ctx.fill();
      ctx.globalAlpha = 1;
      continue;
    }
    if (it.kind === 'empty') {
      if (!showEmpty) continue;
      ctx.strokeStyle = C.line;
      ctx.setLineDash([Math.max(2, w * 0.05), Math.max(2, w * 0.04)]);
      ctx.lineWidth = Math.max(0.6, w * 0.012);
      rr(ctx, x, y, w, w, r); ctx.stroke();
      ctx.setLineDash([]);
      continue;
    }
    const n = board.nodes[it.nodeId];
    const p = progress[it.nodeId] || 0;
    const center = it.role === 'center';
    ctx.fillStyle = center ? C.moss : p >= 1 ? C.brassSoft : C.paper;
    rr(ctx, x, y, w, w, r); ctx.fill();
    if (!center && p < 1) { ctx.globalAlpha = 0.12; ctx.fillStyle = C.moss; ctx.fill(); ctx.globalAlpha = 1; } // accent tint, as --step
    const hasKids = n.children.some((k) => k && board.nodes[k]);
    if ((hasKids || p > 0) && w > 14) {
      const bh = Math.max(1.5, w * 0.025);
      ctx.fillStyle = center ? 'rgba(255,255,255,0.18)' : C.line;
      rr(ctx, x + w * 0.12, y + w - w * 0.1, w * 0.76, bh, bh / 2); ctx.fill();
      ctx.fillStyle = C.brass;
      if (p > 0) { rr(ctx, x + w * 0.12, y + w - w * 0.1, w * 0.76 * p, bh, bh / 2); ctx.fill(); }
    }
    if (w >= 22) {
      const fs = Math.max(4, Math.min(w * (center ? 0.12 : 0.105), 40));
      ctx.font = `${center ? 650 : 500} ${fs}px ${font}`;
      ctx.fillStyle = center ? C.mossInk : C.ink;
      const lines = wrap(ctx, n.text, w * 0.82, w > 90 ? 4 : 3);
      const lh = fs * 1.18;
      const startY = y + w / 2 - ((lines.length - 1) * lh) / 2 - (hasKids ? w * 0.03 : 0);
      lines.forEach((ln, k) => ctx.fillText(ln, x + w / 2, startY + k * lh));
    }
  }
  return c;
}

export async function exportImage(board, mode) {
  const canvas = document.createElement('canvas');
  paintBoard(canvas, board, { mode, size: 3000, depthPx: 220 });
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
  return { blob, url: URL.createObjectURL(blob), canvas };
}
