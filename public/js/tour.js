// A short first-run tour with a spotlight on each part of the grid.
import { $ } from './ui.js';

export function runTour(editor) {
  const root = editor.root;
  const stage = editor.stage;
  const focus = editor.focusId;
  const firstEmpty = () => [...stage.pool.values()].find((el) => el._item?.kind === 'empty' && el._item.parentId === focus);
  const firstChild = () => [...stage.pool.values()].find((el) => el._item?.kind === 'node' && el._item.role === 'child' && el._item.parentId === focus);
  const steps = [
    { el: () => stage.findCellFor(focus), title: 'Your goal sits in the middle', text: 'Tap it any time to edit the wording or mark it done.' },
    { el: () => firstEmpty() || firstChild(), title: 'Surround it with eight steps', text: 'Tap an empty square to add something you’ll need to do to reach the goal.' },
    { el: () => firstChild() || firstEmpty(), title: 'Then break each step down', text: 'Tap a step to zoom into it. It becomes the middle of its own grid, ready for eight more.' },
    { el: () => $('[data-act=overview]', root), title: 'See the whole picture', text: 'Zoom out to see every grid at once. Pinch or scroll to zoom freely.' },
    { el: () => $('[data-act=view]', root), title: 'Pick a view style', text: 'Nested lays every grid around your goal. Fractal tucks each grid inside its square.' },
  ];
  let i = 0;
  const layer = document.createElement('div');
  layer.className = 'tour';
  layer.innerHTML = `<div class="spot"></div><div class="tip" role="dialog" aria-live="polite">
      <p class="tip-step"></p><h3></h3><p class="tip-text"></p>
      <div class="tip-actions"><button type="button" class="btn ghost" data-t="skip">Skip</button><button type="button" class="btn primary" data-t="next">Next</button></div>
    </div>`;
  document.body.append(layer);
  const spot = layer.querySelector('.spot');
  const tip = layer.querySelector('.tip');
  const show = () => {
    const s = steps[i];
    const el = s.el();
    layer.querySelector('.tip-step').textContent = `${i + 1} of ${steps.length}`;
    layer.querySelector('h3').textContent = s.title;
    layer.querySelector('.tip-text').textContent = s.text;
    layer.querySelector('[data-t=next]').textContent = i === steps.length - 1 ? 'Start planning' : 'Next';
    const r = el ? el.getBoundingClientRect() : { left: innerWidth / 2 - 40, top: innerHeight / 2 - 40, width: 80, height: 80 };
    const pad = 8;
    Object.assign(spot.style, { left: r.left - pad + 'px', top: r.top - pad + 'px', width: r.width + pad * 2 + 'px', height: r.height + pad * 2 + 'px' });
    const tipH = tip.offsetHeight || 170;
    const below = r.top + r.height + pad + 14;
    const top = below + tipH < innerHeight - 12 ? below : Math.max(12, r.top - pad - 14 - tipH);
    const w = Math.min(340, innerWidth - 24);
    const left = Math.max(12, Math.min(innerWidth - w - 12, r.left + r.width / 2 - w / 2));
    Object.assign(tip.style, { top: top + 'px', left: left + 'px', width: w + 'px' });
    layer.querySelector('[data-t=next]').focus({ preventScroll: true });
  };
  const end = () => {
    layer.classList.remove('show');
    setTimeout(() => layer.remove(), 250);
    removeEventListener('resize', show);
    try { localStorage.setItem('nonagon.tour.v1', '1'); } catch {}
  };
  layer.querySelector('[data-t=skip]').onclick = end;
  layer.querySelector('[data-t=next]').onclick = () => { if (++i >= steps.length) end(); else show(); };
  layer.addEventListener('keydown', (e) => { if (e.key === 'Escape') end(); });
  addEventListener('resize', show);
  requestAnimationFrame(() => { show(); layer.classList.add('show'); requestAnimationFrame(show); });
}

export function tourSeen() {
  try { return localStorage.getItem('nonagon.tour.v1') === '1'; } catch { return false; }
}
