import { buildItems, frameOf } from './layout.js';
import { interpolateZoom, easeInOut, prefersReducedMotion } from './camera.js';

const LOD = (px) => (px < 40 ? 'xs' : px < 84 ? 's' : px < 150 ? 'm' : 'l');

// Renders the board as positioned DOM tiles and handles tap / drag / pinch / wheel.
export class Stage {
  constructor(el, handlers) {
    this.el = el;
    this.h = handlers; // { onTap(item), onLongPress(item), onTick(nodeId), onNote(nodeId), onSettle() }
    this.world = document.createElement('div');
    this.world.className = 'world';
    el.append(this.world);
    this.pool = new Map();
    this.cam = { cx: 0, cy: 0, w: 1.1, T: 300 };
    this.mode = 'nested';
    this.board = null;
    this.progress = {};
    this.focusId = null;
    this.frameId = null;
    this.born = new Set();
    this.anim = null;
    this.raf = 0;
    this.insets = { top: 64, bottom: 96, side: 12 };
    this.pointers = new Map();
    this.gesture = null;

    this.ro = new ResizeObserver(() => this.render());
    this.ro.observe(el);
    el.addEventListener('pointerdown', (e) => this.down(e));
    el.addEventListener('pointermove', (e) => this.move(e));
    el.addEventListener('pointerup', (e) => this.up(e));
    el.addEventListener('pointercancel', (e) => this.up(e, true));
    el.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('cell')) {
        e.preventDefault();
        const it = e.target._item;
        if (it) this.h.onTap(it);
      }
    });
  }

  // ---- geometry -------------------------------------------------------
  get vw() { return this.el.clientWidth || 1; }
  get vh() { return this.el.clientHeight || 1; }
  get fitSize() {
    const i = this.insets;
    return Math.max(120, Math.min(this.vw - i.side * 2, this.vh - i.top - i.bottom));
  }
  get origin() {
    const i = this.insets;
    return { ox: this.vw / 2, oy: i.top + (this.vh - i.top - i.bottom) / 2 };
  }
  get scale() { return this.fitSize / this.cam.w; }
  toWorld(sx, sy) {
    const { ox, oy } = this.origin;
    return [(sx - ox) / this.scale + this.cam.cx, (sy - oy) / this.scale + this.cam.cy];
  }

  setBoard(board, progress, focusId) {
    this.board = board;
    this.progress = progress;
    this.setFocus(focusId);
    this.render();
  }

  // Nested view: redraw relative to another square without moving anything on
  // screen. Tiles shared by both frames stay put; the rest fade.
  setFrame(id) {
    if (!this.board || id === this.frameId) return;
    if (this.frameId && this.board.nodes[this.frameId]) {
      const a = frameOf(this.board, this.frameId);
      const b = frameOf(this.board, id);
      this.cam.cx = (a.ox + a.sc * this.cam.cx - b.ox) / b.sc;
      this.cam.cy = (a.oy + a.sc * this.cam.cy - b.oy) / b.sc;
      this.cam.w = (this.cam.w * a.sc) / b.sc;
    }
    this.frameId = id;
    this.ghostUntil = performance.now() + 60;
    this.appearUntil = performance.now() + 450;
    this.draw();
  }

  setFocus(id) {
    if (id !== this.focusId) this.appearUntil = performance.now() + 450;
    this.focusId = id;
  }

  // ---- camera animation -------------------------------------------------
  flyTo(target, opts = {}) {
    const from = [this.cam.cx, this.cam.cy, this.cam.w];
    const to = [target.cx, target.cy, target.w];
    const T0 = this.cam.T, T1 = target.T ?? this.cam.T;
    if (opts.instant || prefersReducedMotion()) {
      this.cancelAnim();
      Object.assign(this.cam, { cx: to[0], cy: to[1], w: to[2], T: T1 });
      if (!opts.instant) {
        this.world.animate([{ opacity: 0.35 }, { opacity: 1 }], { duration: 220, easing: 'ease-out' });
      }
      this.render();
      return Promise.resolve();
    }
    const path = interpolateZoom(from, to);
    const duration = Math.min(1150, Math.max(420, path.duration * 0.9)) * (opts.speed || 1);
    this.cancelAnim();
    return new Promise((resolve) => {
      const start = performance.now();
      this.anim = { resolve };
      const step = (now) => {
        if (!this.anim) return;
        const t = Math.min(1, (now - start) / duration);
        const e = easeInOut(t);
        const [cx, cy, w] = path(e);
        this.cam.cx = cx; this.cam.cy = cy; this.cam.w = w;
        this.cam.T = Math.exp(Math.log(T0) + (Math.log(T1) - Math.log(T0)) * e);
        this.draw();
        if (t < 1) this.anim.frame = requestAnimationFrame(step);
        else { this.anim = null; resolve(); }
      };
      this.anim.frame = requestAnimationFrame(step);
    });
  }

  cancelAnim() {
    if (this.anim) {
      cancelAnimationFrame(this.anim.frame);
      const r = this.anim.resolve;
      this.anim = null;
      r();
    }
  }

  render() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.draw(); });
  }

  // ---- drawing ----------------------------------------------------------
  draw() {
    if (!this.board) return;
    const { ox, oy } = this.origin;
    const scale = this.scale;
    const cam = { cx: this.cam.cx, cy: this.cam.cy, scale, vw: this.vw, vh: this.vh, ox, oy, T: this.cam.T };
    const items = buildItems(this.board, cam, this.mode, 4, this.focusId, this.frameId);
    const used = new Set();
    for (const it of items) {
      used.add(it.key);
      let el = this.pool.get(it.key);
      if (!el) {
        el = this.create(it);
        this.pool.set(it.key, el);
        this.world.append(el);
      }
      this.place(el, it, scale, ox, oy);
    }
    const ghosting = performance.now() < (this.ghostUntil || 0);
    for (const [key, el] of this.pool) {
      if (used.has(key)) continue;
      this.pool.delete(key);
      if (ghosting) {
        el.classList.add('ghost');
        el.style.pointerEvents = 'none';
        setTimeout(() => el.remove(), 420);
      } else el.remove();
    }
  }

  create(it) {
    const el = document.createElement('div');
    el.className = 'cell k-' + it.kind;
    if (this.appearUntil && performance.now() < this.appearUntil && this.pool.size) {
      el.classList.add('appear');
      setTimeout(() => el.classList.remove('appear'), 500);
    }
    el.dataset.kind = it.kind;
    if (it.role) el.dataset.role = it.role;
    const face = document.createElement('div');
    face.className = 'face';
    el.append(face);
    if (it.kind === 'node') {
      face.innerHTML =
        '<span class="label"></span><span class="pct"></span>' +
        '<i class="bar"><b></b></i><span class="dots"></span>' +
        '<button class="tick" type="button" tabindex="-1" aria-label="Mark done"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.4l3 3 6-6.6"/></svg></button>' +
        '<button class="note-btn" type="button" tabindex="-1" aria-label="Open notes"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5h6l2.5 2.5v8.5H4z"/><path d="M6.2 7.5h4M6.2 10h3"/></svg></button>';
      if (this.born.has(it.nodeId) && it.role !== 'center') {
        el.classList.add('born');
        setTimeout(() => el.classList.remove('born'), 700);
        if (it.role === 'child' || it.role === 'card') this.born.delete(it.nodeId);
      }
    } else if (it.kind === 'empty') {
      face.innerHTML = '<span class="plus" aria-hidden="true"></span><span class="label">Add step</span>';
    }
    return el;
  }

  place(el, it, scale, ox, oy) {
    el._item = it;
    const px = it.size * scale;
    const sx = (it.x - this.cam.cx) * scale + ox;
    const sy = (it.y - this.cam.cy) * scale + oy;
    let g;
    if (it.kind === 'block') g = Math.min(6, px * 0.012);
    else if (it.kind === 'frame') g = Math.min(4, px * 0.008);
    else g = Math.min(7, Math.max(0.6, px * 0.045));
    const size = Math.max(0, px - g * 2);
    el.style.transform = `translate3d(${(sx - px / 2 + g).toFixed(2)}px,${(sy - px / 2 + g).toFixed(2)}px,0)`;
    el.style.width = el.style.height = size.toFixed(2) + 'px';
    el.style.setProperty('--px', size.toFixed(1));
    const op = it.opacity ?? 1;
    if (el._op !== op) { el.style.opacity = op; el._op = op; el.style.pointerEvents = op < 0.5 ? 'none' : ''; }
    const lod = LOD(size);
    if (el._lod !== lod) { el.dataset.lod = lod; el._lod = lod; }
    this.paint(el, it);
  }

  paint(el, it) {
    const b = this.board;
    const focus = this.focusId;
    if (it.kind === 'node') {
      const n = b.nodes[it.nodeId];
      if (!n) return;
      const p = this.progress[it.nodeId] || 0;
      const kids = n.children.filter((c) => c && b.nodes[c]);
      const isFocus = it.nodeId === focus && it.role === 'center';
      const inFocus = it.parentId === focus || it.nodeId === focus;
      let dots = '';
      if (it.role === 'card' || it.peek) {
        for (let pos = 0; pos < 9; pos++) {
          if (pos === 4) { dots += '<i class="me"></i>'; continue; }
          const c = n.children[pos < 4 ? pos : pos - 1];
          const cn = c && b.nodes[c];
          dots += `<i class="${cn ? (this.progress[c] >= 1 ? 'done' : 'on') : ''}"></i>`;
        }
      }
      const sig = `${n.text}|${n.done}|${Math.round(p * 100)}|${kids.length}|${isFocus}|${inFocus}|${dots}|${!!it.peek}|${!!n.note}`;
      if (el._sig === sig) return;
      el._sig = sig;
      el.querySelector('.label').textContent = n.text;
      el.querySelector('.pct').textContent = kids.length || n.done ? Math.round(p * 100) + '%' : '';
      el.querySelector('.bar b').style.width = (p * 100).toFixed(1) + '%';
      el.querySelector('.dots').innerHTML = dots;
      const wasDone = el.classList.contains('is-done');
      el.classList.toggle('is-done', p >= 1);
      if (p >= 1 && !wasDone && el._painted) {
        el.classList.remove('just-done');
        void el.offsetWidth;
        el.classList.add('just-done');
      }
      el.classList.toggle('has-kids', kids.length > 0);
      el.classList.toggle('peek', !!it.peek);
      el.classList.toggle('has-note', !!n.note);
      el.classList.toggle('is-focus', isFocus);
      el.classList.toggle('in-focus', inFocus);
      el.tabIndex = inFocus ? 0 : -1;
      el.setAttribute('role', 'button');
      el.setAttribute('aria-label', `${n.text}${p >= 1 ? ', done' : kids.length ? `, ${Math.round(p * 100)}% done` : ''}${n.note ? ', has notes' : ''}`);
      el._painted = true;
    } else if (it.kind === 'empty') {
      const inFocus = it.parentId === focus;
      if (el._sig === inFocus) return;
      el._sig = inFocus;
      el.classList.toggle('in-focus', inFocus);
      el.tabIndex = inFocus ? 0 : -1;
      el.setAttribute('role', 'button');
      el.setAttribute('aria-label', 'Add a step');
    } else if (it.kind === 'blob') {
      const p = this.progress[it.nodeId] || 0;
      el.style.setProperty('--p', p.toFixed(2));
    } else if (it.kind === 'block') {
      const f = it.nodeId === focus;
      if (el._sig !== f) { el._sig = f; el.classList.toggle('is-focus', f); }
    }
  }

  // Briefly show completion ripple from a node's centre tile.
  celebrate(nodeId) {
    const el = this.pool.get('n' + nodeId + '@c') || this.pool.get('n' + nodeId + '@k');
    if (!el || prefersReducedMotion()) return;
    const r = el.getBoundingClientRect();
    const host = this.el.getBoundingClientRect();
    for (let k = 0; k < 3; k++) {
      const ring = document.createElement('div');
      ring.className = 'ripple';
      const size = Math.max(r.width, r.height);
      Object.assign(ring.style, {
        left: r.left - host.left + r.width / 2 - size / 2 + 'px',
        top: r.top - host.top + r.height / 2 - size / 2 + 'px',
        width: size + 'px', height: size + 'px', animationDelay: k * 180 + 'ms',
      });
      this.el.append(ring);
      setTimeout(() => ring.remove(), 1800 + k * 180);
    }
  }

  // ---- input ------------------------------------------------------------
  down(e) {
    if (e.button !== undefined && e.button > 0 && e.pointerType === 'mouse') return;
    this.el.setPointerCapture?.(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const rect = this.el.getBoundingClientRect();
    if (this.pointers.size === 1) {
      this.cancelAnim();
      const cell = e.target.closest?.('.cell');
      this.gesture = {
        type: 'tap', sx: e.clientX, sy: e.clientY, rect,
        cam: { ...this.cam }, target: cell, tick: e.target.closest?.('.tick'), note: e.target.closest?.('.note-btn'),
        timer: setTimeout(() => {
          if (this.gesture && this.gesture.type === 'tap' && cell?._item) {
            this.gesture.type = 'done';
            navigator.vibrate?.(8);
            this.h.onLongPress?.(cell._item);
          }
        }, 520),
      };
    } else if (this.pointers.size === 2) {
      clearTimeout(this.gesture?.timer);
      const [a, b] = [...this.pointers.values()];
      const mid = [(a.x + b.x) / 2 - rect.left, (a.y + b.y) / 2 - rect.top];
      this.gesture = {
        type: 'pinch', rect, dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        w: this.cam.w, anchor: this.toWorld(mid[0], mid[1]),
      };
    }
  }

  move(e) {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = this.gesture;
    if (!g) return;
    if (g.type === 'tap' || g.type === 'pan') {
      const dx = e.clientX - g.sx, dy = e.clientY - g.sy;
      if (g.type === 'tap' && Math.hypot(dx, dy) > 7) { g.type = 'pan'; clearTimeout(g.timer); this.el.classList.add('grabbing'); }
      if (g.type === 'pan') {
        const s = this.fitSize / g.cam.w;
        this.cam.cx = clamp(g.cam.cx - dx / s, -0.7, 0.7);
        this.cam.cy = clamp(g.cam.cy - dy / s, -0.7, 0.7);
        this.draw();
      }
    } else if (g.type === 'pinch' && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mid = [(a.x + b.x) / 2 - g.rect.left, (a.y + b.y) / 2 - g.rect.top];
      this.cam.w = clamp(g.w * (g.dist / dist), 1e-7, 1.6);
      const { ox, oy } = this.origin;
      const s = this.scale;
      this.cam.cx = g.anchor[0] - (mid[0] - ox) / s;
      this.cam.cy = g.anchor[1] - (mid[1] - oy) / s;
      this.draw();
    }
  }

  up(e, cancelled) {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    const g = this.gesture;
    if (!g) return;
    clearTimeout(g.timer);
    if (g.type === 'pinch') {
      if (this.pointers.size === 1) {
        const [p] = [...this.pointers.values()];
        this.gesture = { type: 'pan', sx: p.x, sy: p.y, cam: { ...this.cam } };
      } else if (this.pointers.size === 0) { this.gesture = null; this.h.onSettle?.(); }
      return;
    }
    if (this.pointers.size) return;
    this.gesture = null;
    this.el.classList.remove('grabbing');
    if (cancelled) return;
    if (g.type === 'tap' && g.target?._item) {
      const it = g.target._item;
      if (g.tick && it.kind === 'node') this.h.onTick?.(it.nodeId);
      else if (g.note && it.kind === 'node') this.h.onNote?.(it.nodeId);
      else this.h.onTap(it);
    } else if (g.type === 'pan') {
      this.h.onSettle?.();
    }
  }

  wheel(e) {
    e.preventDefault();
    this.cancelAnim();
    const rect = this.el.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    if (!e.ctrlKey && Math.abs(e.deltaX) > Math.abs(e.deltaY) * 0.6 && e.deltaMode === 0) {
      // trackpad two-finger pan
      this.cam.cx = clamp(this.cam.cx + e.deltaX / this.scale, -0.7, 0.7);
      this.cam.cy = clamp(this.cam.cy + e.deltaY / this.scale, -0.7, 0.7);
    } else {
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      const k = Math.exp(e.deltaY * unit * (e.ctrlKey ? 0.01 : 0.0018));
      const [wx, wy] = this.toWorld(sx, sy);
      this.cam.w = clamp(this.cam.w * k, 1e-7, 1.6);
      const { ox, oy } = this.origin;
      const s = this.scale;
      this.cam.cx = wx - (sx - ox) / s;
      this.cam.cy = wy - (sy - oy) / s;
    }
    this.draw();
    clearTimeout(this.wheelTimer);
    this.wheelTimer = setTimeout(() => this.h.onSettle?.(), 220);
  }

  findCellFor(nodeId) {
    return this.pool.get('n' + nodeId + '@c') || this.pool.get('n' + nodeId + '@s') || this.pool.get('n' + nodeId + '@k');
  }
}

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
